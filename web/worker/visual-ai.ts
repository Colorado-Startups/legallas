// SPDX-License-Identifier: Apache-2.0
// The visual binder, readable by AIs (decision D8). `npm run visuals` renders every visual page in headless Chrome
// with the network off and keeps the page's rendered text (and, when it fits, a small PNG) in the sync cache, keyed
// by the sha256 of the page's HTML. `npm run sync` uploads them as side files to legallas-files at
// meta/visual-ai/<html sha256>.{txt,png} (the key format is in worker/visuals.ts, which scripts share), inside its
// plan fingerprint.
//
// Side files are not documents: no D1 row, so no control number, and never listed, cited, served by /files or put in
// legallas-index. Only two readers open them: the index build, which indexes a visual's text under the visual's own
// document id (scripts/extract.ts directTextPages), and the AI tools (legallas_view_visual), after the caller's role
// has been checked against the visual's documents row. The DB and bucket types are structural, so tests pass fakes.
import { MANIFEST_NAME, ManifestError, parseManifest, resolveBinder, sidePngFits, visualAiKey, type RoomBinder } from './visuals.ts';
import { NOT_HIDDEN_SQL } from './files-catalog.ts';
import { privilegeFilter } from './privilege.ts';
import type { Role } from './env.ts';

/** The parts of an R2 bucket these readers use; R2Bucket fits. */
export interface SideFileBucket {
  get(key: string): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}

/** The parts of D1 these readers use; D1Database fits. */
export interface SideFileDb {
  prepare(sql: string): Statement;
}

/** A visual's documents row, as the AI tools need it. sha256 stays inside this module's callers, never in a result. */
export interface VisualRow {
  id: string;
  path: string;
  name: string;
  control_seq: number | null;
  sha256: string | null;
}

export interface LoadedBinder {
  binder: RoomBinder;
  /** The live visuals the binder lists, by document id. */
  rows: Map<string, VisualRow>;
}

export type BinderResult = LoadedBinder | { error: 'bad_manifest'; detail: string };

const EMPTY: LoadedBinder = { binder: { sections: [], visuals: [] }, rows: new Map() };

/**
 * The binder a member with `role` sees: the mirrored manifest (MANIFEST_NAME) joined to the live visuals in its
 * folder, as /api/visuals builds it, plus each visual's row. A missing manifest is an empty binder; a malformed one is
 * `bad_manifest` with a reason that names a field, never document text.
 */
export async function loadBinder(db: SideFileDb, files: SideFileBucket, role: Role): Promise<BinderResult> {
  const visible = privilegeFilter(role);
  const manifestRow = await db
    .prepare(`SELECT folder, r2_key FROM documents WHERE name = ?1 AND source = 'mirror' AND removed_at IS NULL${visible} ORDER BY path LIMIT 1`)
    .bind(MANIFEST_NAME)
    .first<{ folder: string; r2_key: string }>();
  if (!manifestRow) return EMPTY;
  const object = await files.get(manifestRow.r2_key);
  if (!object) return EMPTY;
  let manifest;
  try {
    manifest = parseManifest(JSON.parse(await object.text()));
  } catch (error) {
    if (error instanceof ManifestError || error instanceof SyntaxError) return { error: 'bad_manifest', detail: error.name };
    throw error;
  }
  const { results } = await db
    .prepare(
      'SELECT id, path, name, control_seq, sha256 FROM documents ' +
        `WHERE kind = 'visual' AND source = 'mirror' AND removed_at IS NULL AND folder = ?1 AND ${NOT_HIDDEN_SQL}${visible}`,
    )
    .bind(manifestRow.folder)
    .all<VisualRow>();
  const binder = resolveBinder(manifest, manifestRow.folder, results);
  const listed = new Set(binder.visuals.map((visual) => visual.id));
  return { binder, rows: new Map(results.filter((row) => listed.has(row.id)).map((row) => [row.id, row])) };
}

/**
 * One live mirrored visual by document id that a member with `role` may see, whether or not the binder lists it (an
 * HTML file elsewhere in the room is a visual too, and search finds its text), or null.
 */
export async function findVisualRow(db: SideFileDb, id: string, role: Role): Promise<VisualRow | null> {
  return db
    .prepare(
      'SELECT id, path, name, control_seq, sha256 FROM documents ' +
        `WHERE id = ?1 AND kind = 'visual' AND source = 'mirror' AND removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(role)}`,
    )
    .bind(id)
    .first<VisualRow>();
}

export interface VisualAi {
  text: string;
  /** The page as a PNG within the side-file limits (sidePngFits), or null when none fits, was stored or was asked for. */
  png: Uint8Array | null;
}

/** A visual's side files by its HTML sha256, or null when its text has not been synced yet. */
export async function readVisualAi(files: SideFileBucket, sha256: string | null, options: { png: boolean }): Promise<VisualAi | null> {
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  const text = await files.get(visualAiKey(sha256, 'txt'));
  if (!text) return null;
  const image = options.png ? await files.get(visualAiKey(sha256, 'png')) : null;
  const png = image ? new Uint8Array(await image.arrayBuffer()) : null;
  return { text: await text.text(), png: png && sidePngFits(png) ? png : null };
}
