// SPDX-License-Identifier: Apache-2.0
// Eval v2 around the Ask replica (scripts/ask-replica.ts) and the rescorer (scripts/ask-eval-rescore.ts): planted
// injection passages (--plant), the scoring context (control prefix, the extractor's page text) and the report
// files. Planted text lives only in the replica's in-memory retrieval: never in the cache, a report or a log.
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CitableDoc } from '../worker/passages.ts';
import type { PromptChunk } from '../worker/prompt.ts';
import { PLANTED_PREFIX, type PageText } from './ask-eval-checks.ts';
import { buildReport, compareReports, formatAggregates, formatReport, type EvalReport, type ScoredRun } from './ask-eval-report.ts';
import type { EvalItem } from './ask-eval-score.ts';
import { DEFAULT_CONFIG_PATH } from './config.ts';
import { marker, neutralizeMarkers } from './indexparts.ts';

/** Where a planted passage sits among the retrieved passages (1-based), as an injected document might rank. */
export const PLANT_RANK = 3;
/** The planted document's name in the prompt: a plain file name that says nothing about the test. */
export const PLANTED_NAME = 'Note.pdf';
export const plantedId = (itemId: string): string => `${PLANTED_PREFIX}${itemId}`;

/**
 * The item's planted passage inserted at PLANT_RANK as a citable one-page document, fenced exactly like a real
 * passage: a page marker, then the text with "[[" broken up as the indexer does (scripts/indexparts.ts). Items
 * without a planted passage get the retrieval back unchanged. Nothing is written anywhere.
 */
export function plant(
  item: Pick<EvalItem, 'id' | 'plantedPassage'>,
  chunks: readonly PromptChunk[],
  citable: ReadonlyMap<string, CitableDoc>,
): { chunks: PromptChunk[]; citable: Map<string, CitableDoc> } {
  if (item.plantedPassage === undefined) return { chunks: [...chunks], citable: new Map(citable) };
  const id = plantedId(item.id);
  const chunk: PromptChunk = { docId: id, name: PLANTED_NAME, text: `${marker(id, 1)}\n${neutralizeMarkers(item.plantedPassage).trim()}\n\n` };
  const at = Math.min(PLANT_RANK - 1, chunks.length);
  return {
    chunks: [...chunks.slice(0, at), chunk, ...chunks.slice(at)],
    citable: new Map([...citable, [id, { id, name: PLANTED_NAME, pages: 1, control_seq: null }]]),
  };
}

/** controlPrefix from legallas.config.json, when set. The value is never written into source. */
export async function controlPrefix(file = DEFAULT_CONFIG_PATH): Promise<string | undefined> {
  const raw = (await readFile(file, 'utf8').then(JSON.parse).catch(() => ({}))) as { controlPrefix?: unknown };
  return typeof raw.controlPrefix === 'string' && /^[A-Z]{2,6}$/.test(raw.controlPrefix) ? raw.controlPrefix : undefined;
}

/** Document id to sha256 from `SELECT id, sha256 FROM documents` rows (counsel uploads have none). */
export function shaById(rows: readonly Record<string, unknown>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) if (typeof row.id === 'string' && typeof row.sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.sha256)) out.set(row.id, row.sha256);
  return out;
}

/**
 * Page text from the extractor's cache (<cacheDir>/text/<sha256>.json: {version, sha256, pages: [{n, text, ocr}]}),
 * read lazily, each file once. Null for a document or page the cache does not hold.
 */
export function textCachePages(dir: string, shas: ReadonlyMap<string, string>, read: (file: string) => string = (file) => readFileSync(file, 'utf8')) {
  const files = new Map<string, Map<number, PageText> | null>();
  const load = (sha: string): Map<number, PageText> | null => {
    if (files.has(sha)) return files.get(sha)!; // safe: has() checked
    let pages: Map<number, PageText> | null = null;
    try {
      const parsed = JSON.parse(read(path.join(dir, `${sha}.json`))) as { pages?: { n?: unknown; text?: unknown; ocr?: unknown }[] };
      pages = new Map();
      for (const p of parsed.pages ?? []) if (typeof p.n === 'number' && typeof p.text === 'string') pages.set(p.n, { text: p.text, ocr: p.ocr === true });
    } catch {
      pages = null;
    }
    files.set(sha, pages);
    return pages;
  };
  return (id: string, page: number): PageText | null => {
    const sha = shas.get(id);
    return sha ? (load(sha)?.get(page) ?? null) : null;
  };
}

/** An earlier v2 report for --compare; anything else is refused by name, never echoed. */
export async function readReport(file: string): Promise<EvalReport> {
  const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<EvalReport>;
  if (parsed.version !== 2 || !Array.isArray(parsed.items)) throw new Error('--compare needs an eval v2 report (report-*.json)');
  return parsed as EvalReport;
}

/**
 * Builds the report, adds flips against `compare` when given and the planned answer count when known, writes
 * report-<slug>-<time>.json and .md under `dir` (mode 600) and returns the aggregate lines that may print.
 */
export async function writeReport(
  dir: string,
  slug: string,
  label: string,
  runs: readonly ScoredRun[],
  cost: { neurons: number; usd: number } | null,
  compare: string | null,
  planned?: number,
): Promise<{ lines: string[]; json: string; md: string }> {
  const report = buildReport(label, runs, cost);
  if (compare) report.flips = compareReports(await readReport(compare), report);
  if (planned !== undefined) report.planned = planned;
  const stamp = report.at.replace(/[:.]/g, '-');
  const json = path.join(dir, `report-${slug}-${stamp}.json`);
  const md = path.join(dir, `report-${slug}-${stamp}.md`);
  await writeFile(json, JSON.stringify(report, null, 1), { mode: 0o600 });
  await writeFile(md, formatReport(report), { mode: 0o600 });
  return { lines: formatAggregates(report), json, md };
}
