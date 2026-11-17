// SPDX-License-Identifier: Apache-2.0
// The publish guard, on the built site. It works from allow-lists, so anything it doesn't recognise fails: only the files
// the build writes, only the head the build writes, and only the markup, entities and links the charts use, in the one
// plain form the kit writes, so a browser can't read it differently. Secret shapes are a last net. What
// page code can reach is fenced at run time by build.ts, not checked here. The checks that need a token (Pages
// visibility matching the repository's, the signed-out request) live in the deploy jobs. Output holds rules and allowed
// names only, because a refused name could hold anything.
//
// A page links outside this repository only to the documents its reviewed ideal.json lists as sources, each URL exactly
// as written there; the home page and every other outside link fail.
//
// The Process page, Git Crafter's own build copied into process/, is not this kit's markup: its files get the extension
// list, a size cap and the text scan, with links to this repository, Git Crafter and the hosts its maps cite as sources.
//
//   node quality-speed/core/guard.ts --site <dir> [--pages <dir>] [--allow-synthetic]
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isPublicPage, PUBLIC_PAGES, REPO } from '../contract/pages.ts';
import { validateIdeal } from '../contract/validate.ts';
import { wordsIn } from '../contract/words.ts';

export const SITE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
export const SYNTHETIC_MARK = '<meta name="qs-synthetic" content="true">';
export const MAX_WORDS = 80;
export const MAX_FIRST_VIEW_BYTES = 100_000;
/** The home page's ring names are its list of pages, counted like table data, so adding a page costs no words (#253). */
const RING_NAME = /<span class="qs-ring-name">[^<]*<\/span>/g;
/** A reading's one-word status (charts/svg.ts statusWord). Stale data adds one per reading; it is a label, not prose. */
const STATUS_WORD = /<span class="qs-state-word">(?:Stale|Too few|No proof|Missing)<\/span>/g;
/** A unit right after its number (`1729 min`, `720 h`) is part of the reading, as the number is: a healthy page shows one per value. */
const UNIT = /(\d) ?(?:ms|min|s|h|d|KB|MB|GB|B)\b/g;
/** A Road to 100 row's name (charts/road.ts): one per fix left, so a page further from 100 would show more words. Four words or fewer, like a chart label; a longer one counts. */
const ROAD_NAME = /<label class="qs-road-name"><input[^>]*><span>(?:[^<\s]+(?:\s+[^<\s]+){0,3})<\/span><\/label>|<span class="qs-road-name">(?:<svg[\s\S]*?<\/svg>)?<span>No fix yet<\/span><\/span>/g;
/** Longer than any label: past this, a text is prose, wherever it sits. */
export const MAX_RUN_WORDS = 25;
/** The only names a page may give its on-demand files. No separators, so a name can't leave the page's folder. */
export const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Each Process page file: about 1.5 times the 11-map index.html of Quality run 43537128093, 2026-11-13 (255,373 bytes). Each map adds about 17 KB. */
export const MAX_PROCESS_BYTES = 384_000;

const ASSETS: Record<string, URL> = {
  'charts.css': new URL('./charts/charts.css', import.meta.url),
  'charts.js': new URL('./charts/charts.js', import.meta.url),
  'site.css': new URL('./site.css', import.meta.url),
};
const PAGE_FILE = /^([a-z0-9-]+)\/([^/]+)\.(html|json)$/;
const ELEMENTS = new Set('a b button caption circle code details div em figcaption figure g h1 h2 h3 h4 header img input label li line main nav ol output p path polyline rect section small span strong summary svg table tbody td text tfoot th thead time title tr tspan ul'.split(' '));
const ATTRIBUTES = new Set('alt autocomplete class colspan cx cy d datetime decoding disabled dominant-baseline for height hidden href id loading max min open pathlength preserveaspectratio r role rowspan rx ry scope src step stroke-dasharray stroke-dashoffset stroke-width tabindex text-anchor title transform type value vector-effect viewbox width x x1 x2 y y1 y2'.split(' '));
const REPO_LINK = new RegExp(`^https://github\\.com/Colorado-Startups/${REPO}/(?!.*\\.\\.)[A-Za-z0-9/_.-]*$`);
const LOCAL_LINK = /^(?=.)(?:#[\w.-]*|(?:\.\.?\/)?(?:[a-z0-9-]+\/)?(?:[a-z0-9-]+\.(?:html|json))?(?:#[\w.-]*)?)$/;
/** Short on purpose, so a name can't carry a sentence. */
const FRAME = /^frames\/[a-z0-9][a-z0-9-]{0,18}\.webp$/;
/** The kit escapes every < in a data block, so one with any < in it, which could end it early, isn't a data block. */
const DATA_BLOCK = /<script type="application\/json">([^<]*)<\/script>/g;
/** The one form the kit writes. In it a browser and this pattern can't disagree about where a value ends. */
const TAG = /<([a-z][a-z0-9]*)((?: [a-zA-Z][a-zA-Z0-9:-]*(?:="[^"<>]*")?)*) ?\/?>/g;
const CLOSING_TAG = /<\/[a-z][a-z0-9]*>/g;
const ATTRIBUTE = / ([a-zA-Z][a-zA-Z0-9:-]*)(?:="([^"<>]*)")?/g;
/** The only entities the kit writes. Anything else, a number or another name, is refused, so nothing hides behind one. */
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const ENTITY = /&(?:amp|lt|gt|quot|#39);/g;
/** What can hold case content, by the names code would reach it through. */
export const NEVER_PUBLISHED = /proposal_events|audit_log|audit\/coverage-|ask-eval-|scripts\/coverage|mcp\/audit|replica-eval|ask-replica/i;
/** Git Crafter's build writes a page with its script and style inline; json, css, js and svg leave room for a split build. */
const PROCESS_FILE = /^process\/(?:[a-z0-9][a-z0-9-]{0,63}\/)*[a-z0-9][a-z0-9-]{0,63}\.(?:html|json|css|js|svg)$/;
const GIT_CRAFTER_LINK = /^https:\/\/github\.com\/SoulCraft-Org\/git-crafter\/(?!.*\.\.)[A-Za-z0-9/_.#-]*$/;
/**
 * The hosts the Process maps cite. Ours (process/*.json) fail their PR's test until added here. The library maps a `use` pulls in
 * (Git Crafter pages/maps/*.json, at the pin in quality-speed.yml) reach the page only through Git Crafter's build: before a pin
 * bump, list their hosts. v4.6.4 adds the last seven.
 */
const PROCESS_HOSTS = new Set([
  'claude.dev', 'code.claude.com', 'google.github.io', 'trunkbaseddevelopment.com',
  'developers.cloudflare.com', 'docs.github.com', 'dora.dev', 'learn.microsoft.com', 'peps.python.org', 'sre.google', 'www.anthropic.com',
]);
const SECRET = /gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|sk-or-v1-[A-Za-z0-9]{16,}|hf_[A-Za-z0-9]{16,}|gsk_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{16,}|A(?:KIA|SIA)[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{10,}\.eyJ/;
const BASE64_RUN = /[A-Za-z0-9+/]{24,}={0,2}/g;
const OPAQUE_RUN = /[A-Za-z0-9+_=-]{65,}/;
/** A scheme with slashes either way, a protocol-relative start, or a scheme that takes none, followed by something. A scheme is at most 32 characters, so a long run of letters scans in linear time (unbounded took 70 s on 384 KB) and its tail is still caught. */
const URL_LIKE = /[a-z][a-z0-9+.-]{0,31}:[/\\]+[^\s"'<>)]*|(?<![\w/\\:.-])[/\\]{2}[^\s"'<>)]+|\b(?:mailto|javascript|data|tel|sms|file|blob|vbscript):[^\s"'<>)]+/gi;

/** The whole head of a page, which is the only one the guard accepts. `title` is already escaped. */
export function pageHead(title: string, root: string, synthetic: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${SITE_CSP}">${synthetic ? SYNTHETIC_MARK : ''}<title>${title}</title><link rel="stylesheet" href="${root}charts.css"><link rel="stylesheet" href="${root}site.css"><script type="module" src="${root}charts.js"></script></head><body>`;
}

export const PAGE_END = '</body></html>\n';

const decode = (text: string) => text.replace(ENTITY, (entity) => ENTITIES[entity] ?? entity);

/** The words a person sees: table data, closed drill-downs and screen-reader text don't count, and neither do numbers. */
export function countWords(body: string): number {
  return wordsIn(
    decode(
      body
        .replace(/<(script|table)\b[\s\S]*?<\/\1>/g, ' ')
        .replace(/<details\b(?![^>]*\bopen\b)[\s\S]*?<\/details>/g, ' ')
        .replace(/<section class="qs-film"[\s\S]*?<\/section>/g, ' ')
        .replace(/<(span|figcaption) class="qs-sr">[\s\S]*?<\/\1>/g, ' ')
        .replace(STATUS_WORD, ' ')
        .replace(ROAD_NAME, ' ')
        .replace(UNIT, '$1')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

/** Every plain file under a folder, by path from the top. A symlink or anything else stops there and is reported. */
function walk(dir: string, errors: string[], root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    const stat = lstatSync(file);
    if (stat.isDirectory()) return walk(file, errors, root);
    if (stat.isFile()) return [path.relative(root, file)];
    errors.push('site: something here is not a plain file');
    return [];
  });
}

const repoLink = (url: string) => REPO_LINK.test(url);

/** A page's sources: the only outside links it may carry, exactly as its valid ideal.json lists them. None if it has none. */
function sourceLinks(pagesDir: string, page: string): Set<string> {
  try {
    return new Set(validateIdeal(JSON.parse(readFileSync(path.join(pagesDir, page, 'ideal.json'), 'utf8'))).value?.sources.map((s) => s.url) ?? []);
  } catch {
    return new Set();
  }
}

/** A Process page link: this repository or Git Crafter, or plain https to a listed host. Trailing ; , . is the sentence's. */
export function processLink(url: string): boolean {
  const bare = url.replace(/[;,.]+$/, '');
  if (REPO_LINK.test(bare) || GIT_CRAFTER_LINK.test(bare)) return true;
  try {
    const u = new URL(bare);
    return u.href === bare.replace(/^(https:\/\/[^/]+)$/, '$1/') && u.protocol === 'https:' && !u.username && !u.password && !u.port && PROCESS_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** Secrets, the never-published list and links. */
function scanText(text: string, where: string, errors: string[], linkOk: (url: string) => boolean = repoLink): void {
  if (NEVER_PUBLISHED.test(text)) errors.push(`${where}: names something never published`);
  const decoded = (text.match(BASE64_RUN) ?? []).map((run) => Buffer.from(run, 'base64').toString('latin1'));
  if (SECRET.test(text) || decoded.some((d) => SECRET.test(d)) || OPAQUE_RUN.test(text)) errors.push(`${where}: looks like a secret`);
  if ((text.match(URL_LIKE) ?? []).some((url) => !linkOk(url))) errors.push(`${where}: links outside this repository`);
}

/** Every string in a JSON value, keys too, as parsed, so an escape can't hide one. */
function checkJsonValue(value: unknown, where: string, errors: string[], linkOk: (url: string) => boolean = repoLink): void {
  if (typeof value === 'string') {
    scanText(value, where, errors, linkOk);
    if (wordsIn(value) > MAX_RUN_WORDS) errors.push(`${where}: holds prose`);
  } else if (Array.isArray(value)) {
    for (const item of value) checkJsonValue(item, where, errors, linkOk);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      checkJsonValue(key, where, errors, linkOk);
      checkJsonValue(item, where, errors, linkOk);
    }
  }
}

function checkJson(text: string, where: string, errors: string[], linkOk: (url: string) => boolean = repoLink): void {
  try {
    checkJsonValue(JSON.parse(text), where, errors, linkOk);
  } catch {
    errors.push(`${where}: not valid JSON`);
  }
}

/** One element: on the list, with attributes on the list, and any link in an allowed form. */
function checkTag(name: string, attributes: string, where: string, errors: string[], linkOk: (url: string) => boolean): void {
  if (!ELEMENTS.has(name)) errors.push(`${where}: an element is not on the list`);
  for (const [, key = '', value = ''] of attributes.matchAll(ATTRIBUTE)) {
    const attribute = key.toLowerCase();
    if (!ATTRIBUTES.has(attribute) && !/^(?:aria|data)-[a-z0-9-]+$/.test(attribute)) errors.push(`${where}: an attribute is not on the list`);
    if (wordsIn(value) > MAX_RUN_WORDS) errors.push(`${where}: holds prose`);
    if (attribute === 'src' && (name !== 'img' || !FRAME.test(value))) errors.push(`${where}: an image is not a frame`);
    const local = REPO_LINK.test(value) || LOCAL_LINK.test(value);
    if ((attribute === 'data-src' && !local) || (attribute === 'href' && !local && !linkOk(value))) errors.push(`${where}: links outside this repository`);
  }
}

/** A page's head is exactly the build's, and everything after it is on the lists. */
function checkHtml(file: string, html: string, options: GuardOptions, errors: string[], linkOk: (url: string) => boolean): void {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  const root = file.includes('/') ? '../' : '';
  const head = [pageHead(title, root, false), pageHead(title, root, true)].find((h) => html.startsWith(h));
  if (!head || !html.endsWith(PAGE_END)) return void errors.push(`${file}: the head is not the build's`);
  if (wordsIn(title) > MAX_RUN_WORDS) errors.push(`${file}: holds prose`);
  const marked = head.includes(SYNTHETIC_MARK);
  if (marked && !options.allowSynthetic) errors.push(`${file}: invented numbers`);
  if (!marked && options.allowSynthetic) errors.push(`${file}: a real page in a test build`);
  const whole = html.slice(head.length, -PAGE_END.length);
  for (const [, block = ''] of whole.matchAll(DATA_BLOCK)) checkJson(block, file, errors, linkOk);
  const body = whole.replace(DATA_BLOCK, ' ');
  const text = body.replace(TAG, (_match, name: string, attributes: string) => {
    checkTag(name, attributes, file, errors, linkOk);
    return '  ';
  }).replace(CLOSING_TAG, '  ');
  if (/[<>]/.test(text)) errors.push(`${file}: markup the guard can't read`);
  if (/&(?!(?:amp|lt|gt|quot|#39);)/.test(title + body)) errors.push(`${file}: an entity the guard can't read`);
  if (text.split(/\s{2,}/).some((run) => wordsIn(run) > MAX_RUN_WORDS)) errors.push(`${file}: holds prose`);
  const words = countWords(file === 'index.html' ? body.replace(RING_NAME, ' ') : body);
  if (words > MAX_WORDS) errors.push(`${file}: ${words} visible words, the limit is ${MAX_WORDS}`);
  if (path.basename(file) === 'index.html') {
    const bytes = Buffer.byteLength(html) + Object.values(ASSETS).reduce((sum, url) => sum + lstatSync(url).size, 0);
    if (bytes > MAX_FIRST_VIEW_BYTES) errors.push(`${file}: first view is ${bytes} bytes, the limit is ${MAX_FIRST_VIEW_BYTES}`);
  }
}

/** A Process page file: on the extension list, under the cap, and its text scanned. */
function checkProcessFile(site: string, file: string, errors: string[]): void {
  if (!PROCESS_FILE.test(file) || SECRET.test(file)) return void errors.push('site: a file is not on the list');
  const bytes = lstatSync(path.join(site, file)).size;
  // A big file is still scanned, so one run shows every rule it breaks.
  if (bytes > MAX_PROCESS_BYTES) errors.push(`${file}: ${bytes} bytes, the limit is ${MAX_PROCESS_BYTES}`);
  scanText(readFileSync(path.join(site, file), 'utf8'), file, errors, processLink);
}

interface GuardOptions {
  /** This is a test build: every page must carry the mark, and it must never be published. */
  allowSynthetic?: boolean;
  /** Where each page's ideal.json is, for the sources its page may link; the repository's pages by default. */
  pagesDir?: string;
}

/** Every problem with a built site. */
export function guardSite(site: string, options: GuardOptions = {}): string[] {
  const errors: string[] = [];
  const pagesDir = options.pagesDir ?? fileURLToPath(new URL('../pages', import.meta.url));
  const sources = new Map<string, Set<string>>();
  const files = walk(site, errors);
  const required = ['index.html', 'history.json', ...Object.keys(ASSETS), ...PUBLIC_PAGES.map((page) => `${page}/index.html`)];
  if (required.some((file) => !files.includes(file))) errors.push('site: a page or file the build always writes is missing');
  for (const file of files) {
    if (file.startsWith('process/')) {
      checkProcessFile(site, file, errors);
      continue;
    }
    const asset = ASSETS[file];
    if (asset) {
      if (!readFileSync(path.join(site, file)).equals(readFileSync(asset))) errors.push(`${file}: differs from the source`);
      continue;
    }
    const match = PAGE_FILE.exec(file);
    const named = file === 'index.html' || file === 'history.json' || (match && isPublicPage(match[1] ?? '') && SAFE_NAME.test(match[2] ?? '') && !SECRET.test(match[2] ?? ''));
    if (!named) {
      errors.push('site: a file is not on the list');
      continue;
    }
    const page = match?.[1];
    if (page && !sources.has(page)) sources.set(page, sourceLinks(pagesDir, page));
    const listed = (page && sources.get(page)) || new Set<string>();
    // A link as written in the raw text or an attribute is entity-escaped; the parsed JSON form is not.
    const linkOk = (url: string) => repoLink(url) || listed.has(url) || listed.has(decode(url));
    const text = readFileSync(path.join(site, file), 'utf8');
    // The raw text as well as the parsed form, head included, so nothing depends on parsing being honest.
    scanText(text, file, errors, linkOk);
    if (file.endsWith('.html')) checkHtml(file, text, options, errors, linkOk);
    else checkJson(text, file, errors, linkOk);
  }
  return errors;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { site: { type: 'string' }, pages: { type: 'string' }, 'allow-synthetic': { type: 'boolean' } } });
  if (!values.site) {
    console.error('usage: guard.ts --site <dir> [--pages <dir>] [--allow-synthetic]');
    process.exit(1);
  }
  const errors = guardSite(values.site, { allowSynthetic: values['allow-synthetic'] ?? false, pagesDir: values.pages });
  for (const error of errors) console.error(error);
  if (errors.length) process.exit(1);
  console.log('Publish guard passed.');
}
