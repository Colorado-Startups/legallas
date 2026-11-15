// SPDX-License-Identifier: Apache-2.0
// code.dependencies-current: web/'s direct dependencies judged against the Dependabot window (deps.ts). A package the
// registry cannot answer for makes the whole metric missing.
import { installedDirect, judgeDependency, registryTimes } from './deps.ts';
import type { Context } from './main.ts';
import type { Measurement } from './records.ts';

export async function measureDependencies(ctx: Context, measured: Map<string, Measurement>, details: Record<string, unknown>) {
  const direct = installedDirect(JSON.parse(ctx.view.read('web/package.json')), JSON.parse(ctx.view.read('web/package-lock.json')));
  const statuses = [];
  for (const d of direct) statuses.push(judgeDependency(d.name, d.version, await registryTimes(d.name), ctx.now));
  const current = statuses.filter((s) => s.current).length;
  details.dependencies = {
    overdue: statuses.filter((s) => !s.current),
    libyears: statuses.reduce((a, s) => a + s.libyears, 0),
    total: statuses.length,
  };
  measured.set('dependencies_current', {
    value: (100 * current) / statuses.length,
    time: ctx.now.toISOString(),
   
    sampleSize: statuses.length,
  });
}
