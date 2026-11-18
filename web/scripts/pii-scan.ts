// SPDX-License-Identifier: Apache-2.0
// The sync's SSN guard (pii.ts rules). Every dry run, and so every --apply, reads the text of each document the
// run sends to Cloudflare: uploads (adds and changes), renames, and documents it (re)indexes. That is the text the
// index would get (PDFs and images through LegallasExtract, cached, which --apply reuses; Markdown, CSV, text and
// JSON as they are; Form D XML and email as rendered and as their raw bodies; office files, privileged ones too,
// since the room still serves them, with the Office parts the index leaves out, such as headers, footnotes, comments
// and the title; iWork files the same, with all the other text they hold) plus the raw body of HTML
// visuals and SVG, and of any other file that reads as text. Files with no readable text (ZIP, audio, video) are
// counted as not scanned. A file that fails to read is refused like a flagged one, since nothing is known about it, and
// listed with what to do about it. The path is always read: it goes into the record and to every connected AI, whatever
// the file holds. Documents staying in the room are read too, once for each version of these rules (PII_RULES_VERSION),
// so a rule that catches more also catches what is already there. A private key is flagged too: the room would serve it.
//
// Nothing prints a number: a path holding one has its digits masked in the plan's table, the guard's lines and the
// details (masked path, page, rule, masked form), which go to <cacheDir>/staging/pii-<run>.json, mode 600. --apply
// refuses while a flagged document is open: each must be redacted, or acknowledged with --allow-pii <sha256> (no blanket
// override), and a known SSN (rule known-hash) can only be redacted. The flags and acknowledgements are part of the plan
// fingerprint.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failureCode } from './checkindex.ts';
import { kindOf, type Kind, type SyncPlan } from './diff.ts';
import { ExtractorUnavailable, indexSource, renderKind, type ExtractedPage } from './extract.ts';
import type { IndexJob } from './indexjob.ts';
import { isPlainKeyFile, iworkCarriedText } from './iwork.ts';
import { zipNames } from './law/docx.ts';
import { officeTextInChild } from './office.ts';
import { cfbStreams, TooLarge, zipText } from './office-read.ts';
import { xmlText } from './ooxml.ts';
import { findPii, maskDigitsOf, pathHits, privateKeyHits, type KnownMatcher, type PiiHit, type PiiRule } from './pii.ts';
import { mapLimit } from './pool.ts';
import type { SnapshotFile } from './snapshot.ts';
import { looksLikeText, readTextFile } from './text-file.ts';

export interface PiiTarget {
  id: string;
  rel: string;
  sha256: string;
  /** The snapshot clone to read. */
  file: string;
  kind: Kind;
}

export interface PiiFinding {
  /** The page of extracted text, null for a raw file body, or FILE_NAME for the document's path. */
  page: number | null;
  rule: PiiRule;
  masked: string;
}

export interface FlaggedDoc {
  id: string;
  path: string;
  sha256: string;
  hits: PiiFinding[];
}

export interface PiiScan {
  scanned: number;
  flagged: FlaggedDoc[];
  unscanned: { path: string; sha256: string; reason: string }[];
}

type ScanHow = 'extractor' | 'direct' | 'raw' | 'parts';

export interface ScanDeps {
  extractPdf: (file: string, sha256: string) => Promise<ExtractedPage[]>;
  readText: (file: string, name: string) => Promise<ExtractedPage[]>;
  known: KnownMatcher | null;
}

/** As buildIndex: OCR is heavy, so two documents at a time. */
const SCAN_CONCURRENCY = 2;

function targetOf(id: string, file: SnapshotFile): PiiTarget {
  return { id, rel: file.rel.normalize('NFC'), sha256: file.sha256, file: file.snapshot, kind: kindOf(file.rel).kind };
}

/** The documents a run sends: adds, changes and renames, and unchanged documents it re-indexes. */
export function piiTargets(plan: SyncPlan<SnapshotFile>, jobs: readonly IndexJob[]): PiiTarget[] {
  const targets = new Map<string, PiiTarget>();
  const add = (id: string, file: SnapshotFile) => targets.set(id, targetOf(id, file));
  for (const op of [...plan.adds, ...plan.changes, ...plan.renames]) add(op.id, op.file);
  const unchanged = new Map(plan.unchanged.map((doc) => [doc.id, doc.file]));
  for (const job of jobs) {
    const file = unchanged.get(job.id);
    if (file && !targets.has(job.id)) add(job.id, file);
  }
  return [...targets.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/**
 * Bump it when these rules or what they read catch more: the next run then reads every document in the room once.
 * 2: spaced dashes, file names, every text encoding and width, Office's other parts, and any other file that reads as text.
 * 3: every XML part of an Office or OpenDocument file, with its attributes, and all of an RTF or .doc file.
 * 4: a .doc's properties, and UTF-16 with no byte order mark that is mostly not Latin.
 * 5: Pages, Numbers and Keynote files, which the index leaves out when they are privileged, and private keys.
 */
export const PII_RULES_VERSION = 5;

const clearedFile = (cacheDir: string, target: string) => path.join(cacheDir, `pii-cleared.${target}.json`);
/** What a cleared document was read under: any change to the known SSNs, not only their count, means reading again (#275). */
const rulesOf = (known: { fingerprint: string } | null) => `${PII_RULES_VERSION}:${known?.fingerprint ?? ''}`;
const clearedKey = (id: string, sha256: string) => `${id}:${sha256}`;

/** The documents these rules and known SSNs have already cleared. Ids and sha256s only, so no name is kept. */
export async function loadCleared(cacheDir: string, target: string, known: { fingerprint: string } | null): Promise<ReadonlySet<string>> {
  // Missing or broken, it clears nothing: the run reads the room again.
  const saved = await readFile(clearedFile(cacheDir, target), 'utf8').then((text) => JSON.parse(text) as { rules?: unknown; docs?: unknown }).catch(() => null);
  return new Set(saved?.rules === rulesOf(known) && Array.isArray(saved.docs) ? (saved.docs as string[]) : []);
}

/** Records every document this plan leaves live as cleared. Called once a run has passed the gate. */
export async function saveCleared(cacheDir: string, target: string, known: { fingerprint: string } | null, plan: SyncPlan<SnapshotFile>): Promise<void> {
  const docs = [...plan.adds, ...plan.changes, ...plan.renames, ...plan.unchanged].map((doc) => clearedKey(doc.id, doc.file.sha256));
  await writeFile(clearedFile(cacheDir, target), JSON.stringify({ rules: rulesOf(known), docs }), { mode: 0o600 });
}

/** Documents staying in the room that these rules have not cleared, and that `sent` does not read already. */
export function unreadTargets(plan: SyncPlan<SnapshotFile>, sent: readonly PiiTarget[], cleared: ReadonlySet<string>): PiiTarget[] {
  const ids = new Set(sent.map((target) => target.id));
  return plan.unchanged.filter((doc) => !ids.has(doc.id) && !cleared.has(clearedKey(doc.id, doc.file.sha256))).map((doc) => targetOf(doc.id, doc.file));
}

/**
 * A file of XML parts in a zip: Word, Excel, PowerPoint and OpenDocument, with their macro-enabled and template forms. The
 * room serves the whole file, so the guard reads every part, under whatever name.
 */
const OFFICE_ZIP = /\.(?:do[ct][xm]|xl[st][xm]|p(?:pt|ot|ps)[xm]|o[dt][tspg])$/i;

/**
 * How the guard reads a document: as the index would, or its raw body (HTML visuals, SVG), or its parts alone (an Office
 * file the index doesn't read); null when it cannot.
 */
export function scanRead(kind: Kind, rel: string): ScanHow | null {
  if (kind === 'visual' || /\.svg$/i.test(rel)) return 'raw';
  return indexSource(kind, rel) ?? (OFFICE_ZIP.test(rel) ? 'parts' : null);
}

/** PiiFinding.page for a hit in the document's path. */
const FILE_NAME = 0;
/** How an unscanned document's reason starts when reading it failed, as against a format with no readable text. */
const FAILED = 'failed: ';

const XML_PART = /\.(?:xml|rels|vml)$/i;
/** Past either limit a file is refused, not read in part. */
const MAX_XML_BYTES = 256 * 1024 * 1024;
const MAX_XML_PARTS = 20_000;
/** A cell's place or a shape's position: a big sheet holds millions, and none is an SSN. */
const SHORT_NUMBER = /^-?[A-Z]{0,3}\d{1,8}(?:\.\d+)?$/;

/**
 * One XML part read two ways, so neither hides a number from the other. First as lines, because Word splits a line into
 * runs and the tags between them join what they split. Then piece by piece, each attribute value and stretch of text on
 * its own, because a deletion can sit against a digit, and attributes hold alt text, form defaults and a pivot table's copy
 * of its data.
 */
function xmlReadings(xml: string): string[] {
  // Each removal runs again until nothing is left to remove: taking one marker or tag out can join the text around it into another.
  let open = xml;
  for (let before = ''; before !== open; ) {
    before = open;
    open = open.replace(/<!\[CDATA\[|\]\]>|<!--|--!?>/g, '');
  }
  let lines = open.replace(/<\/(?:[\w.-]+:)?(?:p|tr|row|si|c)>/g, '\n');
  for (let before = ''; before !== lines; ) {
    before = lines;
    lines = lines.replace(/<[^<>]+>/g, '');
  }
  let pieces = '';
  for (const [, double, single, text] of open.matchAll(/=\s*"([^"]*)"|=\s*'([^']*)'|>([^<>]+)/g)) {
    const piece = double ?? single ?? text ?? '';
    if (!SHORT_NUMBER.test(piece)) pieces += `${piece}\n`;
  }
  return [xmlText(lines), xmlText(pieces)];
}

/**
 * Every XML part of a zip, each as its readings, one part at a time (#611): a part's text can go once it is scanned, so
 * memory holds the largest part, not all of them. A zip with none isn't one of these files, and fails: nothing read isn't clean.
 */
export function* officeParts(zip: Buffer, maxBytes = MAX_XML_BYTES, maxParts = MAX_XML_PARTS): Generator<string> {
  const names = zipNames(zip).filter((name) => XML_PART.test(name));
  if (names.length === 0) throw new Error('office text failed: unreadable');
  if (names.length > maxParts) throw new TooLarge('too-large');
  let left = maxBytes;
  for (const name of names) {
    const xml = zipText(zip, name);
    left -= Buffer.byteLength(xml);
    if (left < 0) throw new TooLarge('too-large');
    yield* xmlReadings(xml);
  }
}

/** Every reading of `officeParts` at once. */
export function officeXml(zip: Buffer, maxBytes = MAX_XML_BYTES, maxParts = MAX_XML_PARTS): string[] {
  return [...officeParts(zip, maxBytes, maxParts)];
}

/** An RTF file's text with its control words gone, so formatting joins what it split and no group is skipped. */
const rtfWords = (rtf: string) => rtf.replace(/\\[a-zA-Z]+-?\d* ?|[{}]/g, '');

/** A .doc's title, author and other properties (#275): its property streams read as single-byte and as UTF-16 text. */
export function docProperties(file: Buffer): string[] {
  const streams = cfbStreams(file, ['\u0005SummaryInformation', '\u0005DocumentSummaryInformation']);
  return [...streams.values()].flatMap((bytes) => [bytes.toString('latin1'), bytes.toString('utf16le')].map((text) => text.replace(/[\0-\x08\x0e-\x1f]+/g, '\n')));
}

/** What the index's reader may leave out of an office file: on a Mac, textutil returns little more than the body. */
async function* officeWhole(file: string, name: string): AsyncGenerator<string> {
  if (OFFICE_ZIP.test(name)) yield* officeParts(await readFile(file));
  else if (/\.rtf$/i.test(name)) yield rtfWords(await readTextFile(file));
  else if (/\.doc$/i.test(name)) {
    yield await officeTextInChild(file, 'doc');
    yield* docProperties(await readFile(file));
  }
}

/** A target's texts, one at a time, so each can be scanned and dropped before the next is read. */
async function* textsOf(target: PiiTarget, how: ScanHow, deps: ScanDeps): AsyncGenerator<{ page: number | null; text: string }> {
  if (how === 'raw') {
    yield { page: null, text: await readTextFile(target.file) };
    return;
  }
  if (how === 'parts') {
    for (const text of officeParts(await readFile(target.file))) yield { page: null, text };
    return;
  }
  const name = path.posix.basename(target.rel);
  const pages = how === 'extractor' ? await deps.extractPdf(target.file, target.sha256) : await deps.readText(target.file, name);
  for (const page of pages) yield { page: page.n, text: page.text };
  // Form D XML and email are indexed as rendered text; their raw bodies are served too, so both are read. XML that
  // is not a Form D was read as it is already.
  const kind = renderKind(name);
  if ((kind === 'formd' || kind === 'email') && pages.some((page) => page.rendered)) yield { page: null, text: await readTextFile(target.file) };
  for await (const text of officeWhole(target.file, name)) yield { page: null, text };
  // Text an iWork file holds but does not show still leaves with the file when the room serves it.
  if (kind === 'iwork') yield { page: null, text: await iworkCarriedText(target.file) };
}

function unscannedReason(rel: string): string {
  return path.posix.extname(rel).slice(1).toLowerCase() || 'no extension';
}

/** A file the index does not read and whose name says nothing about its type, such as .tsv, .log or .yml, read by its bytes. */
async function scanHow(target: PiiTarget): Promise<ScanHow | null> {
  const plainKey = await isPlainKeyFile(target.file, target.rel);
  const how = plainKey ? null : scanRead(target.kind, target.rel);
  if (how !== null || (!plainKey && kindOf(target.rel).contentType !== 'application/octet-stream')) return how;
  return (await looksLikeText(target.file)) ? 'raw' : null;
}

/** Scans every target. Only ExtractorUnavailable stops the scan: without LegallasExtract no PDF can be read. */
export async function scanForPii(targets: readonly PiiTarget[], deps: ScanDeps): Promise<PiiScan> {
  const scan: PiiScan = { scanned: 0, flagged: [], unscanned: [] };
  await mapLimit(targets, SCAN_CONCURRENCY, async (target) => {
    const skip = (reason: string): void => {
      scan.unscanned.push({ path: target.rel, sha256: target.sha256, reason });
    };
    const seen = new Set<string>();
    const hits: PiiFinding[] = [];
    const note = (page: number | null, found: readonly PiiHit[]) => {
      for (const hit of found) {
        const key = `${page}\0${hit.rule}\0${hit.masked}`;
        if (!seen.has(key)) hits.push({ page, rule: hit.rule, masked: hit.masked });
        seen.add(key);
      }
    };
    // Before the file is touched, so a name is judged even when the file cannot be read.
    note(FILE_NAME, pathHits(target.rel, deps.known));
    try {
      const how = await scanHow(target);
      if (how) {
        // Kept apart until the file is read through, so a file that fails part way reports the failure alone, as before.
        const found: [number | null, PiiHit[]][] = [];
        for await (const { page, text } of textsOf(target, how, deps)) found.push([page, [...(await findPii(text, deps.known)), ...privateKeyHits(text)]]);
        for (const [page, hits] of found) note(page, hits);
        scan.scanned += 1;
      } else skip(unscannedReason(target.rel));
    } catch (error) {
      if (error instanceof ExtractorUnavailable) throw new ExtractorUnavailable(`SSN guard: cannot read PDFs and images (${error.message}). Nothing was changed.`);
      skip(`${FAILED}${failureCode(error)}`);
    }
    if (hits.length > 0) scan.flagged.push({ id: target.id, path: target.rel, sha256: target.sha256, hits });
  });
  const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  scan.flagged.sort(byPath);
  scan.unscanned.sort(byPath);
  return scan;
}

export interface PiiGate {
  /** Flagged and neither acknowledged nor holding a known SSN. */
  open: FlaggedDoc[];
  acknowledged: FlaggedDoc[];
  /** Holding a known SSN (rule known-hash): only a redaction clears these. */
  known: FlaggedDoc[];
  /** Could not be read, so nothing is known about them, and not acknowledged. */
  failed: PiiScan['unscanned'];
  /** --allow-pii values that match no flagged document. */
  unused: string[];
}

export function piiGate(scan: PiiScan, allow: readonly string[]): PiiGate {
  const allowed = new Set(allow);
  const known = scan.flagged.filter((doc) => doc.hits.some((hit) => hit.rule === 'known-hash'));
  const rest = scan.flagged.filter((doc) => !known.includes(doc));
  const failed = scan.unscanned.filter((doc) => doc.reason.startsWith(FAILED));
  const flagged = new Set([...scan.flagged, ...failed].map((doc) => doc.sha256));
  return {
    open: rest.filter((doc) => !allowed.has(doc.sha256)),
    acknowledged: rest.filter((doc) => allowed.has(doc.sha256)),
    known,
    failed: failed.filter((doc) => !allowed.has(doc.sha256)),
    unused: [...allowed].filter((sha) => !flagged.has(sha)).sort(),
  };
}

/** Why --apply must stop, or null when every flag is cleared. */
export function piiRefusal(gate: PiiGate): string | null {
  const reasons = [
    gate.known.length > 0 ? `${gate.known.length} hold a known SSN and must be redacted (a known SSN cannot be acknowledged)` : '',
    gate.open.length > 0 ? `${gate.open.length} are flagged and not acknowledged (redact them, or pass --allow-pii <sha256> for each)` : '',
    gate.failed.length > 0 ? `${gate.failed.length} could not be read, so were not checked (fix the file, or pass --allow-pii <sha256> for each)` : '',
    gate.unused.length > 0 ? `${gate.unused.length} --allow-pii values match no flagged document` : '',
  ].filter(Boolean);
  return reasons.length === 0 ? null : `SSN guard: ${reasons.join('; ')}. Nothing was changed.`;
}

function hitRules(doc: FlaggedDoc): string[] {
  return [...new Set(doc.hits.map((hit) => hit.rule))].sort();
}

/** Fingerprint entries: each flag (path, sha256, rules, hit count) and each acknowledgement. */
export function piiFingerprintEntries(scan: PiiScan, allow: readonly string[]): string[] {
  return [
    ...scan.flagged.map((doc) => `pii\0${doc.path}\0${doc.sha256}\0${hitRules(doc).join(',')}\0${doc.hits.length}`),
    ...scan.unscanned.filter((doc) => doc.reason.startsWith(FAILED)).map((doc) => `unread\0${doc.path}\0${doc.sha256}`),
    ...[...new Set(allow)].map((sha) => `allow-pii\0${sha}`),
  ];
}

function statusOf(doc: FlaggedDoc, gate: PiiGate): 'known SSN' | 'acknowledged' | 'open' {
  return gate.known.includes(doc) ? 'known SSN' : gate.acknowledged.includes(doc) ? 'acknowledged' : 'open';
}

/** How the guard prints a path: with its digits masked when one of them is the number it caught. */
function printer(scan: PiiScan): (rel: string) => string {
  const named = new Set(scan.flagged.filter((doc) => doc.hits.some((hit) => hit.page === FILE_NAME)).map((doc) => doc.path));
  return (rel) => (named.has(rel) ? maskDigitsOf(rel) : rel);
}

function describe(doc: FlaggedDoc): string {
  const counts = hitRules(doc).map((rule) => `${rule} ${doc.hits.filter((hit) => hit.rule === rule).length}`);
  const pages = [...new Set(doc.hits.map((hit) => (hit.page === FILE_NAME ? 'file name' : hit.page === null ? 'body' : `p. ${hit.page}`)))];
  return `${counts.join(', ')}; ${pages.join(', ')}`;
}

/** What a person can do about a file whose read failed, by reason. A reason not here is printed as it is. */
const WHAT_TO_DO: Record<string, string> = {
  'failed: password': 'locked with a password. Remove it in the app, or export a PDF, then sync again',
  'failed: old-format': 'saved by a very old version of the app. Open it and save it again',
  'failed: not-iwork': 'not a Pages, Numbers or Keynote file, only named like one. Rename it, or take it out of the folder',
  'failed: too-large': 'too large to read. Export a PDF',
  'failed: timeout': 'took too long to read. Export a PDF',
  'failed: unreadable': 'damaged, or still downloading. Open it in the app, or sync again',
};

/** The terminal lines: counts, statuses, sha256s and paths (not with --summary). Never a number. */
export function formatPiiReport(scan: PiiScan, gate: PiiGate, details: string | null, summary: boolean, known: { size: number; hashed: number } | null): string[] {
  const shown = printer(scan);
  const reasons = new Map<string, number>();
  for (const skip of scan.unscanned) reasons.set(skip.reason, (reasons.get(skip.reason) ?? 0) + 1);
  const lines = [
    `SSN guard: ${scan.scanned} documents scanned (uploads, renames, re-indexed documents and any these rules have not read)` +
      (known ? `; ${known.hashed} nine-digit sequences checked against ${known.size} known hashes` : '; no known hashes configured') + '.',
  ];
  if (reasons.size > 0) lines.push(`  Not scanned (no readable text): ${[...reasons].sort().map(([reason, n]) => `${reason} ${n}`).join(', ')}`);
  if (scan.flagged.length === 0) lines.push('  Nothing flagged.');
  else {
    lines.push(`  Flagged: ${scan.flagged.length} (${gate.open.length} open, ${gate.acknowledged.length} acknowledged, ${gate.known.length} with a known SSN)`);
    if (!summary) for (const doc of scan.flagged) lines.push(`    ${statusOf(doc, gate).padEnd(12)} ${doc.sha256}  ${shown(doc.path)}  (${describe(doc)})`);
    if (gate.open.length + gate.known.length > 0) {
      lines.push('  --apply refuses until each open document is redacted or acknowledged with --allow-pii <sha256>, and each known SSN is redacted.');
    }
    if (scan.flagged.some((doc) => doc.hits.some((hit) => hit.rule === 'private-key'))) {
      lines.push('  A private key is a secret, and the room would serve it to every member: take it out of the shared folder, then sync again.');
    }
  }
  if (gate.failed.length > 0) {
    lines.push(`  Could not read, so not checked: ${gate.failed.length}. --apply refuses until each is fixed, or acknowledged with --allow-pii <sha256> on every sync until it is.`);
    if (!summary) for (const doc of gate.failed) lines.push(`    unread       ${doc.sha256}  ${shown(doc.path)}  (${WHAT_TO_DO[doc.reason] ?? doc.reason})`);
  }
  if (gate.unused.length > 0) lines.push(`  --allow-pii matching no flagged document: ${gate.unused.join(' ')}`);
  if (details) lines.push(`  Details (masked, mode 600): ${details}`);
  return lines;
}

/** Writes the details file and returns its path. Masked forms and masked paths only; paths are case content, so mode 600. */
export async function writePiiDetails(cacheDir: string, runId: string, scan: PiiScan, gate: PiiGate, target: string): Promise<string> {
  const dir = path.join(cacheDir, 'staging');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `pii-${runId}.json`);
  const shown = printer(scan);
  const flagged = scan.flagged.map((doc) => ({ status: statusOf(doc, gate), ...doc, path: shown(doc.path) }));
  const unscanned = scan.unscanned.map((doc) => ({ ...doc, path: shown(doc.path) }));
  const body = { target, createdAt: new Date().toISOString(), flagged, unscanned, unusedAllowPii: gate.unused };
  await writeFile(file, `${JSON.stringify(body, null, 1)}\n`, { mode: 0o600, flag: 'wx' });
  return file;
}
