// SPDX-License-Identifier: Apache-2.0
// A local stand-in for the record index in either format (W5 E4), to compare index v2 with v1 before any staging
// resource exists: both built from the same local text (scripts/index-v2.ts pagesOf), embedded with the record
// index's model (@cf/qwen/qwen3-embedding-0.6b over the Workers AI REST API, so case text stays inside
// Cloudflare), with BM25 and reciprocal rank fusion as the instance does (scripts/law/replica.ts). v1 is chunked
// here the way AI Search chunks it, roughly (approxChunks); v2 parts are one chunk each by design.
//
// Vectors are cached under <out>/replica/<format>.f32 with a key list beside it (mode 600), so a rerun embeds only
// changed text. It answers in AI Search's response shape, so worker/retrieval.ts retrieve() runs on top unchanged.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pagesOf, skipReason, type V2Row } from './index-v2.ts';
import { buildParts } from './indexparts.ts';
import { ssnShaped } from './indexparts-v2.ts';
import { hasSsnForm } from './pii.ts';
import { bm25, embedSplitting } from './law/replica.ts';

export interface LocalPart {
  key: string;
  text: string;
}

/**
 * AI Search's recursive chunking of a v1 part, roughly: windows of about `size` characters cut at a paragraph,
 * line or sentence end, each starting `overlap` characters before the last one ended (the instance's 15%).
 */
export function approxChunks(body: string, size = 1500, overlap = 225): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(body.length, start + size);
    if (end < body.length) {
      const window = body.slice(start, end);
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. '));
      if (cut > size / 2) end = start + cut + 1;
    }
    out.push(body.slice(start, end).trim());
    if (end >= body.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out.filter(Boolean);
}

/** v2 parts as built (<out>/parts/text). */
export async function loadV2Parts(out: string): Promise<LocalPart[]> {
  const dir = path.join(out, 'parts', 'text');
  const files = (await readdir(dir)).sort();
  return Promise.all(files.map(async (file) => ({ key: `text/${file}`, text: await readFile(path.join(dir, file), 'utf8') })));
}

/** v1 chunks for the same documents: indexparts.ts buildParts, then approxChunks; every chunk keeps its part key. */
export function v1Chunks(docs: readonly { id: string; pages: { n: number; text: string }[] }[]): LocalPart[] {
  return docs.flatMap((doc) => buildParts(doc.id, doc.pages).flatMap((part) => approxChunks(part.body).map((text) => ({ key: part.key, text }))));
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32);
const EMBED_BATCH = 50;
const EMBED_CONCURRENCY = 6;

/** Embeddings for every part, from <out>/replica/<name>.f32 where the text is unchanged. Returns one row per part. */
export async function embedAll(
  out: string,
  name: string,
  parts: readonly LocalPart[],
  embed: (texts: string[]) => Promise<number[][]>,
  log: (line: string) => void,
): Promise<Float32Array[]> {
  const dir = path.join(out, 'replica');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const keysFile = path.join(dir, `${name}.keys.json`);
  const dataFile = path.join(dir, `${name}.f32`);
  const keys = JSON.parse(await readFile(keysFile, 'utf8').catch(() => '[]')) as string[];
  const data = await readFile(dataFile).catch(() => Buffer.alloc(0));
  const dim = keys.length ? data.length / 4 / keys.length : 0;
  const known = new Map<string, Float32Array>();
  keys.forEach((key, i) => known.set(key, new Float32Array(data.buffer.slice(data.byteOffset + i * dim * 4, data.byteOffset + (i + 1) * dim * 4))));
  const missing = [...new Set(parts.map((p) => hash(p.text)))].filter((h) => !known.has(h));
  const textOf = new Map(parts.map((p) => [hash(p.text), p.text]));
  const batches = Array.from({ length: Math.ceil(missing.length / EMBED_BATCH) }, (_, i) => missing.slice(i * EMBED_BATCH, (i + 1) * EMBED_BATCH));
  let done = 0;
  let next = 0;
  // A few batches at a time: one at a time takes about an hour for the whole record.
  await Promise.all(
    Array.from({ length: Math.min(EMBED_CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++]!; // safe: bounds checked by the loop
        const vectors = await embedSplitting(embed, batch.map((h) => textOf.get(h)!)); // safe: every hash came from a part
        batch.forEach((h, j) => known.set(h, Float32Array.from(vectors[j]!)));
        done += batch.length;
        if (Math.floor(done / 2000) !== Math.floor((done - batch.length) / 2000)) {
          log(`  ${name}: embedded ${done} of ${missing.length}`);
          await saveVectors(keysFile, dataFile, known);
        }
      }
    }),
  );
  if (missing.length) await saveVectors(keysFile, dataFile, known);
  return parts.map((p) => known.get(hash(p.text))!); // safe: every hash is embedded above
}

async function saveVectors(keysFile: string, dataFile: string, known: Map<string, Float32Array>): Promise<void> {
  const keys = [...known.keys()];
  const buffer = Buffer.concat(keys.map((k) => Buffer.from(known.get(k)!.buffer))); // safe: keys from the map
  await writeFile(keysFile, JSON.stringify(keys), { mode: 0o600 });
  await writeFile(dataFile, buffer, { mode: 0o600 });
}

interface LocalRequest {
  query: string;
  ai_search_options?: { retrieval?: { retrieval_type?: string; match_threshold?: number; max_num_results?: number } };
}

const RRF_K = 60;

function normalized(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  const scale = 1 / (Math.sqrt(n) || 1);
  return v.map((x) => x * scale);
}

/**
 * An AI Search stand-in over local parts: vector matches above the request's threshold and BM25 matches ("or"),
 * fused by reciprocal rank; retrieval_type "vector" or "keyword" uses one side only. Query embeddings are cached.
 */
export function localSearch(parts: readonly LocalPart[], vectors: readonly Float32Array[], embed: (texts: string[]) => Promise<number[][]>) {
  const keyword = bm25(parts);
  const unit = vectors.map(normalized);
  const queries = new Map<string, Float32Array>();
  return {
    async search(request: LocalRequest) {
      const options = request.ai_search_options?.retrieval ?? {};
      const type = options.retrieval_type ?? 'hybrid';
      let q = queries.get(request.query);
      if (!q) queries.set(request.query, (q = normalized(Float32Array.from((await embed([request.query]))[0]!)))); // safe: one text in, one vector out
      const vector = unit.map((v) => v.reduce((sum, x, i) => sum + x * q![i]!, 0)); // safe: q is set above
      const kw = keyword(request.query);
      const rank = (scores: number[], floor: number) =>
        scores
          .map((s, i) => [s, i] as const)
          .filter(([s]) => s > floor)
          .sort((a, b) => b[0] - a[0])
          .map(([, i]) => i);
      const fused = new Map<number, number>();
      if (type !== 'keyword') rank(vector, options.match_threshold ?? 0.4).forEach((i, r) => fused.set(i, (fused.get(i) ?? 0) + 1 / (RRF_K + r + 1)));
      if (type !== 'vector') rank(kw, 0).forEach((i, r) => fused.set(i, (fused.get(i) ?? 0) + 1 / (RRF_K + r + 1)));
      const top = [...fused].sort((a, b) => b[1] - a[1]).slice(0, options.max_num_results ?? 10);
      return {
        search_query: request.query,
        chunks: top.map(([i, score]) => ({
          id: `local-${i}`,
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

/**
 * The local index in one format over the live documents `rows`: v2 from the parts index:v2 built in `out`, v1
 * rebuilt from the same text. Both cover exactly the documents with local text, so they compare format alone.
 */
export async function localIndex(
  format: 'v1' | 'v2',
  out: string,
  rows: readonly V2Row[],
  from: { cacheDir: string; sourceRoot: string },
  embed: (texts: string[]) => Promise<number[][]>,
  log: (line: string) => void,
) {
  let parts: LocalPart[];
  if (format === 'v2') parts = await loadV2Parts(out);
  else {
    const docs: { id: string; pages: { n: number; text: string }[] }[] = [];
    for (const row of rows) {
      if (skipReason(row)) continue;
      const got = await pagesOf(row, from).catch(() => null);
      // The v2 build's guard, so both formats hold the same documents and no Social Security shaped number is sent;
      // pii.ts hasSsnForm too, the spaced and dotted forms that v1's buildParts refuses.
      const holds = (text: string) => ssnShaped(text) > 0 || hasSsnForm(text);
      if (got && 'pages' in got && !got.pages.some((page) => holds(page.text))) docs.push({ id: row.id, pages: got.pages });
    }
    parts = v1Chunks(docs);
  }
  log(`Local ${format} index: ${parts.length} chunks`);
  return localSearch(parts, await embedAll(out, format, parts, embed, log), embed);
}
