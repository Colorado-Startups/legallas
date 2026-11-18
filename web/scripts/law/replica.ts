// SPDX-License-Identifier: Apache-2.0
// A local stand-in for the legallas-law AI Search instance, for the law eval before the instance exists: the
// built parts in <lawDir>/out, embedded with the record index's model (@cf/qwen/qwen3-embedding-0.6b through
// the Workers AI REST API), plus BM25 keyword scores, fused by reciprocal rank like the instance (fusion rrf).
// It answers in AI Search's response shape, so worker/law.ts retrieveLaw runs unchanged on top of it.
//
// Only public law text and the eval's legal questions are sent to Workers AI. Embeddings are cached in
// <lawDir>/replica/embeddings.json by text hash, so a rebuild embeds only changed parts. Every embedding call runs
// under the caller's spend lease (scripts/spend-guard.ts), so a large rebuild stops at the day's neuron budget and
// resumes from the cache the next day.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { usageNeurons, worstCaseNeurons } from '../../worker/budget.ts';
import { wranglerToken } from '../wrangler.ts';
import type { SpendLease } from '../spend-guard.ts';
import { CATALOG_KEY, sha256 } from './plan.ts';
import type { LawCatalog } from './types.ts';

/** The embedding model that the replica uses. */
export const EMBEDDING_MODEL = '@cf/qwen/qwen3-embedding-0.6b';
const API = 'https://api.cloudflare.com/client/v4';
const EMBED_BATCH = 50;
/** Batches between cache writes: 1,000 parts, about 3 minutes. A run killed by its time limit keeps what it embedded. */
export const CHECKPOINT_BATCHES = 20;
/** qwen3-embedding-0.6b's vector size. */
const EMBED_DIMENSIONS = 1024;
/** 4xx statuses about the token, the account or the rate, not the text. */
const NOT_A_REFUSAL = new Set([401, 403, 408, 429]);
const EMBED_TIMEOUT_MS = 60_000;
const RRF_K = 60;

/** One part of a document to embed, with its key and text. */
export interface Part {
  key: string;
  text: string;
}

/** Every part under <lawDir>/out/law and the catalog beside them. */
export async function loadOutput(dir: string): Promise<{ parts: Part[]; catalogText: string }> {
  const out = path.join(dir, 'out');
  const parts: Part[] = [];
  for (const track of ['civil', 'regulator', 'both']) {
    const folder = path.join(out, 'law', track);
    const files = await readdir(folder).catch(() => [] as string[]);
    for (const file of files.sort()) parts.push({ key: `law/${track}/${file}`, text: await readFile(path.join(folder, file), 'utf8') });
  }
  const catalogText = await readFile(path.join(out, CATALOG_KEY), 'utf8');
  JSON.parse(catalogText) as LawCatalog;
  return { parts, catalogText };
}

/** Lowercase word stems, roughly the instance's porter tokenizer: plurals and common suffixes dropped. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:[.-][a-z0-9]+)*/g) ?? []).map((w) => w.replace(/(?:ing|ed|es|s)$/, '')).filter((w) => w.length > 1);
}

/** BM25 over the parts; `or` matching like the room's keyword_match_mode. */
export function bm25(parts: readonly Part[]): (query: string) => number[] {
  const docs = parts.map((p) => terms(p.text));
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  const tf = docs.map((doc) => {
    const counts = new Map<string, number>();
    for (const t of doc) counts.set(t, (counts.get(t) ?? 0) + 1);
    return counts;
  });
  return (query) => {
    const q = [...new Set(terms(query))];
    return docs.map((doc, i) => {
      let score = 0;
      for (const t of q) {
        const f = tf[i]!.get(t) ?? 0;
        if (!f) continue;
        const idf = Math.log(1 + (docs.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * doc.length) / avg));
      }
      return score;
    });
  };
}

/** The cosine similarity of two vectors. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Wrangler's OAuth token, which lasts about an hour: renewed every ttl and on demand after a 401. */
export interface TokenSource {
  get(): Promise<string>;
  renew(): Promise<string>;
}

/** A token source that fetches a wrangler token and reuses it until its time to live passes. */
export function wranglerTokens(fetchToken: () => Promise<string> = () => wranglerToken(), ttlMs = 600_000, now: () => number = Date.now): TokenSource {
  let token: Promise<string> | null = null;
  let at = 0;
  const renew = () => {
    at = now();
    const pending = fetchToken();
    token = pending;
    // A failed fetch is not cached for the TTL: the next get() asks wrangler again.
    pending.catch(() => {
      if (token === pending) token = null;
    });
    return pending;
  };
  return { get: () => (token && now() - at < ttlMs ? token : renew()), renew };
}

/**
 * `call` again after 5 s, 15 s and 45 s while Workers AI answers 429 or 503: several sessions evaluate the same model
 * at once, and a rate-limited or out-of-capacity call is not the model's answer (production Ask answered 503 while
 * evals ran, 2026-10-04, so the evals back off too). Any other status returns at once.
 */
export async function withRateRetry(call: () => Promise<Response>, waits: readonly number[] = [5_000, 15_000, 45_000]): Promise<Response> {
  let response = await call();
  for (const wait of waits) {
    if (response.status !== 429 && response.status !== 503) break;
    await response.body?.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, wait));
    response = await call();
  }
  return response;
}

/** `call(token)`, once more with a renewed token when the first answer is 401. */
export async function withFreshToken(tokens: TokenSource, call: (token: string) => Promise<Response>): Promise<Response> {
  const response = await call(await tokens.get());
  if (response.status !== 401) return response;
  await response.body?.cancel().catch(() => undefined);
  return call(await tokens.renew());
}

/** A GET on the Cloudflare API for this account. Errors carry the status only. */
export type RestGet = (resource: string) => Promise<Record<string, unknown>>;

/** GETs on wrangler's OAuth token, renewed on a 401 and retried on a 429. */
export function restGetter(account: string, tokens: TokenSource, fetcher: typeof fetch = fetch): RestGet {
  if (!/^[0-9a-f]{32}$/.test(account)) throw new Error('account id must be 32 hex characters');
  return async (resource) => {
    const response = await withRateRetry(() =>
      withFreshToken(tokens, (token) =>
        fetcher(`${API}/accounts/${account}/${resource}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) }),
      ),
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !body || body.success === false) throw new Error(`cloudflare_get_${response.status}`);
    return body;
  };
}

/**
 * Workers AI REST embeddings, each call holding its worst case under `lease` and settled to the usage it reports.
 * Errors carry the status only; a refused call (4xx) costs nothing, any other failure keeps its hold.
 */
export function restEmbed(accountId: string, tokens: TokenSource, lease: SpendLease, fetcher: typeof fetch = fetch): (texts: string[]) => Promise<number[][]> {
  return async (texts) => {
    const ticket = await lease.take('neurons', worstCaseNeurons(EMBEDDING_MODEL, { text: texts }));
    let response: Response;
    try {
      response = await withRateRetry(() =>
        withFreshToken(tokens, (token) =>
          fetcher(`${API}/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: texts }),
            signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
          }),
        ),
      );
    } catch (error) {
      lease.done(ticket, null);
      throw error;
    }
    const body = (await response.json().catch(() => null)) as { result?: { data?: number[][]; usage?: unknown } } | null;
    if (!response.ok || !body?.result?.data) {
      lease.done(ticket, response.status >= 400 && response.status < 500 ? 0 : null);
      throw new Error(`embedding_http_${response.status}`);
    }
    lease.done(ticket, usageNeurons(EMBEDDING_MODEL, body.result.usage));
    return body.result.data;
  };
}

/**
 * Embeds texts, halving a batch the model refuses until the one text it refuses is found; that text is embedded
 * from its first 500 characters (garbled OCR can tokenize past the model's limit), or as its header line alone.
 */
export async function embedSplitting(embed: (texts: string[]) => Promise<number[][]>, texts: readonly string[]): Promise<number[][]> {
  try {
    return await embed([...texts]);
  } catch (error) {
    // Out of budget ends the run (SpendStop, matched by name: scripts/spend-guard.ts imports this file); splitting would not help.
    if (error instanceof Error && error.name === 'SpendStop') throw error;
    const status = Number(/^embedding_http_(\d{3})$/.exec(error instanceof Error ? error.message : '')?.[1] ?? 0);
    // A token, access, timeout or rate failure left after the retries says nothing about the text: end the run, so no part is stored as zeros.
    if (NOT_A_REFUSAL.has(status)) throw error;
    if (texts.length > 1) {
      const half = Math.ceil(texts.length / 2);
      return [...(await embedSplitting(embed, texts.slice(0, half))), ...(await embedSplitting(embed, texts.slice(half)))];
    }
    const text = texts[0] ?? '';
    for (const shorter of [text.slice(0, 500), text.split('\n')[0] ?? '']) {
      if (shorter && shorter !== text) return embedSplitting(embed, [shorter]);
    }
    // A text the model refuses even as one line is left out of vector search (keyword search still finds it).
    if (status >= 400 && status < 500) return [new Array<number>(EMBED_DIMENSIONS).fill(0)];
    throw error;
  }
}

/** Embeddings for every part, from the cache where the text is unchanged; a text the model refuses gets zeros (keyword search still finds it). */
export async function embedParts(dir: string, parts: readonly Part[], embed: (texts: string[]) => Promise<number[][]>, log: (line: string) => void): Promise<number[][]> {
  const file = path.join(dir, 'replica', 'embeddings.json');
  const cache = JSON.parse(await readFile(file, 'utf8').catch(() => '{}')) as Record<string, number[]>;
  const missing = parts.filter((p) => !cache[sha256(p.text)]);
  let added = 0;
  let saved = 0;
  const save = async () => {
    if (added === saved) return;
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(cache), { mode: 0o600 });
    saved = added;
  };
  try {
    for (let i = 0; i < missing.length; i += EMBED_BATCH) {
      const batch = missing.slice(i, i + EMBED_BATCH);
      const vectors = await embedSplitting(embed, batch.map((p) => p.text));
      batch.forEach((p, j) => (cache[sha256(p.text)] = vectors[j]!));
      added += batch.length;
      log(`  embedded ${Math.min(i + EMBED_BATCH, missing.length)} of ${missing.length}`);
      // Written as it goes: a process killed by a time limit runs no finally, and a first run takes most of an hour.
      if ((i / EMBED_BATCH + 1) % CHECKPOINT_BATCHES === 0) await save();
    }
  } finally {
    // Kept after a stop too (the day's budget, a refused call), so the next run embeds only what is still missing.
    await save();
  }
  return parts.map((p) => cache[sha256(p.text)]!);
}

/** An AI Search stand-in: hybrid by reciprocal rank fusion, the request's threshold and result count honoured. */
export function replicaSearch(parts: readonly Part[], vectors: readonly number[][], embed: (texts: string[]) => Promise<number[][]>) {
  const keyword = bm25(parts);
  return {
    async search(request: AiSearchLike) {
      const options = request.ai_search_options?.retrieval ?? {};
      const [q] = await embed([request.query]);
      const vector = vectors.map((v) => cosine(q!, v));
      const kw = keyword(request.query);
      const rank = (scores: number[], floor: number) =>
        scores
          .map((s, i) => [s, i] as const)
          .filter(([s]) => s > floor)
          .sort((a, b) => b[0] - a[0])
          .map(([, i]) => i);
      const fused = new Map<number, number>();
      rank(vector, options.match_threshold ?? 0.4).forEach((i, r) => fused.set(i, (fused.get(i) ?? 0) + 1 / (RRF_K + r)));
      rank(kw, 0).forEach((i, r) => fused.set(i, (fused.get(i) ?? 0) + 1 / (RRF_K + r)));
      const top = [...fused].sort((a, b) => b[1] - a[1]).slice(0, options.max_num_results ?? 10);
      return {
        search_query: request.query,
        chunks: top.map(([i, score]) => ({
          id: `replica-${i}`,
          type: 'text',
          score,
          text: parts[i]!.text,
          item: { key: parts[i]!.key },
          scoring_details: { vector_score: vector[i]!, keyword_score: kw[i]! },
        })),
      };
    },
  };
}

/** The shape of an AI Search query that the replica accepts. */
export interface AiSearchLike {
  query: string;
  ai_search_options?: { retrieval?: { match_threshold?: number; max_num_results?: number } };
}

/** An R2 stand-in serving catalog.json from memory, for retrieveLaw's catalog read. */
export function memoryCatalog(text: string) {
  return {
    async get(key: string) {
      return key === CATALOG_KEY ? { etag: sha256(text).slice(0, 16), body: true, json: async () => JSON.parse(text) as unknown } : null;
    },
  };
}

/** The local law library over <lawDir>/out: a search and a catalog bucket, as worker/law.ts retrieveLaw takes them. */
export async function localLawLibrary(dir: string, account: string, tokens: TokenSource, log: (line: string) => void, lease: SpendLease) {
  const embed = restEmbed(account, tokens, lease);
  const { parts, catalogText } = await loadOutput(dir);
  log(`Law replica: ${parts.length} parts (embeddings cached by text hash).`);
  return { search: replicaSearch(parts, await embedParts(dir, parts, embed, log), embed), bucket: memoryCatalog(catalogText) };
}
