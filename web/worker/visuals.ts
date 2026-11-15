// SPDX-License-Identifier: Apache-2.0
// The visual binder: a manifest file (<stored name>-visuals.json) mirrored next to the HTML visuals says how
// they group into sections, in what order, and what each card says. The repo holds only this schema;
// the manifest itself is matter content and lives in the mirrored folder, D1 and R2 like any document.
import { STORED_NAME } from './stored-name.ts';

/** The mirrored file that describes the binder. Its folder is the base for every `file` in it. */
export const MANIFEST_NAME = `${STORED_NAME}-visuals.json`;

// The side files' key format and PNG limits live in side-files.ts, which sync uses too; the binder's callers keep
// importing them from here.
export {
  isVisualAiKey, pngSize, sidePngFits, visualAiKey, VISUAL_AI_PREFIX, VISUAL_PNG_MAX_BYTES, VISUAL_PNG_MAX_PIXELS, type VisualAiExt,
} from './side-files.ts';

/** The room page that shows one visual in the binder (src/pages/visual). */
export function visualPath(slug: string): string {
  return `/visual/?v=${encodeURIComponent(slug)}`;
}

/** Card accents the room styles. Anything else is refused so the manifest cannot inject CSS. */
export const ACCENTS = ['forest', 'gold', 'teal', 'rust', 'plum', 'crimson', 'ink'] as const;
export type Accent = (typeof ACCENTS)[number];

/** Icons in the binder's sprite (src/components/VisualIcons.astro). */
export const ICONS = [
  'compass', 'timeline', 'scroll', 'quill', 'building', 'seed', 'coins', 'ledger', 'filing', 'org',
  'scales', 'pictures', 'search',
] as const;
export type Icon = (typeof ICONS)[number];

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.html?$/;
const MAX_SECTIONS = 64;
const MAX_VISUALS = 1000;

export interface ManifestSection {
  slug: string;
  /** Short tab label, for example "Tab 4A". */
  label: string;
  title: string;
  summary: string | null;
  accent: Accent;
  icon: Icon;
}

export interface ManifestVisual {
  slug: string;
  section: string;
  /** File name in the manifest's folder. Flat on purpose: no subfolders, no "..". */
  file: string;
  title: string;
  summary: string | null;
  /** The section's landing page (its hub), shown first and labelled Overview. */
  overview: boolean;
}

export interface VisualManifest {
  sections: ManifestSection[];
  visuals: ManifestVisual[];
}

/** What /api/visuals returns: the manifest joined to live documents, so every visual has an id. */
export interface RoomVisual {
  slug: string;
  id: string;
  section: string;
  title: string;
  summary: string | null;
  overview: boolean;
  /** Where the frame loads it when not /files/<id>: a visual a member's AI saved (worker/proposal-visual.ts). */
  src?: string;
  privileged?: boolean;
}

export interface RoomSection {
  slug: string;
  label: string;
  title: string;
  summary: string | null;
  accent: Accent;
  icon: Icon;
  /** Visual slugs in reading order. */
  visuals: string[];
}

export interface RoomBinder {
  sections: RoomSection[];
  visuals: RoomVisual[];
}

export class ManifestError extends Error {
  override name = 'ManifestError';
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ManifestError(`${where} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string, max: number): string {
  if (typeof value !== 'string') throw new ManifestError(`${where} must be a string`);
  const trimmed = value.normalize('NFC').trim();
  if (!trimmed || trimmed.length > max) throw new ManifestError(`${where} must be 1 to ${max} characters`);
  return trimmed;
}

function optionalText(value: unknown, where: string, max: number): string | null {
  return value === undefined || value === null || value === '' ? null : text(value, where, max);
}

function slug(value: unknown, where: string): string {
  if (typeof value !== 'string' || !SLUG.test(value)) throw new ManifestError(`${where} must be a lowercase slug`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T, where: string): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new ManifestError(`${where} must be one of ${allowed.join(', ')}`);
}

function list(value: unknown, where: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new ManifestError(`${where} must be an array`);
  if (value.length > max) throw new ManifestError(`${where} has more than ${max} entries`);
  return value;
}

function parseSection(raw: unknown, i: number): ManifestSection {
  const where = `sections[${i}]`;
  const r = record(raw, where);
  return {
    slug: slug(r.slug, `${where}.slug`),
    label: text(r.label, `${where}.label`, 24),
    title: text(r.title, `${where}.title`, 200),
    summary: optionalText(r.summary, `${where}.summary`, 400),
    accent: oneOf(r.accent, ACCENTS, 'forest', `${where}.accent`),
    icon: oneOf(r.icon, ICONS, 'scroll', `${where}.icon`),
  };
}

function parseVisual(raw: unknown, i: number, sections: ReadonlySet<string>): ManifestVisual {
  const where = `visuals[${i}]`;
  const r = record(raw, where);
  const section = slug(r.section, `${where}.section`);
  if (!sections.has(section)) throw new ManifestError(`${where}.section names an unknown section`);
  if (typeof r.file !== 'string' || !FILE.test(r.file)) throw new ManifestError(`${where}.file must be a plain .html file name`);
  return {
    slug: slug(r.slug, `${where}.slug`),
    section,
    file: r.file,
    title: text(r.title, `${where}.title`, 200),
    summary: optionalText(r.summary, `${where}.summary`, 400),
    overview: r.overview === true,
  };
}

/** Validates a parsed manifest. Unknown fields are dropped; anything malformed throws ManifestError. */
export function parseManifest(raw: unknown): VisualManifest {
  const root = record(raw, 'manifest');
  if (root.version !== 1) throw new ManifestError('manifest.version must be 1');

  const sections = list(root.sections, 'sections', MAX_SECTIONS).map(parseSection);
  const sectionSlugs = new Set<string>();
  for (const section of sections) {
    if (sectionSlugs.has(section.slug)) throw new ManifestError(`duplicate section slug ${section.slug}`);
    sectionSlugs.add(section.slug);
  }

  const visuals = list(root.visuals, 'visuals', MAX_VISUALS).map((v, i) => parseVisual(v, i, sectionSlugs));
  const visualSlugs = new Set<string>();
  for (const visual of visuals) {
    if (visualSlugs.has(visual.slug)) throw new ManifestError(`duplicate visual slug ${visual.slug}`);
    visualSlugs.add(visual.slug);
  }
  return { sections, visuals };
}

/** A live mirrored visual, as read from D1. */
export interface VisualDocument {
  id: string;
  path: string;
}

/**
 * Joins the manifest to the visuals that are actually in the room. A visual whose file has not synced
 * (or was removed) is left out rather than shown as a broken card, and an empty section disappears.
 * Within a section the overview comes first, then the manifest order.
 */
export function resolveBinder(manifest: VisualManifest, folder: string, docs: readonly VisualDocument[]): RoomBinder {
  const idByPath = new Map(docs.map((doc) => [doc.path, doc.id]));
  const prefix = folder ? `${folder}/` : '';

  const bySection = new Map<string, RoomVisual[]>();
  for (const visual of manifest.visuals) {
    const id = idByPath.get(prefix + visual.file);
    if (!id) continue;
    const room: RoomVisual = {
      slug: visual.slug,
      id,
      section: visual.section,
      title: visual.title,
      summary: visual.summary,
      overview: visual.overview,
    };
    const group = bySection.get(visual.section) ?? [];
    group.push(room);
    bySection.set(visual.section, group);
  }

  const sections: RoomSection[] = [];
  const visuals: RoomVisual[] = [];
  for (const section of manifest.sections) {
    const group = bySection.get(section.slug);
    if (!group?.length) continue;
    const ordered = [...group.filter((v) => v.overview), ...group.filter((v) => !v.overview)];
    sections.push({ ...section, visuals: ordered.map((v) => v.slug) });
    visuals.push(...ordered);
  }
  return { sections, visuals };
}
