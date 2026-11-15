// SPDX-License-Identifier: Apache-2.0
// The gold record: the dev fixture's files plus the invented documents here, as one folder per room type. It sits
// beside the fixture rather than inside it, because the fixture's own tests cap its size and the rest of the repo
// depends on its shape. Pure apart from main.
//
//   node quality-speed/pages/data-room/gold/build.ts --room <forming|raising-angel|raising-vc|dispute|all> --out <dir> [--inputs <dir>]
//
// `all` is the whole record, the same files as `dispute`. --out takes the same scratch folder rules as
// web/scripts/dev-fixture.ts, and so does --inputs. --inputs also writes the room's doc-ids.json and, for a dispute only, its matter.json:
// the matter holds the dispute's events and claims, so any other room gets none, and asking it about the dispute
// stays a real unknown. That matter.json passes the matter build as it stands.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ANGEL_DOCS } from './documents/angels.ts';
import { DISPUTE_DOCS } from './documents/dispute.ts';
import { FORMING_DOCS } from './documents/forming.ts';
import { FICTIONAL, type GoldDoc } from './documents/types.ts';
import { VC_DOCS } from './documents/vc.ts';
import { docxBytes, pptxBytes } from './office.ts';
import { catalog, devFixture, devPdf, fixtureText, type FixtureFile, type FixtureInputs, type Named } from './web.ts';

const { CATALOG_REL } = catalog;
const { assertScratchFolder, catalogCsv, fixtureFiles, loadFixtureInputs, MARKER, writeFixture } = devFixture;
const { pdfBytes, xlsxBytes } = devPdf;
const { citedLines, documentPages, FOLDER_GUIDE, pathById } = fixtureText;

export const ROOM_NAMES = ['forming', 'raising-angel', 'raising-vc', 'dispute'] as const;
export type RoomName = (typeof ROOM_NAMES)[number];

export interface RoomSpec {
  label: string;
  folders: string[] | 'all';
  existing: string[] | 'all';
  /** Single gold documents from a folder the room doesn't otherwise hold. */
  files?: string[];
  /** What an invited investor sees: whole folders, compared exactly, the way a deal room works. */
  guestFolders: string[];
}

export const GOLD_DIR = import.meta.dirname;
export const GOLD_DOCS: GoldDoc[] = [...FORMING_DOCS, ...ANGEL_DOCS, ...VC_DOCS, ...DISPUTE_DOCS];

export async function loadRooms(dir = GOLD_DIR): Promise<Record<RoomName, RoomSpec>> {
  return JSON.parse(await readFile(path.join(dir, 'rooms.json'), 'utf8')) as Record<RoomName, RoomSpec>;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A stable UUID-shaped id from the path, so a rebuild never changes a document's identity. */
export function goldDocId(rel: string): string {
  const h = createHash('sha256').update(`gold:${rel}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The text of each page of a new document, as it lands in the file: the fictional line and page number included. */
export function goldPages(doc: GoldDoc): string[][] {
  if (doc.rows) return [[FICTIONAL, ...doc.rows.map((row) => row.filter(Boolean).join(' | '))]];
  const pages = doc.pages ?? [];
  if (doc.path.endsWith('.pptx')) return pages.map((slide) => [...slide, FICTIONAL]);
  if (doc.path.endsWith('.docx')) return [[FICTIONAL, ...pages.flat()]];
  return pages.map((lines, i) => [FICTIONAL, `Page ${i + 1} of ${pages.length}`, '', ...lines]);
}

export function goldFile(doc: GoldDoc): FixtureFile {
  const pages = goldPages(doc);
  if (doc.path.endsWith('.pdf')) return { rel: doc.path, bytes: pdfBytes(pages) };
  if (doc.path.endsWith('.docx')) return { rel: doc.path, bytes: docxBytes(pages[0] ?? []) };
  if (doc.path.endsWith('.pptx')) return { rel: doc.path, bytes: pptxBytes(pages) };
  if (doc.path.endsWith('.xlsx')) return { rel: doc.path, bytes: xlsxBytes([[FICTIONAL], ...(doc.rows ?? [])]) };
  throw new Error(`No writer for ${doc.path}`);
}

const PEOPLE = new Set(['Ada Auditor', 'Angie Angel', 'Frank Filer', 'Gus Group', 'Holly Hire', 'Ivy Insight', 'Sam Seed', 'Tina Title']);
const AGENCIES = new Set(['Colorado Division of Securities', 'Colorado Secretary of State', 'Delaware Secretary of State', 'Internal Revenue Service', 'Securities and Exchange Commission', 'United States Patent and Trademark Office']);
/** An audience or an unnamed author. The catalog's parties column shows it, but it isn't a party, so a manifest leaves it out. */
export const NOT_PARTIES = new Set(['All counsel', 'Customers', 'Former colleague', 'Prospective angels', 'Prospective investors', 'Readers', 'Unknown Analyst', 'Unknown Broker', 'Unknown sender']);

const partyId = (name: string) => `gold-${slug(name)}`;

/** Where a party's entry comes from: the first new document naming it, at the page that does, if the file has fixed pages. */
function firstCite(doc: GoldDoc, name: string): { doc: string; page: number | null } {
  const at = doc.path.endsWith('.pdf') ? goldPages(doc).findIndex((page) => page.join(' ').includes(name)) : -1;
  return { doc: goldDocId(doc.path), page: at < 0 ? null : at + 1 };
}

/** A manifest entry for a person the fixture doesn't already know. */
function extraPerson(name: string, cite: ReturnType<typeof firstCite>): Named {
  return { id: partyId(name), name, role: 'other', side: 'third', title: null, orgs: [], cites: [cite] } as Named;
}

/** A manifest entry for a company or agency the fixture doesn't already know. */
function extraOrg(name: string, cite: ReturnType<typeof firstCite>): Named {
  const side = name === 'Harbor Labs, LLC' ? 'defendant' : 'third';
  return { id: partyId(name), name, kind: AGENCIES.has(name) ? 'agency' : 'company', side, parent: null, formed: null, cites: [cite] } as Named;
}

/** The fixture's inputs with the new documents and names added. */
export function mergedInputs(base: FixtureInputs, docs: readonly GoldDoc[] = GOLD_DOCS): FixtureInputs {
  const known = new Map([...base.matter.people, ...base.matter.orgs].map((x) => [x.name, x.id]));
  const people = new Map<string, Named>();
  const orgs = new Map<string, Named>();
  const idOf = (name: string, doc: GoldDoc) => {
    const existing = known.get(name);
    if (existing) return existing;
    const id = partyId(name);
    const [entries, entry] = PEOPLE.has(name) ? [people, extraPerson] : [orgs, extraOrg];
    if (!entries.has(id)) entries.set(id, entry(name, firstCite(doc, name)));
    return id;
  };
  const docIds = { ...base.docIds };
  const facts = { ...base.matter.docs };
  for (const doc of docs) {
    const id = goldDocId(doc.path);
    docIds[doc.path] = id;
    facts[id] = { date: doc.date, type: doc.type, from: doc.from.map((name) => idOf(name, doc)), to: doc.to.map((name) => idOf(name, doc)), summary: doc.summary, privileged: doc.privileged === true };
  }
  return { docIds, matter: { ...base.matter, docs: facts, people: [...base.matter.people, ...people.values()], orgs: [...base.matter.orgs, ...orgs.values()] } };
}

const inFolder = (rel: string, folder: string) => rel.startsWith(`${folder}/`);

/** The new documents of a room, by exact folder. */
export function roomGoldDocs(spec: RoomSpec): GoldDoc[] {
  if (spec.folders === 'all') return GOLD_DOCS;
  const folders = spec.folders;
  return GOLD_DOCS.filter((doc) => spec.files?.includes(doc.path) || folders.some((f) => inFolder(doc.path, f)));
}

function roomGuide(room: RoomName, spec: RoomSpec, docs: readonly GoldDoc[]): string {
  if (room === 'dispute') {
    return `${FOLDER_GUIDE}- 12 to 16: the forming record. 20 and 21: the angel and venture rounds. 22: founder only. 23: received under the protective order, no AI\n`;
  }
  const folders = [...new Set(docs.map((doc) => doc.path.split('/')[0]))].sort();
  return `# Harbor Labs: ${spec.label} sample room\n\nA sample record. Every name and fact is fictional.\n\n${folders.map((f) => `- ${f}`).join('\n')}\n`;
}

/** Every file of a room's folder, in path order, with a catalog that lists what's there. Deterministic. */
export function roomFiles(room: RoomName, spec: RoomSpec, base: FixtureInputs): FixtureFile[] {
  const docs = roomGoldDocs(spec);
  const generated = new Set(['CLAUDE.md', CATALOG_REL]);
  const baseFiles = fixtureFiles(base).filter((f) => !generated.has(f.rel) && (spec.existing === 'all' || spec.existing.includes(f.rel)));
  const files = [...baseFiles, ...docs.map(goldFile), { rel: 'CLAUDE.md', bytes: Buffer.from(roomGuide(room, spec, docs), 'utf8') }];
  files.push({ rel: CATALOG_REL, bytes: Buffer.from(catalogCsv(mergedInputs(base), files), 'utf8') });
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** The room's text by path and page, for the checks: what a reader of each file would find on each page. */
export function roomText(spec: RoomSpec, base: FixtureInputs): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  const cited = citedLines(base.matter, pathById(base.docIds));
  for (const [rel, id] of Object.entries(base.docIds)) {
    if (spec.existing !== 'all' && !spec.existing.includes(rel)) continue;
    if (rel.endsWith('.xlsx')) out.set(rel, [['Fixture workbook', path.posix.basename(rel), 'Dummy data for local development']]);
    else out.set(rel, documentPages(rel, cited.get(rel), base.matter.docs[id]?.summary ?? null));
  }
  for (const doc of roomGoldDocs(spec)) out.set(doc.path, goldPages(doc));
  return out;
}

/** What an invited investor may see: documents under the room's folders, less anything the catalog marks. */
export function investorVisible(spec: RoomSpec, inputs: FixtureInputs): string[] {
  const facts = inputs.matter.docs;
  return Object.entries(inputs.docIds)
    .filter(([rel]) => (spec.existing === 'all' || spec.existing.includes(rel) || GOLD_DOCS.some((d) => d.path === rel)))
    .filter(([rel]) => spec.guestFolders.some((f) => inFolder(rel, f)))
    .filter(([rel, id]) => !/privileged/i.test(rel) && facts[id]?.privileged !== true)
    .map(([rel]) => rel)
    .sort();
}

/** What a seed needs beside the folder: the ids of the room's documents and, for a dispute only, its matter. */
export function roomInputs(room: RoomName, spec: RoomSpec, base: FixtureInputs, files: readonly FixtureFile[]): { docIds: Record<string, string>; matter: FixtureInputs['matter'] | null } {
  const merged = mergedInputs(base, roomGoldDocs(spec));
  const present = new Set(files.map((f) => f.rel));
  const docIds = Object.fromEntries(Object.entries(merged.docIds).filter(([rel]) => present.has(rel)));
  if (room !== 'dispute') return { docIds, matter: null };
  const kept = new Set(Object.values(docIds));
  const left = new Set([...NOT_PARTIES].map(partyId));
  const parties = (ids: string[]) => ids.filter((id) => !left.has(id));
  const docs = Object.entries(merged.matter.docs).filter(([id]) => kept.has(id)).map(([id, facts]) => [id, { ...facts, from: parties(facts.from), to: parties(facts.to) }]);
  return { docIds, matter: { ...merged.matter, orgs: merged.matter.orgs.filter((org) => !left.has(org.id)), docs: Object.fromEntries(docs) } };
}

function parseArgs(args: readonly string[]): { room: RoomName; out: string; inputs: string | null } {
  const get = (flag: string) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] ?? null : null; };
  const asked = get('--room');
  const room = (asked === 'all' ? 'dispute' : asked) as RoomName | null;
  const out = get('--out');
  if (!room || !ROOM_NAMES.includes(room) || !out) throw new Error('usage: build.ts --room <forming|raising-angel|raising-vc|dispute|all> --out <dir> [--inputs <dir>]');
  const inputs = get('--inputs');
  return { room, out: path.resolve(out), inputs: inputs ? path.resolve(inputs) : null };
}

async function main(): Promise<void> {
  const { room, out, inputs } = parseArgs(process.argv.slice(2));
  const [rooms, base] = await Promise.all([loadRooms(), loadFixtureInputs()]);
  const files = roomFiles(room, rooms[room], base);
  if (inputs) await assertScratchFolder(inputs);
  const summary = await writeFixture(out, files);
  if (inputs) {
    const { docIds, matter } = roomInputs(room, rooms[room], base, files);
    await mkdir(inputs, { recursive: true });
    await writeFile(path.join(inputs, MARKER), 'Made by gold/build.ts. Safe to delete.\n');
    await writeFile(path.join(inputs, 'doc-ids.json'), `${JSON.stringify(docIds, null, 2)}\n`);
    const matterFile = path.join(inputs, 'matter.json');
    if (matter) await writeFile(matterFile, `${JSON.stringify(matter, null, 2)}\n`);
    else await rm(matterFile, { force: true });
  }
  process.stdout.write(`Gold room ${room}: ${files.length} files in ${out} (${summary.written} written, ${summary.unchanged} unchanged, ${summary.removed} removed)\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
