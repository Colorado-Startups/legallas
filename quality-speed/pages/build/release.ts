// SPDX-License-Identifier: Apache-2.0
// The release a room deploys, built the way a deploy builds it, then checked: is every part there, how big is it, and
// does a second build in another folder give the same bytes. Each Worker is bundled inside its checkout, as
// `wrangler deploy` does (.wrangler/tmp), because a source map names its sources relative to the output folder.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { numberingProblems } from './migration-numbers.ts';

const OUT = '.qs-release';
const MiB = 1024 * 1024;

function run(cwd: string, cmd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...env } });
}

/** The second build runs in another time zone and locale too, so a date or a locale written into the output shows. */
const ELSEWHERE = { TZ: 'Pacific/Kiritimati', LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8' };

export function* walk(dir: string, base = dir): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full, base);
    else yield path.relative(base, full).split(path.sep).join('/');
  }
}

/** Builds the release from a checkout whose web/node_modules is installed, and returns its folder. */
export function buildRelease(repo: string, env: Record<string, string> = {}): string {
  const web = path.join(repo, 'web');
  const out = path.join(web, OUT);
  rmSync(out, { recursive: true, force: true });
  // The bundlers record what they drew on, for the release's third-party notices (web/scripts/notices.ts), as CI's checks job does.
  const meta = mkdtempSync(path.join(os.tmpdir(), 'qs-meta-'));
  run(web, 'npm', ['run', 'build'], { ...env, LEGALLAS_METAFILE: path.join(meta, 'site.json') });
  for (const [name, config] of [['worker-web', 'wrangler.example.jsonc'], ['worker-mcp', 'wrangler.mcp.example.jsonc']] as const) {
    run(web, 'npx', ['wrangler', 'deploy', '-c', config, '--dry-run', '--outdir', `${OUT}/${name}`, '--metafile', path.join(meta, `${name}.json`)], env);
    rmSync(path.join(out, name, 'README.md'), { force: true }); // Wrangler's note, stamped with the time
  }
  // Into the site, where the room's About screen links it (Room.astro). Fails the build when a package has no licence text.
  run(web, 'node', ['scripts/notices.ts', 'dist/THIRD-PARTY-NOTICES.txt', 'dist', ...readdirSync(meta).sort().map((f) => path.join(meta, f))], env);
  rmSync(meta, { recursive: true, force: true });
  cpSync(path.join(web, 'dist'), path.join(out, 'site'), { recursive: true });
  cpSync(path.join(web, 'migrations'), path.join(out, 'migrations'), { recursive: true });
  for (const file of ['LICENSE', 'NOTICE']) if (existsSync(path.join(repo, file))) cpSync(path.join(repo, file), path.join(out, file));
  return out;
}

/** The same release, built again from a fresh worktree of HEAD in another folder, time zone and locale, with a clean install. */
export function buildAgain(repo: string, scratch: string): string {
  const other = path.join(scratch, 'second-checkout');
  rmSync(other, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  run(repo, 'git', ['worktree', 'add', '--detach', other, 'HEAD']);
  run(path.join(other, 'web'), 'npm', ['ci', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund']);
  return buildRelease(other, ELSEWHERE);
}

export function hashes(dir: string): Map<string, string> {
  return new Map([...walk(dir)].map((f) => [f, createHash('sha256').update(readFileSync(path.join(dir, f))).digest('hex')]));
}

/** How many files the two builds hold between them, and how many differ or exist in only one. */
export function compare(a: Map<string, string>, b: Map<string, string>): { compared: number; differ: number } {
  const all = new Set([...a.keys(), ...b.keys()]);
  return { compared: all.size, differ: [...all].filter((f) => a.get(f) !== b.get(f)).length };
}

/**
 * How many D1 migrations differ from the version that first landed. D1 applies a migration by name once, so an edited
 * one never reaches a room that already ran it; a revert clears it. Needs the full history: a shallow clone has no adding
 * commit to compare with, so it throws instead of reading clean.
 */
export function editedMigrations(repo: string): number {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * MiB });
  if (git('rev-parse', '--is-shallow-repository').trim() !== 'false') throw new Error('a shallow clone cannot show migration history');
  const files = git('ls-files', 'web/migrations').split('\n').filter((f) => f.endsWith('.sql'));
  return files.filter((f) => {
    const added = git('log', '--diff-filter=A', '--format=%H', '--', f).trim().split('\n').pop();
    return !added || git('show', `${added}:${f}`) !== readFileSync(path.join(repo, f), 'utf8');
  }).length;
}

/** The release checks, in page order: each one something a change can break. Every id here is a fixed label. */
export const CHECKS = ['migrations_numbered', 'migrations_unchanged', 'third_party_notices', 'no_gpl_fonts', 'cloudflare_limits'] as const;
export type CheckId = (typeof CHECKS)[number];

/** A TrueType font's family name (name id 1), from its `name` table, or null when the bytes are not a font that has one. */
export function fontFamily(font: Buffer): string | null {
  if (font.length < 12) return null;
  const tables = font.readUInt16BE(4);
  for (let i = 0; i < tables && 12 + 16 * i + 16 <= font.length; i++) {
    const at = 12 + 16 * i;
    if (font.toString('latin1', at, at + 4) !== 'name') continue;
    const table = font.readUInt32BE(at + 8);
    if (table + 6 > font.length) return null;
    const count = font.readUInt16BE(table + 2);
    const strings = table + font.readUInt16BE(table + 4);
    for (let r = 0; r < count && table + 6 + 12 * r + 12 <= font.length; r++) {
      const rec = table + 6 + 12 * r;
      if (font.readUInt16BE(rec + 6) !== 1) continue;
      const length = font.readUInt16BE(rec + 8);
      const start = strings + font.readUInt16BE(rec + 10);
      if (start + length > font.length) return null;
      const raw = font.subarray(start, start + length);
      return font.readUInt16BE(rec) === 1 ? raw.toString('latin1') : Buffer.from(raw).swap16().toString('utf16le');
    }
  }
  return null;
}

export function checks(dir: string, edited: number): Record<CheckId, boolean> {
  const files = [...walk(dir)];
  const size = (f: string) => statSync(path.join(dir, f)).size;
  const site = files.filter((f) => f.startsWith('site/'));
  const sql = files.filter((f) => /^migrations\/[^/]+\.sql$/.test(f)).map((f) => f.slice('migrations/'.length));
  const workers = files.filter((f) => /^worker-[a-z]+\/[^/]+\.js$/.test(f));
  return {
    // migration-numbers.ts: in order, each number once but the two pairs that landed before the check (#362).
    migrations_numbered: sql.length > 0 && numberingProblems(sql).length === 0,
    migrations_unchanged: edited === 0,
    // Served from the site, so the room's About screen can show it (#31).
    third_party_notices: site.some((f) => /^site\/THIRD-PARTY-NOTICES(\.txt)?$/.test(f) && size(f) > 0),
    // GPL-2.0 with a font exception (#31): Liberation Sans as pdf.js ships it. pdf.js names its Helvetica and Arial
    // fallbacks LiberationSans-*.ttf, and the site serves Arimo (OFL-1.1) at those paths, so the file's own family
    // decides, not its name. A file that is not a font with a readable family fails.
    no_gpl_fonts: site.filter((f) => /\/LiberationSans-[^/]*\.ttf$/.test(f)).every((f) => {
      const family = fontFamily(readFileSync(path.join(dir, f)));
      return family !== null && !/liberation/i.test(family);
    }),
    // Cloudflare Workers limits: 64 MiB a Worker, 25 MiB an asset, 20,000 assets on the Free plan.
    cloudflare_limits: workers.length === 2 && workers.every((w) => size(w) <= 64 * MiB) && site.length <= 20_000 && site.every((f) => size(f) <= 25 * MiB),
  };
}

/** What the release's parts weigh, each file gzipped at level 9. The parts are fixed labels; every byte lands in one. */
export const PARTS = ['site', 'pdfjs', 'rive', 'liberation', 'maps', 'worker_mcp', 'worker_web', 'other'] as const;
export type PartId = (typeof PARTS)[number];

export function partOf(file: string): PartId {
  if (file.endsWith('.map')) return 'maps';
  if (/\/LiberationSans-/.test(file)) return 'liberation';
  if (file.startsWith('site/_astro/rive.')) return 'rive';
  if (file.startsWith('site/pdfjs/')) return 'pdfjs';
  if (file.startsWith('site/')) return 'site';
  if (file.startsWith('worker-mcp/')) return 'worker_mcp';
  if (file.startsWith('worker-web/')) return 'worker_web';
  return 'other';
}

export function gzipParts(dir: string): Record<PartId, number> {
  const parts = Object.fromEntries(PARTS.map((p) => [p, 0])) as Record<PartId, number>;
  for (const f of walk(dir)) parts[partOf(f)] += gzipSync(readFileSync(path.join(dir, f)), { level: 9 }).length;
  return parts;
}

/** The n heaviest files, gzipped at level 9, for the lane's log: where the release's bytes are. */
export function heaviest(dir: string, n: number): string[] {
  return [...walk(dir)].map((f) => [f, gzipSync(readFileSync(path.join(dir, f)), { level: 9 }).length] as const).sort((a, b) => b[1] - a[1]).slice(0, n).map(([f, b]) => `${b} ${f}`);
}
