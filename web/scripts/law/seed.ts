// SPDX-License-Identifier: Apache-2.0
// node scripts/law/seed.ts <file>: puts a supplied text (a law pack's opinion with `supplied`, a source the build never
// downloads) into the law raw cache, under the source's cache key with its retrieval date and provenance. The file must
// be the one a pack pins by hash, so only a reviewed text can enter; nothing else is written and nothing is fetched.
//
// node scripts/law/seed.ts --unit <unit> <file>: the same for a default pack unit a person must download, whose copy
// changes with each new version of the rules, so it can't be pinned. The build checks that copy when it reads it.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PACK_UNITS, type PackUnit } from './default-pack-units.ts';
import { RawCache } from './fetch.ts';
import { allowedHosts, loadLawPacks, type LawPack } from './pack.ts';
import { lawDir, sha256 } from './plan.ts';

/** The supplied source a file is, by its hash; null when no pack pins such a text. */
export function suppliedSourceFor(body: Buffer, packs: readonly LawPack[]) {
  const hash = sha256(body);
  return packs.flatMap((pack) => pack.sources?.cases ?? []).find((source) => source.supplied?.sha256 === hash) ?? null;
}

/** Seeds a person's download of a default pack unit: it must be a PDF, for a unit that can read one. None waits today. */
export async function seedUnit(unit: string, body: Buffer, cache: RawCache, today: string, units: readonly PackUnit[] = DEFAULT_PACK_UNITS): Promise<string> {
  const planned = units.find((candidate) => candidate.id === unit);
  if (!planned || planned.source.kind !== 'person') throw new Error(`${unit} is not a default law pack unit a person downloads`);
  if (!planned.source.parser) throw new Error(`${unit} can't be built yet: no copy of it has been checked`);
  if (body.subarray(0, 4).toString() !== '%PDF') throw new Error(`that file isn't a PDF, and ${unit} is read from one`);
  await cache.seed(planned.source.address, body, { retrieved: today, via: 'downloaded by a person from the official page' });
  return `Seeded ${unit} (downloaded ${today}). Run npm run law to build it.`;
}

async function main(): Promise<void> {
  if (process.argv[2] === '--unit') {
    const [, , , unit, unitFile, extra] = process.argv;
    if (!unit || !unitFile || extra) throw new Error('usage: node scripts/law/seed.ts --unit <unit> <file>');
    const { lawPack } = await import('./default-pack.ts');
    const cache = new RawCache(path.join(lawDir(), 'raw'), fetch, undefined, allowedHosts([lawPack]));
    console.log(await seedUnit(unit, await readFile(path.resolve(unitFile)), cache, new Date().toISOString().slice(0, 10)));
    return;
  }
  const file = process.argv[2];
  if (!file || process.argv.length > 3) throw new Error('usage: node scripts/law/seed.ts <file>');
  const body = await readFile(path.resolve(file));
  const packs = await loadLawPacks();
  const source = suppliedSourceFor(body, packs);
  if (!source?.supplied) throw new Error(`${path.basename(file)} is not a supplied text a law pack pins (sha256 ${sha256(body).slice(0, 12)})`);
  const cache = new RawCache(path.join(lawDir(), 'raw'), fetch, undefined, allowedHosts(packs));
  await cache.seed(source.text, body, { retrieved: source.supplied.retrieved, via: source.supplied.via });
  console.log(`Seeded ${source.name}, ${source.cite} (${source.supplied.via}, retrieved ${source.supplied.retrieved}) under ${source.text}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
