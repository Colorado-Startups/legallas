// SPDX-License-Identifier: Apache-2.0
// The law library's output and upload plan. A build writes every part to <lawDir>/out/law/<track>/<id>.md and
// the catalog to <lawDir>/out/catalog.json. The plan compares that with <lawDir>/state/uploaded.json (what the
// last apply put in the legallas-law bucket) and names a fingerprint, like `npm run sync`: an apply runs only
// with `--expect <fingerprint>` from an approved dry run, so it uploads exactly what was reviewed.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lawFromKey, lawKey, unitOf } from '../../worker/law-cite.ts';
import type { BuiltChunk, LawCatalog } from './types.ts';
import { STORED_NAME } from '../../worker/stored-name.ts';

/** The name of the bucket that holds the law library. */
export const LAW_BUCKET = `${STORED_NAME}-law`;
/** The name of the search instance over the law library. */
export const LAW_SEARCH_INSTANCE = `${STORED_NAME}-law`;
/** The object key of the law catalog. */
export const CATALOG_KEY = 'catalog.json';

/** ~/Library/Caches/<stored name>-sync/law, or LEGALLAS_LAW_DIR. Outside every repository. */
export function lawDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.LEGALLAS_LAW_DIR ?? path.join(os.homedir(), 'Library', 'Caches', `${STORED_NAME}-sync`, 'law');
}

/** The hex SHA-256 of text or bytes. */
export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The catalog's `built` stamp, from the content: the latest retrieval date of any chunk. A rebuild of the same
 * text therefore writes the same catalog bytes, so the plan's fingerprint holds between a dry run and its apply.
 */
export function builtDate(chunks: readonly Pick<BuiltChunk, 'retrieved'>[]): string {
  return chunks.reduce((latest, chunk) => (chunk.retrieved > latest ? chunk.retrieved : latest), '');
}

/** catalog.json's text for `chunks`: every part's entry without its text. */
export function catalogText(chunks: readonly BuiltChunk[], built: string): string {
  const catalog: LawCatalog = { version: 1, built, chunks: chunks.map(({ text: _text, ...entry }) => entry) };
  return `${JSON.stringify(catalog, null, 1)}\n`;
}

/** Writes a fresh out/ directory: one file per part and the catalog. Returns key -> sha256 of every object. */
export async function writeOutput(dir: string, chunks: readonly BuiltChunk[], built: string): Promise<Record<string, string>> {
  const out = path.join(dir, 'out');
  await rm(out, { recursive: true, force: true });
  const objects: Record<string, string> = {};
  for (const chunk of chunks) {
    const key = lawKey(chunk);
    await mkdir(path.dirname(path.join(out, key)), { recursive: true });
    await writeFile(path.join(out, key), chunk.text);
    objects[key] = sha256(chunk.text);
  }
  const catalog = catalogText(chunks, built);
  await writeFile(path.join(out, CATALOG_KEY), catalog);
  objects[CATALOG_KEY] = sha256(catalog);
  return objects;
}

/** A plan to change the law bucket: the keys to put and the keys to remove. */
export interface LawPlan {
  put: string[];
  remove: string[];
  unchanged: number;
  fingerprint: string;
}

/** What an apply would do to move the bucket from `uploaded` to `built`. Sorted, so the fingerprint is stable. */
export function planUpload(built: Record<string, string>, uploaded: Record<string, string>): LawPlan {
  const put = Object.keys(built)
    .filter((key) => uploaded[key] !== built[key])
    .sort();
  const remove = Object.keys(uploaded)
    .filter((key) => !(key in built))
    .sort();
  const unchanged = Object.keys(built).length - put.length;
  const lines = [...put.map((key) => `put ${key} ${built[key]}`), ...remove.map((key) => `delete ${key}`)];
  return { put, remove, unchanged, fingerprint: sha256(lines.join('\n')).slice(0, 12) };
}

/**
 * What a plan takes out of the library, unit by unit, so no dry run can delete law without saying which. A pack that
 * drops a unit, a packs.json that goes missing or a repealed section all show up here by name.
 */
export function deletionLines(remove: readonly string[]): string[] {
  if (remove.length === 0) return [];
  const parts = new Map<string, number>();
  for (const key of remove) {
    const id = lawFromKey(key)?.id;
    const unit = id ? unitOf(id) : key;
    parts.set(unit, (parts.get(unit) ?? 0) + 1);
  }
  return [
    `This plan DELETES ${remove.length} part${remove.length === 1 ? '' : 's'} of ${parts.size} law unit${parts.size === 1 ? '' : 's'} from the library:`,
    ...[...parts].sort(([a], [b]) => a.localeCompare(b)).map(([unit, count]) => `  ${unit} (${count} part${count === 1 ? '' : 's'})`),
  ];
}

/** One stage of a law upload, with the plan to apply now. */
export interface LawStage {
  /** The plan to apply now: the parts that fit, with the catalog and the deletions. */
  plan: LawPlan;
  /** The parts held for a later run. */
  later: string[];
  /** The acts those parts belong to, in order. */
  laterActs: string[];
}

function unitOfKey(key: string): string {
  const id = lawFromKey(key)?.id;
  return id ? unitOf(id) : key;
}

/**
 * The part of `plan` this month can afford, asking `hold` for the characters of each step, which says false once the
 * month has no room.
 *
 * Whatever changes a unit already in the library goes first and whole, or the upload is refused: holding back a changed
 * part would leave old words under a new catalog entry, or a deleted part with no replacement. After that, acts new to the
 * library go up whole, in `order`, so none is half searchable. One held back costs nothing, since the catalog may name it
 * but only what AI Search has indexed can be retrieved.
 */
export async function stagePlan(
  plan: LawPlan,
  order: readonly string[],
  uploaded: Readonly<Record<string, string>>,
  actOf: (key: string) => string,
  charsOf: (keys: readonly string[]) => Promise<number>,
  hold: (chars: number) => Promise<boolean>,
): Promise<LawStage> {
  const wanted = new Set(plan.put);
  const parts = order.filter((key) => wanted.has(key) && key !== CATALOG_KEY);
  const known = new Set(parts);
  // A part the order doesn't name can't happen from a build, and is never dropped without a word.
  const stray = plan.put.filter((key) => key !== CATALOG_KEY && !known.has(key));
  if (stray.length > 0) throw new Error(`the upload order leaves out ${stray.length} planned parts`);
  const inLibrary = new Set([...Object.keys(uploaded), ...plan.remove].filter((key) => key !== CATALOG_KEY).map(unitOfKey));
  const changes = parts.filter((key) => inLibrary.has(unitOfKey(key)));
  if (changes.length > 0 && !(await hold(await charsOf(changes)))) {
    throw new Error(`This month's AI Search allowance can't hold the ${changes.length} changed parts, and nothing was uploaded: law already in the library changes whole or not at all. Run this again on or after the 1st.`);
  }
  const now = [...changes];
  const acts = new Map<string, string[]>();
  for (const key of parts) {
    if (inLibrary.has(unitOfKey(key))) continue;
    const act = actOf(key);
    acts.set(act, [...(acts.get(act) ?? []), key]);
  }
  const later: string[] = [];
  const laterActs: string[] = [];
  let open = true;
  for (const [act, keys] of acts) {
    open = open && (await hold(await charsOf(keys)));
    if (open) {
      now.push(...keys);
    } else {
      later.push(...keys);
      laterActs.push(act);
    }
  }
  // With nothing to go up, a new catalog would only name parts that aren't there.
  const catalog = wanted.has(CATALOG_KEY) && (now.length > 0 || parts.length === 0) ? [CATALOG_KEY] : [];
  return { plan: { ...plan, put: [...now, ...catalog].sort() }, later, laterActs };
}

/** The path of the file that records which objects were uploaded. */
export function uploadedPath(dir: string): string {
  return path.join(dir, 'state', 'uploaded.json');
}

/** Reads the record of uploaded objects, or an empty record when none exists. */
export async function loadUploaded(dir: string): Promise<Record<string, string>> {
  const text = await readFile(uploadedPath(dir), 'utf8').catch(() => null);
  return text ? (JSON.parse(text) as Record<string, string>) : {};
}

/** Saves the record of uploaded objects. */
export async function saveUploaded(dir: string, objects: Record<string, string>): Promise<void> {
  await mkdir(path.dirname(uploadedPath(dir)), { recursive: true });
  await writeFile(uploadedPath(dir), `${JSON.stringify(objects, null, 1)}\n`);
}

/** Keys an apply may write: the catalog and law parts. Anything else is refused before wrangler runs. */
export function assertLawObjectKey(key: string): string {
  if (key === CATALOG_KEY || /^law\/(civil|regulator|both)\/[a-z0-9~-]{3,96}\.md$/.test(key)) return key;
  throw new Error('Refusing an R2 key the law build did not generate');
}

/** wrangler arguments for one upload to legallas-law (remote only; the bucket is fixed here). */
export function lawPutArgs(dir: string, key: string): string[] {
  const type = key === CATALOG_KEY ? 'application/json' : 'text/markdown; charset=utf-8';
  return ['r2', 'object', 'put', `${LAW_BUCKET}/${assertLawObjectKey(key)}`, '--file', path.join(dir, 'out', key), '--content-type', type, '--remote'];
}

/** The wrangler arguments that delete one object from the law bucket. */
export function lawDeleteArgs(key: string): string[] {
  return ['r2', 'object', 'delete', `${LAW_BUCKET}/${assertLawObjectKey(key)}`, '--remote'];
}

/**
 * Applies a plan in the order the Worker tolerates: parts first, then the catalog that makes them citable, then
 * deletions, then one indexing job. `uploaded` is saved after every step, so a failed apply resumes.
 */
export async function applyPlan(dir: string, plan: LawPlan, built: Record<string, string>, run: (args: string[]) => Promise<string>, log: (line: string) => void): Promise<void> {
  const uploaded = await loadUploaded(dir);
  const parts = plan.put.filter((key) => key !== CATALOG_KEY);
  let done = 0;
  for (const key of parts) {
    await run(lawPutArgs(dir, key));
    uploaded[key] = built[key]!; // safe: plan keys come from built
    if (++done % 50 === 0) {
      await saveUploaded(dir, uploaded);
      log(`  ${done} of ${parts.length} parts uploaded`);
    }
  }
  await saveUploaded(dir, uploaded);
  if (plan.put.includes(CATALOG_KEY)) {
    await run(lawPutArgs(dir, CATALOG_KEY));
    uploaded[CATALOG_KEY] = built[CATALOG_KEY]!; // safe: the catalog is always built
    await saveUploaded(dir, uploaded);
  }
  for (const key of plan.remove) {
    await run(lawDeleteArgs(key));
    delete uploaded[key];
  }
  await saveUploaded(dir, uploaded);
  if (parts.length || plan.remove.length) await run(['ai-search', 'jobs', 'create', LAW_SEARCH_INSTANCE]);
}
