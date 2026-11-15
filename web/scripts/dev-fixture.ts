// SPDX-License-Identifier: Apache-2.0
// Card F9. Writes a scratch Doe v. Harbor Labs, Inc. source folder for local development: about fifty dummy
// files in 00-11 folders at the exact paths of web/fixtures/doc-ids.json (PDFs with a text layer, three XLSX), plus
// Markdown, CSV, one PNG, one SEC Form D in EDGAR XML, a PRIVILEGED folder, the document catalog and a CLAUDE.md
// folder guide.
//
//   node scripts/dev-fixture.ts [--out <dir>]     default: <os temp>/legallas-dev/<worktree hash>/source
//
// The folder is always outside the repo (and outside any git checkout). Files are rewritten only when their
// bytes change, so a second run leaves every sha256 alone and the next local sync has nothing to do. Files the
// plan no longer lists are removed, but only from a folder this script created (it holds a marker dotfile).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FORM_D_FIXTURE_NAME, FORM_D_FIXTURE_XML } from '../src/scripts/formd.test-data.ts';
import type { Matter } from '../worker/matter-types.ts';
import { companyFixtureFiles } from './dev-fixture-company.ts';
import { pdfBytes, pngBytes, xlsxBytes } from './dev-pdf.ts';
import {
  citedLines, definedTermsPage, documentPages, FOLDER_GUIDE, MATTER_SUMMARY, pathById, PRIVILEGED_MEMO, PRIVILEGED_NOTES, TRANSACTIONS_CSV,
} from './dev-fixture-text.ts';
import { CATALOG_COLUMNS, CATALOG_REL } from './matter/catalog.ts';

export const WEB_DIR = path.resolve(import.meta.dirname, '..');
export const REPO_ROOT = path.resolve(WEB_DIR, '..');
export const FIXTURES_DIR = path.join(WEB_DIR, 'fixtures');
/** A dotfile (sync skips dotfiles) that marks a folder as ours to rewrite and prune. */
export const MARKER = '.legallas-dev-fixture';

export interface FixtureInputs {
  /** documents path -> fixture document id (web/fixtures/doc-ids.json). */
  docIds: Record<string, string>;
  /** F2's fixture manifest (web/fixtures/matter.example.json), cites by fixture id. */
  matter: Matter;
}

export interface FixtureFile {
  rel: string;
  bytes: Buffer;
}

export async function loadFixtureInputs(dir = FIXTURES_DIR): Promise<FixtureInputs> {
  const read = async (name: string) => JSON.parse(await readFile(path.join(dir, name), 'utf8')) as unknown;
  return { docIds: (await read('doc-ids.json')) as Record<string, string>, matter: (await read('matter.example.json')) as Matter };
}

/** The per-worktree scratch root: parallel worktrees each have their own local D1 and R2, so they never share it. */
export function defaultDevRoot(webDir = WEB_DIR, base = tmpdir()): string {
  return path.join(base, 'legallas-dev', createHash('sha256').update(webDir).digest('hex').slice(0, 10));
}

const csvField = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The catalog rows for the fixture documents, in CATALOG_COLUMNS order. Sizes and md5s are the real bytes. */
export function catalogCsv(inputs: FixtureInputs, files: readonly FixtureFile[]): string {
  const ids = pathById(inputs.docIds);
  const names = new Map<string, string>([...inputs.matter.people, ...inputs.matter.orgs].map((x) => [x.id, x.name]));
  const bytes = new Map(files.map((f) => [f.rel, f.bytes]));
  const rows = Object.entries(inputs.matter.docs).flatMap(([id, facts]) => {
    const rel = ids.get(id);
    const data = rel ? bytes.get(rel) : undefined;
    if (!rel || !data) return [];
    const filename = path.posix.basename(rel);
    const parties = [...facts.from, ...facts.to].map((p) => names.get(p) ?? '').filter(Boolean).join('; ');
    return [[
      rel, rel.slice(0, 2), filename, path.posix.extname(filename).slice(1), String(data.length),
      createHash('md5').update(data).digest('hex'), 'unique', facts.privileged ? 'Attorney work product' : 'None',
      facts.summary ?? '', facts.date ?? '', parties, 'yes',
    ]];
  });
  return [CATALOG_COLUMNS.join(','), ...rows.sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((r) => r.map(csvField).join(','))].join('\n') + '\n';
}

function documentFile(rel: string, inputs: FixtureInputs, cited: ReturnType<typeof citedLines>): FixtureFile {
  const facts = inputs.matter.docs[inputs.docIds[rel]];
  if (rel.endsWith('.xlsx')) {
    return { rel, bytes: xlsxBytes([['Fixture workbook', path.posix.basename(rel)], ['Row', 'Value'], ['1', 'Dummy data for local development']]) };
  }
  return { rel, bytes: pdfBytes(documentPages(rel, cited.get(rel), facts?.summary ?? null)) };
}

/** Every file of the fixture folder, in path order. Pure and deterministic. */
export function fixtureFiles(inputs: FixtureInputs): FixtureFile[] {
  const cited = citedLines(inputs.matter, pathById(inputs.docIds));
  const files: FixtureFile[] = Object.keys(inputs.docIds).map((rel) => documentFile(rel, inputs, cited));
  const text = (rel: string, body: string): FixtureFile => ({ rel, bytes: Buffer.from(body, 'utf8') });
  files.push(
    text('CLAUDE.md', FOLDER_GUIDE),
    text('00-Orientation/Matter-Summary.md', MATTER_SUMMARY),
    { rel: '05-Expense-Records/Receipt-Photo__20120203__Pat-Teller.png', bytes: pngBytes(96, 64, ['FAF7F0', 'A98B4F', '1F3A2E']) },
    text('06-Cap-Table/Transactions__2012__Acme-Bank.csv', TRANSACTIONS_CSV),
    text(`01-Corporate-Records/${FORM_D_FIXTURE_NAME}`, FORM_D_FIXTURE_XML),
    { rel: '07-Lawyer-Notes-PRIVILEGED/Memo__20130423__Lisa-Low__Case-plan.pdf', bytes: pdfBytes(PRIVILEGED_MEMO) },
    text('07-Lawyer-Notes-PRIVILEGED/Call-Notes__20130507__Lisa-Low.md', PRIVILEGED_NOTES),
    text('00-Orientation/Defined-Terms.md', definedTermsPage(inputs.matter)),
  );
  files.push(text(CATALOG_REL, catalogCsv(inputs, files)));
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Refuses a relative path, anything inside the repo or another git checkout, and a non-empty folder not ours. */
export async function assertScratchFolder(out: string, repoRoot = REPO_ROOT): Promise<void> {
  if (!path.isAbsolute(out)) throw new Error('The fixture folder must be an absolute path');
  if (isInside(out, repoRoot)) throw new Error('Refusing to write the fixture inside the repository');
  for (let dir = out; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) throw new Error('Refusing to write the fixture inside a git checkout');
    if (path.dirname(dir) === dir) break;
  }
  const names = await readdir(out).catch(() => [] as string[]);
  if (names.length > 0 && !names.includes(MARKER)) throw new Error(`${out} is not empty and was not made by dev-fixture; pick another --out`);
}

export interface WriteSummary {
  written: number;
  unchanged: number;
  removed: number;
}

/** Writes the plan into `out` (changed files only) and prunes files the plan no longer lists. */
export async function writeFixture(out: string, files: readonly FixtureFile[]): Promise<WriteSummary> {
  await assertScratchFolder(out);
  await mkdir(out, { recursive: true, mode: 0o700 });
  await writeFile(path.join(out, MARKER), 'Made by web/scripts/dev-fixture.ts. Safe to delete.\n');
  const summary: WriteSummary = { written: 0, unchanged: 0, removed: 0 };
  const wanted = new Set(files.map((f) => f.rel));
  for (const file of files) {
    const abs = path.join(out, file.rel);
    const current = await readFile(abs).catch(() => null);
    if (current?.equals(file.bytes)) {
      summary.unchanged += 1;
      continue;
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.bytes);
    summary.written += 1;
  }
  for (const entry of await readdir(out, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name === MARKER) continue;
    const rel = path.relative(out, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
    if (!wanted.has(rel)) {
      await rm(path.join(out, rel));
      summary.removed += 1;
    }
  }
  return summary;
}

/** `--out <dir>`, or the default scratch source folder. */
export function parseFixtureArgs(args: readonly string[], fallback = path.join(defaultDevRoot(), 'source')): { out: string } {
  if (args.length === 0) return { out: fallback };
  if (args.length === 2 && args[0] === '--out' && args[1]) return { out: path.resolve(args[1]) };
  throw new Error('usage: node scripts/dev-fixture.ts [--out <dir>]');
}

/** Which fixture to build: Doe v. Harbor Labs with its matter, or the same company with no matter (dev-fixture-company.ts). */
export type FixtureKind = 'case' | 'company';

/** Builds and writes the fixture; returns the folder and what changed. */
export async function makeFixture(out: string, kind: FixtureKind = 'case'): Promise<WriteSummary & { out: string; files: number }> {
  const files = kind === 'company' ? companyFixtureFiles() : fixtureFiles(await loadFixtureInputs());
  return { out, files: files.length, ...(await writeFixture(out, files)) };
}

if (import.meta.main) {
  makeFixture(parseFixtureArgs(process.argv.slice(2)).out)
    .then((r) => process.stdout.write(`Fixture: ${r.files} files in ${r.out} (${r.written} written, ${r.unchanged} unchanged, ${r.removed} removed)\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
