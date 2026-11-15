// SPDX-License-Identifier: Apache-2.0
// dev:seed's matter step. scripts/dev-seed.ts runs it after the local sync when this file is in the checkout: F2's
// fixture manifest (web/fixtures/matter.example.json) becomes a drafting fragment, then `matter build --local` and
// `matter publish --local --expect <sha>` (paths -> the ids the sync just made), so the local room shows the fixture's
// case picture.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Cite, FragmentCite, Matter, MatterFragment, MatterMeta } from '../../worker/matter-types.ts';
import { loadFixtureInputs } from '../dev-fixture.ts';
import { pathById } from '../dev-fixture-text.ts';
import { matterPaths } from './paths.ts';

/**
 * F2's fixture manifest as a drafting fragment: every cite and docs key goes from a fixture id to its path, so
 * `matter build` resolves it to whatever id the local sync gave that path. builtAt is the build's to set.
 */
export function matterToFragment(matter: Matter, idToPath: ReadonlyMap<string, string>): MatterFragment {
  const toPath = (id: string) => {
    const docPath = idToPath.get(id);
    if (!docPath) throw new Error(`Fixture document ${id} has no path in doc-ids.json`);
    return docPath;
  };
  const cite = ({ doc, ...rest }: Cite): FragmentCite => ({ path: toPath(doc), ...rest });
  const withCites = <T extends { cites: Cite[] }>(entry: T) => ({ ...entry, cites: entry.cites.map(cite) });
  const pleading = (p: MatterMeta['operativePleading']) => p && { ...p, cite: cite(p.cite) };
  const { builtAt: _builtAt, operativePleading, priorCase, definedTerms, ...meta } = matter.meta;
  return {
    card: 'dev-seed',
    meta: {
      ...meta,
      operativePleading: pleading(operativePleading),
      ...(priorCase ? { priorCase: { ...priorCase, operativePleading: pleading(priorCase.operativePleading) } } : {}),
      definedTerms: definedTerms.map((term) => (term.cite ? { ...term, cite: cite(term.cite) } : term)),
    } as MatterFragment['meta'],
    tracks: matter.tracks.map(({ brief, ...track }) => ({
      ...track,
      points: track.points.map((point) => ({ ...point, proof: point.proof.map((p) => ({ ...p, cite: cite(p.cite) })) })),
      ...(brief ? {
        brief: {
          ...brief,
          hurdles: brief.hurdles.map(withCites),
          dates: brief.dates.map(withCites),
          exhibits: brief.exhibits.map((x) => ({ ...x, cite: cite(x.cite) })),
          drafts: brief.drafts.map(({ doc, ...draft }) => ({ ...draft, path: toPath(doc) })),
        },
      } : {}),
    })),
    violations: matter.violations.map((v) => ({
      ...withCites(v),
      steps: v.steps.map(withCites),
      figures: v.figures.map(withCites),
      ...(v.contrast ? { contrast: v.contrast.map(withCites) } : {}),
    })),
    events: matter.events.map(withCites),
    people: matter.people.map(withCites),
    orgs: matter.orgs.map(withCites),
    links: matter.links.map((link) => (link.statements ? { ...withCites(link), statements: link.statements.map(withCites) } : withCites(link))),
    claims: matter.claims.map((claim) => ({
      ...withCites(claim),
      elements: claim.elements.map((el) => ({ ...el, proof: el.proof.map((p) => ({ ...p, cite: cite(p.cite) })) })),
    })),
    money: matter.money.map(withCites),
    docs: Object.fromEntries(Object.entries(matter.docs).map(([id, facts]) => [toPath(id), facts])),
  };
}

/** Runs a command in web/ and returns its output: dev-seed.ts's runner. */
export type SeedRun = (cmd: string, args: string[]) => Promise<string>;

/**
 * Builds the fixture's manifest with the scratch config dev:seed wrote (`config`, whose cacheDir is `cacheDir`) and
 * publishes it to the local room. Returns the published sha256.
 */
export async function seedMatter(cacheDir: string, config: string, run: SeedRun, log: (line: string) => void, inputsDir?: string, target: 'local' | 'remote' = 'local'): Promise<string> {
  const where = target === 'local' ? ['--local'] : [];
  const inputs = await loadFixtureInputs(inputsDir);
  const fragment = matterToFragment(inputs.matter, pathById(inputs.docIds));
  const files = matterPaths(cacheDir);
  await mkdir(files.fragments, { recursive: true, mode: 0o700 });
  await writeFile(path.join(files.fragments, 'dev-seed.json'), `${JSON.stringify(fragment, null, 2)}\n`, { mode: 0o600 });
  const build = await run('node', ['scripts/matter/cli.ts', 'build', ...where, '--config', config]);
  if (!/Check: passes\./.test(build)) throw new Error(`matter build did not pass:\n${build}`);
  const sha = (await readFile(files.sha, 'utf8')).split(/\s+/)[0];
  await run('node', ['scripts/matter/cli.ts', 'publish', ...where, '--expect', sha, '--config', config]);
  log(`Matter: built and published to the ${target} room (sha256 ${sha.slice(0, 12)}).`);
  return sha;
}
