// SPDX-License-Identifier: Apache-2.0
// The Wrangler config the config guards read (worker/config.test.ts, mcp/config.test.ts, worker/backup/config.test.ts): a
// room's own file (wrangler.jsonc, wrangler.mcp.jsonc, wrangler.backup.jsonc: its hostnames, Access team, IDs and alert
// addresses) when the checkout has one, else the example a new room starts from (wrangler.example.jsonc,
// wrangler.mcp.example.jsonc, wrangler.backup.example.jsonc). Both obey the same rules, and the guards keep each example
// equal to the room's own file apart from the fields a room fills in.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const WEB_DIR = join(import.meta.dirname, '..');

export type WranglerBase = 'wrangler' | 'wrangler.mcp' | 'wrangler.backup';

export interface WranglerConfig {
  file: string;
  raw: string;
  /** The parsed file; each guard reads the fields it pins. */
  config: any;
  /** True when this is the example, not a room's own file. */
  example: boolean;
}

/** True when this checkout has the room's own file for `base`. */
export function hasRoomConfig(base: WranglerBase): boolean {
  return existsSync(join(WEB_DIR, `${base}.jsonc`));
}

/** Comments in these files are whole lines; strip them and trailing commas, then parse. */
export function parseWranglerJsonc(raw: string): any {
  return JSON.parse(
    raw
      .split('\n')
      .filter((line: string) => !line.trimStart().startsWith('//'))
      .join('\n')
      .replace(/,(\s*[}\]])/g, '$1'),
  );
}

/** The room's own file for `base` when the checkout has one, else the example; `example` forces the example. */
export function readWranglerConfig(base: WranglerBase, example = !hasRoomConfig(base)): WranglerConfig {
  const file = example ? `${base}.example.jsonc` : `${base}.jsonc`;
  const raw = readFileSync(join(WEB_DIR, file), 'utf8');
  return { file, raw, config: parseWranglerJsonc(raw), example };
}

/** What an entry exports under `name`: the class it really is, and the module that holds it. */
export interface EntryExport {
  /** The class's own name in `module`. */
  className: string;
  /** Path of the module, relative to web/. */
  module: string;
}

/**
 * What the Worker entry `main` (relative to web/) exports under `name`, by reading the source, following `export *`. A
 * Worker's entry imports cloudflare:workers, so it can't load under Node. Null when it doesn't export that name.
 */
export function entryExport(main: string, name: string): EntryExport | null {
  const file = join(WEB_DIR, main);
  const text = readFileSync(file, 'utf8');
  const relative = (from: string) => join(dirname(main), from);
  for (const [, names, from] of text.matchAll(/^export \{([^}]*)\} from '([^']+)';$/gm)) {
    for (const part of names!.split(',')) {
      const [own, exported] = part.trim().split(/\s+as\s+/);
      if ((exported ?? own) === name) return { className: own!, module: relative(from!) };
    }
  }
  for (const [, from] of text.matchAll(/^export \* from '([^']+)';$/gm)) {
    const found = entryExport(relative(from!), name);
    if (found) return found;
  }
  return null;
}

/** A setting as this config's `define` gives it (scripts/config.ts roomGlobalName), or `fallback`, as the built code would read it. */
export function definedSetting(config: { define?: Record<string, string> }, name: string, fallback: string): string {
  const value = config.define?.[name];
  return value === undefined ? fallback : (JSON.parse(value) as string);
}

/**
 * A copy of `config` with each field a room fills in set to null: dotted paths, where `name[]` goes through every
 * item of an array. A field the config lacks stays absent, so a missing field still shows as a difference.
 */
export function withoutRoomFields<T>(config: T, fields: readonly string[]): T {
  const copy = structuredClone(config);
  const blank = (node: unknown, keys: readonly string[]): void => {
    const [key, ...rest] = keys;
    if (typeof node !== 'object' || node === null || key === undefined) return;
    const record = node as Record<string, unknown>;
    if (key.endsWith('[]')) {
      const items = record[key.slice(0, -2)];
      if (Array.isArray(items)) for (const item of items) blank(item, rest);
    } else if (rest.length > 0) blank(record[key], rest);
    else if (key in record) record[key] = null;
  };
  for (const field of fields) blank(copy, field.split('.'));
  return copy;
}

/** A copy of `config` without the optional `vars` and blocks only a room sets: both sides of a comparison lack them. */
export function withoutRoomExtras<T extends { vars?: Record<string, unknown> }>(config: T, vars: readonly string[], blocks: readonly string[] = ['define', 'build']): T {
  const copy = structuredClone(config) as T & Record<string, unknown>;
  for (const block of blocks) delete copy[block];
  for (const name of vars) if (copy.vars) delete copy.vars[name];
  return copy;
}
