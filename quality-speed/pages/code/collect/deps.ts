// SPDX-License-Identifier: Apache-2.0
// Direct npm dependencies of web/ measured against the repository's own update policy (.github/dependabot.yml):
// Dependabot looks weekly and waits 7 days before proposing a minor or patch release and 30 days before a major. So a
// dependency is current while no newer stable release has been out longer than that wait plus one week: 14 days
// within its major, 37 days for a new major. Anything older than that is an update the process should have brought.
// Libyears (Cox et al., ICSE 2015: the release-date gap between the installed and the newest version) are reported
// beside it for the drill-down.

export const MINOR_GRACE_DAYS = 7 + 7;
export const MAJOR_GRACE_DAYS = 30 + 7;
const DAY_MS = 86_400_000;

type Version = [number, number, number];

/** A stable x.y.z version, or undefined for prereleases and anything else. */
export function parseVersion(v: string): Version | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export interface DependencyStatus {
  name: string;
  installed: string;
  newest: string;
  current: boolean;
  /** The release the policy should already have brought, when behind. */
  overdue?: string;
  libyears: number;
}

/**
 * Judges one dependency from its registry `time` map (version to ISO date, as the npm registry serves it).
 * Throws when the installed version is not in the map: a missing measurement, never a pass.
 */
export function judgeDependency(name: string, installed: string, time: Record<string, string>, now: Date): DependencyStatus {
  const own = parseVersion(installed);
  const installedAt = time[installed];
  if (!own || !installedAt) throw new Error(`${name}@${installed}: no release date in the registry`);
  let newest = installed;
  let newestVersion = own;
  let overdue: string | undefined;
  let overdueVersion: Version | undefined;
  for (const [version, date] of Object.entries(time)) {
    const v = parseVersion(version);
    if (!v || compareVersions(v, own) <= 0) continue;
    const released = Date.parse(date);
    if (!Number.isFinite(released) || released > now.getTime()) continue;
    if (compareVersions(v, newestVersion) > 0) {
      newest = version;
      newestVersion = v;
    }
    const grace = (v[0] > own[0] ? MAJOR_GRACE_DAYS : MINOR_GRACE_DAYS) * DAY_MS;
    if (now.getTime() - released > grace && (!overdueVersion || compareVersions(v, overdueVersion) > 0)) {
      overdue = version;
      overdueVersion = v;
    }
  }
  const gap = Date.parse(time[newest] ?? installedAt) - Date.parse(installedAt);
  return { name, installed, newest, current: overdue === undefined, overdue, libyears: Math.max(0, gap) / (365.25 * DAY_MS) };
}

/** Direct dependency names with the versions package-lock.json installs. */
export function installedDirect(packageJson: unknown, lock: unknown): { name: string; version: string }[] {
  const pkg = packageJson as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const packages = (lock as { packages?: Record<string, { version?: string }> }).packages ?? {};
  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].sort();
  return names.map((name) => {
    const version = packages[`node_modules/${name}`]?.version;
    if (!version) throw new Error(`${name}: not in package-lock.json`);
    return { name, version };
  });
}

/** Fetches a package's release dates from the npm registry. */
export async function registryTimes(name: string, fetcher: typeof fetch = fetch): Promise<Record<string, string>> {
  const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}`;
  const res = await fetcher(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${name}: registry answered ${res.status}`);
  const body = (await res.json()) as { time?: Record<string, string> };
  if (!body.time) throw new Error(`${name}: registry sent no release dates`);
  return body.time;
}
