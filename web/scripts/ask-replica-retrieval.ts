// SPDX-License-Identifier: Apache-2.0
// The Ask replica's retrieval (scripts/ask-replica.ts), once per question: production record retrieval through
// the worker's own retrieve() over the AI Search REST search, the case picture, and (--law) law passages from the
// local law replica. Read-only for production: one SELECT on `documents`, the published matter and search calls.
// The cache it fills is case content and lives only in the replica's --out directory (mode 600).
import { createHash } from 'node:crypto';
import type { CitableDoc } from '../worker/passages.ts';
import type { LawChunk } from '../worker/law-cite.ts';
import { MATTER_KEY } from '../worker/matter-types.ts';
import type { buildMessages, LawPassage, PromptChunk } from '../worker/prompt.ts';
import type { EvalItem } from './ask-eval-score.ts';
import { lawDir } from './law/plan.ts';
import { localLawLibrary, type TokenSource } from './law/replica.ts';
import { documentsDb, loadModule, memoryFiles, publishedMatter, restSearch } from './mcp-replica.ts';
import type { Fetch } from './mcp-oauth.ts';
import type { SpendLease } from './spend-guard.ts';
import { cliWrangler } from './wrangler.ts';

export interface CachedRetrieval {
  /** sha256 of the question, so an edited eval item is retrieved again. */
  key: string;
  chunks: PromptChunk[];
  citable: [string, CitableDoc][];
  brief: { text: string; citable: [string, CitableDoc][] } | null;
  /** Law library passages (--law), retrieved once per question like the record's. */
  law?: (LawPassage & LawChunk)[];
  /** Which retrieval rule produced `law`, so a changed floor retrieves again. */
  lawFloor?: number;
}

export const questionKey = (question: string) => createHash('sha256').update(question).digest('hex').slice(0, 16);

export interface WorkerRetrieval {
  retrieve(search: unknown, db: unknown, question: string, role: 'owner'): Promise<{ chunks: PromptChunk[]; citable: Map<string, CitableDoc> }>;
  liveDocuments(db: unknown, ids: readonly string[], role: 'owner'): Promise<Map<string, CitableDoc>>;
}

export interface WorkerAsk {
  generationInput(messages: ReturnType<typeof buildMessages>, model?: string): Record<string, unknown>;
}

/**
 * Retrieval for every item whose question has none cached. `log` gets item ids and counts only. `fetcher` carries the
 * AI Search calls: scripts/ask-replica.ts passes one metered by its spend lease (scripts/spend-guard.ts).
 */
export async function retrieveAll(
  items: readonly EvalItem[],
  cache: Map<string, CachedRetrieval>,
  fetcher: Fetch,
  account: string,
  token: string,
  log: (line: string) => void = (line) => console.log(line),
): Promise<void> {
  const missing = items.filter((item) => cache.get(item.id)?.key !== questionKey(item.question));
  if (missing.length === 0) return;
  const [retrieval, { matterBrief }, { loadMatter }] = await Promise.all([
    loadModule<WorkerRetrieval>('worker/retrieval.ts'),
    loadModule<{ matterBrief(load: () => Promise<unknown>, lookup: (ids: readonly string[]) => Promise<Map<string, CitableDoc>>): Promise<{ text: string; citable: Map<string, CitableDoc> } | null> }>('worker/ask-brief.ts'),
    loadModule<{ loadMatter(env: unknown): Promise<unknown> }>('worker/routes/matter.ts'),
  ]);
  const db = await documentsDb(await cliWrangler('remote').d1Query('SELECT * FROM documents'));
  const files = memoryFiles(MATTER_KEY, await publishedMatter().catch(() => null));
  const search = restSearch(fetcher, account, token);
  for (const item of missing) {
    const [retrieved, brief] = await Promise.all([
      // As the owner reads the room, privileged folders included: the same as counsel (worker/privilege.ts).
      retrieval.retrieve(search, db, item.question, 'owner'),
      matterBrief(() => loadMatter({ FILES: files }), (ids) => retrieval.liveDocuments(db, ids, 'owner')),
    ]);
    cache.set(item.id, {
      key: questionKey(item.question),
      chunks: retrieved.chunks,
      citable: [...retrieved.citable],
      brief: brief ? { text: brief.text, citable: [...brief.citable] } : null,
    });
    log(`retrieved ${item.id}: ${retrieved.chunks.length} passages, ${retrieved.citable.size} documents`);
  }
}

/**
 * The manifest's writers by kind (worker/speaker.ts), read once per run from the published matter as Ask reads it, so
 * an attributed letter or email names its writer as the room would. Names stay in memory; none when no manifest.
 */
export async function replicaSpeakers(): Promise<unknown[]> {
  const [{ speakersOf }, { loadMatter }] = await Promise.all([
    loadModule<{ speakersOf(matter: unknown): unknown[] }>('worker/speaker.ts'),
    loadModule<{ loadMatter(env: unknown): Promise<unknown> }>('worker/routes/matter.ts'),
  ]);
  const matter = await loadMatter({ FILES: memoryFiles(MATTER_KEY, await publishedMatter().catch(() => null)) }).catch(() => null);
  return matter ? speakersOf(matter) : [];
}

/** Bump when the law retrieval rule changes, so cached law passages are retrieved again. */
const LAW_FLOOR_VERSION = 3;

export interface WorkerLaw {
  ASK_LAW_MIN_VECTOR: number;
  retrieveLaw(search: unknown, bucket: unknown, question: string, options?: { minVector?: number }): Promise<{ passages: (LawPassage & LawChunk)[] }>;
  validateLawCitations(answer: string, citable: Map<string, LawChunk>): LawChunk[];
}

/** Law passages for every item that has none cached (--law); the replica's embeddings run under `lease`. */
export async function retrieveLawAll(
  items: readonly EvalItem[],
  cache: Map<string, CachedRetrieval>,
  account: string,
  tokens: TokenSource,
  lease: SpendLease,
  log: (line: string) => void = (line) => console.log(line),
): Promise<void> {
  const missing = items.filter((item) => cache.get(item.id)?.lawFloor !== LAW_FLOOR_VERSION);
  if (missing.length === 0) return;
  const law = await loadModule<WorkerLaw>('worker/law.ts');
  const { search, bucket } = await localLawLibrary(lawDir(), account, tokens, log, lease);
  for (const item of missing) {
    const entry = cache.get(item.id)!; // safe: retrieveAll filled every item
    // The same relevance floor as Ask (worker/law.ts ASK_LAW_MIN_VECTOR), so most record questions get no law.
    entry.lawFloor = LAW_FLOOR_VERSION;
    entry.law = (await law.retrieveLaw(search, bucket, item.question, { minVector: law.ASK_LAW_MIN_VECTOR })).passages;
    log(`law for ${item.id}: ${entry.law.length} passages`);
  }
}

/** Law cites written and valid in one answer (only tags retrieved for its question count as valid). */
export function lawCiteValidity(answer: string, passages: readonly LawChunk[], validate: WorkerLaw['validateLawCitations']): { written: number; valid: number } {
  const written = new Set([...answer.matchAll(/[[【]law:\s*([a-z0-9~-]{3,96})\s*[\]】]/g)].map((m) => m[1])).size;
  return { written, valid: validate(answer, new Map(passages.map((p) => [p.id, p]))).length };
}
