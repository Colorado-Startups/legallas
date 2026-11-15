// SPDX-License-Identifier: Apache-2.0
// Turns a gold question set into the file web/scripts/ask-eval-score.ts reads. The gold set names documents by path;
// the eval's page check names them by control number, which only exist once a room is seeded.
//
//   node quality-speed/pages/data-room/gold/to-eval-set.ts --room <name> --controls <path-to-control.json> --out <file>
//     [--indexed docx,xlsx,pptx] [--single-record]
//
// --controls  a JSON object of document path to control number, written by the seed step
// --indexed   file kinds the room really reads, which lifts their `blockedUntil`
// --single-record  leaves out unknowns that only hold when each room type has its own record
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface GoldSource {
  doc: string;
  /** Null for a Word or Excel file, which has no fixed pages. A PowerPoint source keeps its slide as evidence. */
  page: number | null;
  quote: string;
}

export interface GoldItem {
  id: string;
  kind: 'known' | 'control' | 'injection';
  category?: string;
  /** A scoring class: choice, deadline, people_decision or attribution. */
  class?: string;
  question: string;
  expect: Record<string, unknown>;
  blockedUntil?: string;
  gold: {
    sources?: GoldSource[];
    absent?: string[];
    scope?: 'record' | 'room';
    carrier?: string;
    planted?: string;
    /** The notices section an expectation comes from. */
    notice?: string;
    /** Set when it comes from the owner's recorded answers instead: `owner-2026-11-01`. */
    source?: string;
    /** A choice item: the options a complete answer lays out. */
    options?: string[];
    /** A deadline the record implies but doesn't state, so the check can do the arithmetic. */
    deadline?: { from: string; days: number; due: string };
    derived?: string[];
    /** A deadline item whose question doesn't name the deadline, so the answer has to raise it. */
    unprompted?: boolean;
  };
}

export interface EvalOptions {
  /** Document path to control number. Without it the set scores documents by name, and pages not at all. */
  controls?: Readonly<Record<string, string>>;
  indexed?: readonly string[];
  singleRecord?: boolean;
}

/** The expected documents with their pages, one entry per document. */
function expectedDocs(sources: readonly GoldSource[], controls: Readonly<Record<string, string>>) {
  const byControl = new Map<string, Set<number>>();
  for (const s of sources) {
    const control = controls[s.doc];
    if (!control) throw new Error(`No control number for ${s.doc}`);
    const pages = byControl.get(control) ?? new Set<number>();
    // Only a PDF's page is scored: an Office citation may rightly show no page (#142).
    if (s.page !== null && s.doc.endsWith('.pdf')) pages.add(s.page);
    byControl.set(control, pages);
  }
  return [...byControl].map(([control, pages]) => ({ control, pages: [...pages].sort((a, b) => a - b) }));
}

/** Pure: gold items in, eval items out, with the gold notes dropped. */
export function toEvalSet(items: readonly GoldItem[], options: EvalOptions = {}): Record<string, unknown>[] {
  const lifted = new Set((options.indexed ?? []).map((kind) => `${kind}-indexed`));
  return items
    .filter((item) => !(options.singleRecord && item.gold.scope === 'room'))
    .map((item) => {
      const { gold, blockedUntil, ...rest } = item;
      const sources = gold.sources ?? [];
      const expect = item.kind === 'known' && sources.length > 0 && options.controls
        ? { ...item.expect, docs: expectedDocs(sources, options.controls) }
        : item.expect;
      return { ...rest, expect, ...(blockedUntil && !lifted.has(blockedUntil) ? { blockedUntil } : {}) };
    });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] ?? null : null; };
  const room = get('--room');
  const out = get('--out');
  if (!room || !out) throw new Error('usage: to-eval-set.ts --room <name> --out <file> [--controls <file>] [--indexed docx,xlsx,pptx] [--single-record]');
  const items = JSON.parse(await readFile(path.join(import.meta.dirname, 'questions', `${room}.json`), 'utf8')) as GoldItem[];
  const controlsFile = get('--controls');
  const controls = controlsFile ? (JSON.parse(await readFile(controlsFile, 'utf8')) as Record<string, string>) : undefined;
  const set = toEvalSet(items, { controls, indexed: get('--indexed')?.split(',') ?? [], singleRecord: args.includes('--single-record') });
  await writeFile(out, `${JSON.stringify(set, null, 1)}\n`);
  process.stdout.write(`Eval set ${room}: ${set.length} items in ${out}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
