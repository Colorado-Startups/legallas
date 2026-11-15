// SPDX-License-Identifier: Apache-2.0
// Builds the visual binder from downloaded artifacts, ready to drop into the mirrored folder.
//
//   npm run visuals -- <input-dir> <output-dir>           dry run: what would be written, every bad link
//   npm run visuals -- <input-dir> <output-dir> --write   write <slug>.html files and the binder manifest, then
//                                                         render each page's text for AIs (below)
//   npm run visuals -- --ai <folder>                      render the text of every page under <folder> that has none
//   add --no-theme to keep the pages' own look (the chambers theme pass, scripts/visualtheme.ts, is on by default)
//   add --config <file> to use another legallas.config.json (its cacheDir keeps the rendered text)
//
// Text for AIs (decision D8): each page is opened in local headless Chrome with the network off, one at a time,
// and the text it shows once its scripts have drawn their charts is kept in the sync's cache with a small PNG
// (scripts/visual-render.ts, visual-ai.ts). `npm run sync` then uploads them as side files and indexes the text
// under the visual's own document id. Re-running skips pages whose text is already cached.
//
// <input-dir>/<stored name>-visuals.json is the binder manifest (see worker/visuals.ts), where each visual also
// carries "source": { "artifact": "<claude.ai artifact id>", "path": "<file in that artifact>" }.
// <input-dir>/<artifact id>/<path> holds the artifact's published files as downloaded.
//
// Matter content: the output directory must be outside this repo. The files reach the room only through
// `npm run sync`, after the owner approves its dry run.
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MANIFEST_NAME, ManifestError, parseManifest } from '../worker/visuals.ts';
import { DEFAULT_CONFIG_PATH, loadSyncConfig } from './config.ts';
import { htmlFiles, renderVisualTexts } from './visual-render.ts';
import { prepareVisual, type PageRef } from '../worker/visualprep.ts';
import { loadThemeFonts, themeVisual, type ThemeFonts } from './visualtheme.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const USAGE = 'usage: npm run visuals -- <input-dir> <output-dir> [--write] [--no-theme] [--config <file>], or --ai <folder> [--config <file>]';

export interface ExportPlan {
  files: { name: string; html: string; source: PageRef }[];
  manifest: string;
  warnings: string[];
  /** Bytes the theme pass added across all pages (0 without a theme). */
  themeBytes: number;
  /** Per themed page: bytes added and the faces embedded with the full page set (R75). */
  themePages: { slug: string; addedBytes: number; fullFaces: string[] }[];
}

export interface ExportOptions {
  /** The embedded faces; when given, each page is themed after prepareVisual. */
  theme?: ThemeFonts | null;
}

function sourceOf(raw: unknown, slug: string): PageRef {
  const source = raw as { artifact?: unknown; path?: unknown } | null;
  const artifact = typeof source?.artifact === 'string' ? source.artifact : '';
  const file = typeof source?.path === 'string' && source.path ? source.path : 'index.html';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(artifact) || file.split('/').some((part) => part === '..' || part === '')) {
    throw new ManifestError(`visual ${slug} needs "source": { "artifact": "<id>", "path": "<file>" }`);
  }
  return { artifact, path: file };
}

/** Plans the export without touching the disk. `read` loads a source page by artifact and path. */
export async function planExport(
  rawManifest: unknown,
  read: (page: PageRef) => Promise<string>,
  options: ExportOptions = {},
): Promise<ExportPlan> {
  const raw = rawManifest as { visuals?: unknown };
  if (!Array.isArray(raw?.visuals)) throw new ManifestError('visuals must be an array');

  // Every visual is written as <slug>.html, so the input manifest does not need file names.
  const entries = raw.visuals.map((v: Record<string, unknown>) => ({ ...v, file: `${String(v?.slug)}.html` }));
  const manifest = parseManifest({ ...(rawManifest as object), visuals: entries });

  const sources = new Map<string, PageRef>();
  const slugByPage = new Map<string, string>();
  manifest.visuals.forEach((visual, i) => {
    const source = sourceOf((raw.visuals as Record<string, unknown>[])[i]!.source, visual.slug);
    sources.set(visual.slug, source);
    slugByPage.set(`${source.artifact}/${source.path}`, visual.slug);
  });
  const resolve = (page: PageRef) => slugByPage.get(`${page.artifact}/${page.path}`) ?? null;

  const files: ExportPlan['files'] = [];
  const warnings: string[] = [];
  let themeBytes = 0;
  const themePages: ExportPlan['themePages'] = [];
  for (const visual of manifest.visuals) {
    const source = sources.get(visual.slug)!;
    const prepared = prepareVisual(await read(source), source, resolve);
    const themed = options.theme ? await themeVisual(prepared.html, options.theme) : null;
    files.push({ name: visual.file, html: themed?.html ?? prepared.html, source });
    for (const warning of [...prepared.warnings, ...(themed?.warnings ?? [])]) warnings.push(`${visual.slug}: ${warning}`);
    themeBytes += themed?.addedBytes ?? 0;
    if (themed) themePages.push({ slug: visual.slug, addedBytes: themed.addedBytes, fullFaces: themed.fullFaces });
  }

  const out = { version: 1, sections: manifest.sections, visuals: manifest.visuals };
  return { files, manifest: `${JSON.stringify(out, null, 2)}\n`, warnings, themeBytes, themePages };
}

/** True when `child` is `parent` or inside it. */
function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** realpath of `dir`, or of its nearest existing ancestor when it does not exist yet. */
async function realpathOfNearest(dir: string): Promise<string> {
  for (let current = dir; ; current = path.dirname(current)) {
    try {
      return await realpath(current);
    } catch {
      if (path.dirname(current) === current) throw new Error(`No existing folder above ${dir}`);
    }
  }
}

const TARGET_KB = 120;

/** One line per themed page (KB added, faces given the full page set), then the average and the largest. */
export function themeReport(plan: ExportPlan): string {
  const kb = (bytes: number) => bytes / 1024;
  const lines = plan.themePages.map(({ slug, addedBytes, fullFaces }) => {
    const over = kb(addedBytes) > TARGET_KB ? `, over the ${TARGET_KB} KB target` : '';
    const full = fullFaces.length ? `, full set for ${fullFaces.join(' and ')} (a script writes text there)` : '';
    return `theme    ${slug}  ${kb(addedBytes).toFixed(0)} KB${over}${full}\n`;
  });
  const sizes = plan.themePages.map((page) => kb(page.addedBytes));
  const average = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  const largest = sizes.length ? Math.max(...sizes) : 0;
  return `${lines.join('')}theme    added ${kb(plan.themeBytes).toFixed(0)} KB across ${plan.files.length} pages, fonts included` +
    ` (average ${average.toFixed(0)} KB, largest ${largest.toFixed(0)} KB)\n`;
}

export interface VisualsArgs {
  input: string | null;
  output: string;
  write: boolean;
  noTheme: boolean;
  /** --ai <folder>: only render the text of the pages already in <folder>. */
  aiOnly: boolean;
  config: string;
}

export function parseVisualsArgs(args: readonly string[]): VisualsArgs {
  const rest: string[] = [];
  const parsed: VisualsArgs = { input: null, output: '', write: false, noTheme: false, aiOnly: false, config: DEFAULT_CONFIG_PATH };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--write') parsed.write = true;
    else if (arg === '--no-theme') parsed.noTheme = true;
    else if (arg === '--ai') parsed.aiOnly = true;
    else if (arg === '--config' && args[i + 1]) parsed.config = path.resolve(args[++i]!);
    else if (arg.startsWith('--')) throw new Error(USAGE);
    else rest.push(arg);
  }
  if (parsed.aiOnly) {
    if (rest.length !== 1 || parsed.write || parsed.noTheme) throw new Error(USAGE);
    return { ...parsed, output: rest[0]! };
  }
  if (rest.length !== 2) throw new Error(USAGE);
  return { ...parsed, input: rest[0]!, output: rest[1]! };
}

/** Renders the text of every page under `folder` that has none in the cache yet, and prints the counts. */
async function renderAiText(folder: string, config: string): Promise<void> {
  const { cacheDir } = await loadSyncConfig(config);
  const pages = await htmlFiles(folder);
  process.stdout.write(`\nRendering text for AIs: ${pages.length} pages, one at a time, network off...\n`);
  const run = await renderVisualTexts(pages, cacheDir, (line) => process.stdout.write(`${line}\n`));
  process.stdout.write(`Text for AIs: ${run.rendered} rendered, ${run.cached} already cached, ${run.failed} failed. npm run sync uploads and indexes it.\n`);
  if (run.failed > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const { input, output, write, noTheme, aiOnly, config } = parseVisualsArgs(process.argv.slice(2));
  if (aiOnly) {
    await renderAiText(path.resolve(output), config);
    return;
  }
  if (!input) throw new Error(USAGE);

  const inputDir = path.resolve(input);
  const outputDir = path.resolve(output);
  // Checked before anything touches the disk, through symlinks, even when the folder does not exist yet.
  if (isInside(await realpathOfNearest(outputDir), await realpath(REPO_ROOT))) {
    throw new Error('The output directory is inside the repo. Visuals are matter content: write them to the mirrored folder.');
  }

  const manifest: unknown = JSON.parse(await readFile(path.join(inputDir, MANIFEST_NAME), 'utf8'));
  const theme = noTheme ? null : await loadThemeFonts();
  const plan = await planExport(manifest, (page) => readFile(path.join(inputDir, page.artifact, page.path), 'utf8'), { theme });

  for (const file of plan.files) process.stdout.write(`${write ? 'wrote' : 'would write'}  ${file.name}\n`);
  process.stdout.write(`${write ? 'wrote' : 'would write'}  ${MANIFEST_NAME}\n`);
  for (const warning of plan.warnings) process.stdout.write(`warning  ${warning}\n`);
  if (theme) process.stdout.write(themeReport(plan));

  if (!write) {
    process.stdout.write(`\nDry run: ${plan.files.length} visuals. Add --write to write them to ${outputDir}.\n`);
    return;
  }
  await mkdir(outputDir, { recursive: true });
  for (const file of plan.files) await writeFile(path.join(outputDir, file.name), file.html, { mode: 0o600 });
  await writeFile(path.join(outputDir, MANIFEST_NAME), plan.manifest, { mode: 0o600 });
  process.stdout.write(`\nWrote ${plan.files.length} visuals to ${outputDir}.\n`);
  await renderAiText(outputDir, config);
  process.stdout.write('Run npm run sync to review the dry run.\n');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
