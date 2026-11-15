// SPDX-License-Identifier: Apache-2.0
// Law packs: what a room's law library holds. Each pack names the hosts it fetches from, its fixed URLs, the sources
// the core builders read for it (`sources`) and any builder of its own. packs.json beside this file lists a room's
// packs by file name, each a module here that exports `lawPack`. A room without packs.json builds the default pack
// (default-pack.ts), and a room that wants no law at all lists no packs: [].
// The units come in a stable order: the statutes, regulations and Code sections of every pack, each pack's own builder,
// then the opinions, in the order packs.json lists the packs.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BuildOptions } from './build.ts';
import type { CaseSource } from './case-source.ts';
import type { RawCache } from './fetch.ts';
import { ALLOWED_HOSTS, type CrsCommonName, type CrsSource, type EcfrSource, type UscSource } from './sources.ts';
import type { LawUnit } from './types.ts';

/** What the core builders read for a pack. */
export interface LawPackSources {
  crs?: readonly CrsSource[];
  /** Common names for C.R.S. sections, on top of the core's general ones (build.ts crsCommonName). */
  crsCommonNames?: readonly CrsCommonName[];
  ecfr?: readonly EcfrSource[];
  usc?: readonly UscSource[];
  cases?: readonly CaseSource[];
  /** The only opinions whose text may come from CourtListener's stored PDFs, by cite. */
  slipCases?: ReadonlySet<string>;
  /** The only texts supplied into the raw cache instead of downloaded, by cache key. */
  suppliedTexts?: ReadonlySet<string>;
}

/** A law pack: a named source of law units that the build reads. */
export interface LawPack {
  /** For the build log and errors. */
  name: string;
  /** Hosts the pack's builder fetches from; the fetch guard allows them beside the core sources' hosts. */
  hosts: readonly string[];
  /** Every fixed URL the pack's own builder uses, for the host guard test (sources.ts manifestUrls). */
  urls(): string[];
  sources?: LawPackSources;
  build(cache: RawCache, options: BuildOptions): Promise<LawUnit[]>;
  /** What the pack holds, one line at a time: every unit, its source and when it was fetched. Downloads nothing. */
  report?(cache: RawCache): Promise<string[]>;
  /**
   * An upload of this pack goes up one whole act at a time, in build order, as far as the month's AI Search allowance
   * reaches, and the next run picks up the rest. Without it an upload that doesn't fit is refused whole. The value names
   * the act a law unit belongs to.
   */
  stagedUpload?: (lawUnitId: string) => string | undefined;
}

/** The path of the file that lists the packs. */
export const PACKS_FILE = path.join(import.meta.dirname, 'packs.json');
const PACK_FILE = /^[a-z0-9][a-z0-9-]*\.ts$/;
const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** The packs `file` lists, loaded from beside it; the default pack when the room has no such file. */
export async function loadLawPacks(file = PACKS_FILE): Promise<LawPack[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const { lawPack } = await import('./default-pack.ts');
    return [lawPack];
  }
  const names: unknown = JSON.parse(text);
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string' && PACK_FILE.test(name))) {
    throw new Error(`${path.basename(file)} must list pack file names beside it, such as "build-example.ts"`);
  }
  const packs: LawPack[] = [];
  for (const name of names as string[]) {
    const { lawPack } = (await import(pathToFileURL(path.join(path.dirname(file), name)).href)) as { lawPack?: LawPack };
    if (!lawPack || typeof lawPack.build !== 'function' || typeof lawPack.urls !== 'function' || !lawPack.hosts.every((host) => HOST.test(host))) {
      throw new Error(`${name} does not export a law pack (lawPack: name, hosts, urls, build)`);
    }
    packs.push(lawPack);
  }
  return packs;
}

/** The hosts the build may fetch from: the core sources' and every pack's. */
export function allowedHosts(packs: readonly LawPack[]): ReadonlySet<string> {
  return new Set([...ALLOWED_HOSTS, ...packs.flatMap((pack) => pack.hosts)]);
}
