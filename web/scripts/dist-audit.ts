// SPDX-License-Identifier: Apache-2.0
// Audits the built site: the CSP checks in dist-csp.ts on every page, stylesheet and script, the eager
// script budget in bundle-budget.ts per page, the image checks in dist-images.ts, dist-company.ts's check that a
// room with no matter shows no case-room words, and dist-doc-early.ts's check that /doc/ asks for its document from
// <head>. integrations/dist-audit.mjs runs it at the end of every
// `astro build` (so `npm run build`, CI and `npm run deploy` all fail on a problem); the CLI audits an
// existing build.
//
//   node scripts/dist-audit.ts [dist-dir]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { EAGER_BUDGET, pageBudget, type PageBudget } from './bundle-budget.ts';
import { checkCss, checkHtml, checkJs, type Finding } from './dist-csp.ts';
import { brandAssetsDir, configuredStoredName } from './config.ts';
import { checkCompanyPage } from './dist-company.ts';
import { checkDocEarly } from './dist-doc-early.ts';
import { checkImages } from './dist-images.ts';


function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** The route a built page answers, such as `/chronology/` for `chronology/index.html`. */
export function routeOf(rel: string): string {
  const posix = rel.split(path.sep).join('/');
  if (posix === 'index.html') return '/';
  if (posix.endsWith('/index.html')) return `/${posix.slice(0, -'index.html'.length)}`;
  return `/${posix}`;
}

/** Result of one audit run over a dist directory. */
export interface Audit {
  findings: Finding[];
  pages: { route: string; budget: PageBudget }[];
}

/**
 * Runs every check over `dist`. Pure apart from reading files, so tests can point it at a fixture tree.
 * `originals` is the folder of image originals for dist-images.ts (null skips the copy check, not the width check):
 * by default the brand pack the build used, read at call time so importing this file never reads the room config.
 */
export function auditDist(dist: string, originals: string | null = brandAssetsDir(), storedName: string = configuredStoredName()): Audit {
  const findings: Finding[] = checkImages(dist, originals);
  // The viewer reads a visual's bridge message by the stored name, a literal the build writes (astro.config.mjs). A
  // missing one would throw on every message, and links and arrow keys in every visual would stop.
  const bridgeRead = new RegExp(`\\.${storedName}\\s*===\\s*1\\b`);
  let readsBridge = false;
  const pages: Audit['pages'] = [];
  const read = (url: string) => {
    const file = path.join(dist, ...url.split('/').filter(Boolean));
    return file.startsWith(dist + path.sep) && existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  };
  // withSecurityHeaders keeps a CSP the asset response already carries, so a static-assets _headers file
  // could swap the strict page policy for a weaker one.
  if (existsSync(path.join(dist, '_headers'))) {
    findings.push({ file: '_headers', problem: 'a _headers file could replace the Worker\'s CSP; set headers in worker/headers.ts' });
  }
  for (const file of walk(dist)) {
    const rel = path.relative(dist, file);
    const ext = path.extname(file);
    if (ext !== '.html' && ext !== '.css' && ext !== '.js' && ext !== '.mjs') continue;
    const text = readFileSync(file, 'utf8');
    if ((ext === '.js' || ext === '.mjs') && bridgeRead.test(text)) readsBridge = true;
    if (ext === '.css') findings.push(...checkCss(rel, text));
    if (ext === '.js' || ext === '.mjs') findings.push(...checkJs(rel, text));
    if (ext !== '.html') continue;
    findings.push(...checkHtml(rel, text));
    findings.push(...checkCompanyPage(rel, routeOf(rel), text));
    findings.push(...checkDocEarly(rel, routeOf(rel), text, read));
    const budget = pageBudget(text, read);
    pages.push({ route: routeOf(rel), budget });
    for (const url of budget.missing) findings.push({ file: rel, problem: `script ${url} is not in the build` });
    if (budget.total > EAGER_BUDGET) {
      findings.push({ file: rel, problem: `eager script ${kb(budget.total)} gzipped is over the ${kb(EAGER_BUDGET)} budget` });
    }
  }
  if (existsSync(path.join(dist, 'visual', 'index.html')) && !readsBridge) {
    findings.push({ file: 'visual/index.html', problem: `no built script reads a visual's bridge message as .${storedName}===1` });
  }
  return { findings, pages };
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** The per-route size table and one line per problem, for the build log. */
export function formatAudit({ findings, pages }: Audit): { info: string[]; problems: string[] } {
  const width = Math.max(0, ...pages.map((p) => p.route.length));
  const info = [`eager script per page, gzipped (budget ${kb(EAGER_BUDGET)})`];
  for (const { route, budget } of pages) {
    info.push(`  ${route.padEnd(width)}  ${kb(budget.total).padStart(8)}  ${budget.modules.length} modules`);
  }
  if (findings.length === 0) info.push(`${pages.length} pages pass the CSP checks, the eager script budget, the image checks, the company room words and the /doc/ head script`);
  return { info, problems: findings.map((f) => `${f.file}: ${f.problem}`) };
}

function main(): void {
  const dist = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', 'dist'));
  if (!existsSync(dist)) {
    console.error(`dist-audit: ${dist} does not exist; run npm run build first`);
    process.exit(1);
  }
  const { info, problems } = formatAudit(auditDist(dist));
  for (const line of info) console.log(`dist-audit: ${line}`);
  for (const line of problems) console.error(`dist-audit: ${line}`);
  if (problems.length > 0) process.exit(1);
}

if (import.meta.main) main();
