// SPDX-License-Identifier: Apache-2.0
// Reads the room's gitignored config: web/room.config.json, or web/legallas.config.json when that is the one present
// (an older name some rooms still use).
// src/scripts/room-config.ts reads the same two names, in the same order, for the Astro build. The example lives in
// legallas.config.example.json.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { assistantNameProblem } from '../worker/room-names.ts';
import { ROOM_SETTINGS } from '../worker/room-settings.ts';
import { parseStoredName, STORED_NAME } from '../worker/stored-name.ts';
import type { InternalNote } from './matter/catalog.ts';

export interface SyncConfig {
  /** The curated folder that is mirrored into the room. */
  sourceRoot: string;
  /** Where counsel uploads are pulled to on the Mac. */
  inboxDir: string;
  /** Snapshots, extracted text and the index manifest. Outside every repo. Left out, this computer's own cache folder. */
  cacheDir: string;
}

/** The config's file names, in the order they are tried: the neutral name first, then the older one. */
export const CONFIG_NAMES = ['room.config.json', 'legallas.config.json'] as const;

/** The room config in `dir` (default web/): the first of CONFIG_NAMES that exists, else the neutral name. */
export function roomConfigPath(dir = path.resolve(import.meta.dirname, '..')): string {
  for (const name of CONFIG_NAMES) {
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  return path.join(dir, CONFIG_NAMES[0]);
}

export const DEFAULT_CONFIG_PATH = roomConfigPath();

/** The neutral pack the core ships: the neutral mark as the glyph, icons and public files, and no companion. */
export const NEUTRAL_BRAND_ASSETS = path.resolve(import.meta.dirname, '..', 'src', 'assets', 'neutral');

/** A room's own brand pack, when its checkout has one. */
export const LEGALLAS_BRAND_ASSETS = path.resolve(import.meta.dirname, '..', 'src', 'assets', 'legallas');

/** The pack used when the config names no other folder: the Legallas pack where the checkout has it, else the neutral. */
export const DEFAULT_BRAND_ASSETS = existsSync(LEGALLAS_BRAND_ASSETS) ? LEGALLAS_BRAND_ASSETS : NEUTRAL_BRAND_ASSETS;

/**
 * The brand pack: the folder holding the room's brand. Required: miniature.webp (the header glyph), the icons
 * brand/arrow-next.svg, brand/arrow-prev.svg and brand/target-direct.svg, and public/ (favicon.svg,
 * welcome/favicon.svg, welcome/seal-access.svg), which integrations/brand-public.mjs copies into the build as they
 * are. Optional: mark.ts (the mark, `markSvg`; without it the pages draw the neutral one, src/scripts/brand.ts) and
 * the companion's art (states/<state>.webp, one .riv rig) and the mail builder's email-portrait.png.
 * `brandAssets` in the room config names it, relative to the config's folder (web/) or absolute; without the key it
 * is DEFAULT_BRAND_ASSETS. astro.config.mjs aliases it as @brand; the image tests and the dist audit check the same
 * folder. Read synchronously, because astro.config.mjs needs it before the build starts.
 */
export function brandAssetsDir(file = DEFAULT_CONFIG_PATH, home = homedir()): string {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_BRAND_ASSETS;
    throw error;
  }
  const dir = parseBrandAssets(raw, path.dirname(file), home);
  if (!existsSync(dir)) throw new Error(`${path.basename(file)}: brandAssets folder ${dir} does not exist`);
  return dir;
}

/**
 * Whether a brand pack has its one .riv rig, the rule companion-rive.ts loads by. astro.config.mjs writes it into the
 * build as BRAND_HAS_RIG, so a pack without one ships no Rive runtime.
 */
export function brandHasRig(dir: string): boolean {
  return readdirSync(dir).filter((name) => name.endsWith('.riv')).length === 1;
}

/** The PNG the hand-sent mail builder embeds: a copy of the hosted portrait. */
export const LEGALLAS_EMAIL_PORTRAIT = path.resolve(import.meta.dirname, '..', '..', 'docs', 'email', 'legallas-v3.png');

/**
 * The portrait scripts/legallas-mail.ts embeds as a cid: image: email-portrait.png in a configured brand pack, or
 * LEGALLAS_EMAIL_PORTRAIT for a room's brand pack.
 */
export function emailPortraitPath(dir = brandAssetsDir()): string {
  return dir === LEGALLAS_BRAND_ASSETS ? LEGALLAS_EMAIL_PORTRAIT : path.join(dir, 'email-portrait.png');
}

/** The brandAssets key of a parsed config as an absolute folder, or DEFAULT_BRAND_ASSETS when it is absent. */
export function parseBrandAssets(raw: unknown, base: string, home = homedir()): string {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).brandAssets : undefined;
  if (value === undefined || value === null) return DEFAULT_BRAND_ASSETS;
  if (typeof value !== 'string' || value.trim() === '') throw new Error('room config: brandAssets must be a folder path');
  const expanded = value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
  return path.resolve(base, expanded);
}

/** This computer's place for a program's cache: per user, and out of what iCloud Drive or OneDrive carry. */
export function defaultCacheDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  // A variable that isn't an absolute path is ignored, so the cache can't land somewhere relative to where a run started.
  const absolute = (value: string | undefined) => (value && paths.isAbsolute(value) ? value : null);
  if (platform === 'darwin') return paths.join(home, 'Library', 'Caches', 'legallas-sync');
  if (platform === 'win32') return paths.join(absolute(env.LOCALAPPDATA) ?? paths.join(home, 'AppData', 'Local'), 'legallas-sync');
  return paths.join(absolute(env.XDG_CACHE_HOME) ?? paths.join(home, '.cache'), 'legallas-sync');
}

/** Expands a leading "~/" (or "~\\") and requires an absolute result. */
export function resolveConfigPath(value: unknown, field: string, home = homedir()): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`legallas.config.json: ${field} is required`);
  const expanded = value === '~' ? home : value.startsWith('~/') || value.startsWith('~\\') ? path.join(home, value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw new Error(`legallas.config.json: ${field} must be an absolute path`);
  return path.normalize(expanded);
}

/**
 * A path as the disk holds it, as far as it exists: links followed, and letter case and Unicode form as stored. Its text
 * can't say whether two paths are one folder: on macOS and Windows case doesn't matter, and a link can lead anywhere.
 */
function onDisk(file: string): string {
  const missing: string[] = [];
  for (let at = file; ; at = path.dirname(at)) {
    try {
      return path.join(realpathSync.native(at), ...missing);
    } catch {
      if (path.dirname(at) === at) return file;
      missing.unshift(path.basename(at));
    }
  }
}

function isInside(child: string, parent: string): boolean {
  const [outer, inner] = [onDisk(parent), onDisk(child)];
  const relative = path.relative(outer, inner);
  if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return true;
  // One folder can have two paths with no link to follow (macOS's /System/Volumes/Data), so ask the disk which folder each is.
  // A disk that gives its files no ID reports 0, and can't answer, so that alone must not read as one folder.
  const wanted = statSync(outer, { bigint: true, throwIfNoEntry: false });
  for (let at = inner; wanted && wanted.ino !== 0n; at = path.dirname(at)) {
    const here = statSync(at, { bigint: true, throwIfNoEntry: false });
    if (here?.dev === wanted.dev && here.ino === wanted.ino) return true;
    if (path.dirname(at) === at) return false;
  }
  return false;
}

/** Validates the parsed config. The cache and inbox must never sit inside the mirrored folder (or the reverse). */
export function parseSyncConfig(raw: unknown, home = homedir()): SyncConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error('legallas.config.json must be a JSON object');
  const record = raw as Record<string, unknown>;
  const config = {
    sourceRoot: resolveConfigPath(record.sourceRoot, 'sourceRoot', home),
    inboxDir: resolveConfigPath(record.inboxDir, 'inboxDir', home),
    cacheDir: record.cacheDir === undefined ? defaultCacheDir(process.platform, process.env, home) : resolveConfigPath(record.cacheDir, 'cacheDir', home),
  };
  for (const field of ['inboxDir', 'cacheDir'] as const) {
    if (isInside(config[field], config.sourceRoot) || isInside(config.sourceRoot, config[field])) {
      throw new Error(`legallas.config.json: ${field} must be outside sourceRoot`);
    }
  }
  return config;
}

export async function loadSyncConfig(file = DEFAULT_CONFIG_PATH): Promise<SyncConfig> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`Missing ${file}. Copy legallas.config.example.json to room.config.json and fill in the paths.`);
  }
  const raw: unknown = JSON.parse(text);
  assertStoredName(raw);
  return parseSyncConfig(raw);
}

/** The storedName key of a parsed config (worker/stored-name.ts), or the default. */
export function storedNameOf(raw: unknown): string {
  return parseStoredName(typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).storedName : undefined);
}

/**
 * The stored name the room config sets, read at build time by astro.config.mjs and by the guards. Read synchronously,
 * as brandAssetsDir is.
 */
export function configuredStoredName(file = DEFAULT_CONFIG_PATH): string {
  return storedNameOf(readRoomConfig(file));
}

/** The room's hostname from its config, for `npm run sync -- --room`, or null when the config names none. */
export function configuredRoomHost(file = DEFAULT_CONFIG_PATH): string | null {
  const raw = readRoomConfig(file);
  const host = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).host : undefined;
  return typeof host === 'string' && host.trim() !== '' ? host.trim() : null;
}

/** A room config key as its global: `mcpHost` is ROOM_MCP_HOST. scripts/room-preload.ts and tools that build a room use this rule. */
export function roomGlobalName(key: string): string {
  return `ROOM_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
}

/**
 * What the build fixes (worker/room-settings.ts, worker/stored-name.ts), as Vite defines: every setting, and `undefined`
 * for one the config leaves out, so the code's default is written in. A value of the wrong type is an error.
 */
export function roomDefines(raw: unknown): Record<string, string> {
  const config = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  // A1: an assistant name that could pass for a lawyer stops the build, rather than fall back without a word.
  const assistantProblem = typeof config.assistantName === 'string' ? assistantNameProblem(config.assistantName) : null;
  if (assistantProblem) throw new Error(`room config: assistantName. ${assistantProblem}`);
  const defines: Record<string, string> = { [roomGlobalName('storedName')]: JSON.stringify(storedNameOf(config)) };
  for (const [key, type] of Object.entries(ROOM_SETTINGS)) {
    const value = config[key];
    if (value !== undefined && value !== null && (type === 'array' ? !Array.isArray(value) : typeof value !== type)) {
      throw new Error(`room config: ${key} must be ${type === 'array' ? 'a list' : 'text'}`);
    }
    // The settings reach MCP pages and links as bare text (worker/room-settings.ts), so markup stops the build (#243).
    if (type === 'string' && typeof value === 'string' && /[<>"]/.test(value)) {
      throw new Error(`room config: ${key} must not hold <, > or "`);
    }
    defines[roomGlobalName(key)] = value === undefined || value === null ? 'undefined' : JSON.stringify(value);
  }
  return defines;
}

/** roomDefines for the room config file; with no config, the defaults. Read synchronously for astro.config.mjs. */
export function configuredRoomDefines(file = DEFAULT_CONFIG_PATH): Record<string, string> {
  return roomDefines(readRoomConfig(file));
}

/** The parsed room config, or undefined with none. JSON.parse quotes its input, and the config holds local paths: never pass that on. */
function readRoomConfig(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path.basename(file)} is not valid JSON`);
  }
}

/**
 * Stops a script that started without scripts/room-preload.ts (run directly, not through `npm run`) in a room
 * with its own stored name: it would look for the wrong manifest and index or pack the room's hidden data files.
 */
export function assertStoredName(raw: unknown, running: string = STORED_NAME): void {
  const configured = storedNameOf(raw);
  if (configured !== running) {
    throw new Error(`the room config's storedName is ${configured}, but this run has ${running}. Start it with npm run.`);
  }
}

/** Used when the room config has no valid controlPrefix; matches the room and mcp/contract.ts. Never the fixture's. */
export const CONTROL_PREFIX_FALLBACK = 'DOC';
/** The fictional fixture's prefix (Doe v. Harbor Labs), never a room's own. */
const FIXTURE_CONTROL_PREFIX = 'DOE';
const CONTROL_PREFIX = /^[A-Z]{2,6}$/;

/** The control prefix from a parsed room config, or the fallback the room uses for a malformed one. */
export function controlPrefixOf(raw: unknown): string {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).controlPrefix : undefined;
  return typeof value === 'string' && CONTROL_PREFIX.test(value) ? value : CONTROL_PREFIX_FALLBACK;
}

/**
 * The control prefix this checkout's room config sets, or null with no config, only the fallback or the fixture's. Only the
 * gitignored config names an instance's real prefix, so tests that prove a fixture or a prompt never carries it read
 * it here.
 */
export function configuredControlPrefix(file = DEFAULT_CONFIG_PATH): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const prefix = controlPrefixOf(raw);
  return prefix === CONTROL_PREFIX_FALLBACK || prefix === FIXTURE_CONTROL_PREFIX ? null : prefix;
}

/**
 * The internalNotes key of a parsed config: [{ "note": name, "pattern": regular expression }], the room's own catalog
 * notes on top of matter/catalog.ts INTERNAL_NOTES. Patterns ignore case. A bad entry is refused by its position, and
 * the message leaves the pattern out, because the terminal gets no catalog words.
 */
export function parseInternalNotes(raw: unknown): InternalNote[] {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).internalNotes : undefined;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('room config: internalNotes must be a list of { note, pattern }');
  return value.map((entry: unknown, index) => {
    const { note, pattern } = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof note !== 'string' || note.trim() === '' || typeof pattern !== 'string' || pattern === '') {
      throw new Error(`room config: internalNotes[${index}] needs a note and a pattern`);
    }
    try {
      return { note, pattern: new RegExp(pattern, 'i') };
    } catch {
      throw new Error(`room config: internalNotes[${index}] has an invalid pattern`);
    }
  });
}

/** The internal notes this checkout's room config sets; none with no config. */
export function configuredInternalNotes(file = DEFAULT_CONFIG_PATH): InternalNote[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return parseInternalNotes(raw);
}
