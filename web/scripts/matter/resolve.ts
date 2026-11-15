// SPDX-License-Identifier: Apache-2.0
// Card F4. Turns path cites into documents.id cites through the live mirror rows (MIRROR_ROWS_SQL, the read
// sync starts from). A cite whose path is not a live mirror document is dropped from the build and listed as
// unresolved; `matter check` fails until there are none.
import type { Wrangler } from '../wrangler.ts';
import { MIRROR_ROWS_SQL } from '../sqlplan.ts';
import { normalizeCatalogPath } from './catalog.ts';
import type { Entry } from './fragments.ts';

/** A cite that could not be resolved, with where it sits. */
export interface Unresolved {
  /** Where the cite sits, for example "events:ev-0003" or "claims:count-1/el-2/proof". */
  where: string;
  path: string;
  page: number | null;
}

/** What cite resolution needs: document ids by path. */
export interface Resolver {
  /** documents.id by documents.path (NFC). */
  ids: Map<string, string>;
  /** documents.path by documents.id, for the report. */
  paths: Map<string, string>;
  sourceRoot: string;
}

/** Reads the live mirror rows. Only id and path are used. */
export async function loadResolver(w: Pick<Wrangler, 'd1Query'>, sourceRoot: string): Promise<Resolver> {
  const ids = new Map<string, string>();
  const paths = new Map<string, string>();
  for (const row of await w.d1Query(MIRROR_ROWS_SQL)) {
    if (typeof row.id !== 'string' || typeof row.path !== 'string') throw new Error('Unexpected documents row from D1');
    const docPath = row.path.normalize('NFC');
    ids.set(docPath, row.id);
    paths.set(row.id, docPath);
  }
  return { ids, paths, sourceRoot };
}

/** Resolves a raw catalog path to a document id, or null when it is not in the catalog. */
export function resolvePath(resolver: Resolver, raw: string): string | null {
  const docPath = normalizeCatalogPath(raw, resolver.sourceRoot);
  return docPath === null ? null : (resolver.ids.get(docPath) ?? null);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The outcome of resolving cites: the cites left unresolved and the problems found. */
export class CiteResolution {
  readonly unresolved: Unresolved[] = [];
  readonly problems: string[] = [];
  /** documents.id of every resolved cite. */
  readonly cited = new Set<string>();
  private readonly resolver: Resolver;

  constructor(resolver: Resolver) {
    this.resolver = resolver;
  }

  /** One fragment cite to a built cite, or null when it is malformed or unresolved (both are recorded). */
  cite(raw: unknown, where: string): Record<string, unknown> | null {
    if (!isRecord(raw) || typeof raw.path !== 'string') {
      this.problems.push(`${where}: a cite needs a path`);
      return null;
    }
    const page = raw.page ?? null;
    if (page !== null && !(Number.isInteger(page) && (page as number) >= 1)) {
      this.problems.push(`${where}: a cite page must be a whole number from 1, or null`);
      return null;
    }
    if (raw.note !== undefined && typeof raw.note !== 'string') {
      this.problems.push(`${where}: a cite note must be a string`);
      return null;
    }
    const doc = resolvePath(this.resolver, raw.path);
    if (!doc) {
      this.unresolved.push({ where, path: raw.path, page: page as number | null });
      return null;
    }
    this.cited.add(doc);
    return raw.note === undefined ? { doc, page } : { doc, page, note: raw.note };
  }

  /** A list of cites; unresolved and malformed ones are left out. */
  cites(raw: unknown, where: string): Record<string, unknown>[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      this.problems.push(`${where}: cites must be a list`);
      return [];
    }
    return raw.map((cite) => this.cite(cite, where)).filter((cite): cite is Record<string, unknown> => cite !== null);
  }

  /** An entry with its `cites` resolved. */
  entry(entry: Entry, where: string): Entry {
    return { ...entry, cites: this.cites(entry.cites, where) };
  }

  /** Proof items with their cite resolved; unresolved ones are dropped. */
  private proof(raw: unknown, where: string): unknown[] {
    const proof = Array.isArray(raw) ? raw : [];
    return proof.flatMap((item) => {
      if (!isRecord(item)) return [item];
      const cite = this.cite(item.cite, `${where}/proof`);
      return cite ? [{ ...item, cite }] : [];
    });
  }

  /** Each entry of a nested list mapped with its location ("<where>/<id or index>"); a missing list stays missing. */
  private nested(raw: unknown, where: string, map: (entry: Entry, at: string) => Entry): unknown {
    if (!Array.isArray(raw)) return raw;
    return raw.map((entry, index) => (isRecord(entry) ? map(entry, `${where}/${typeof entry.id === 'string' ? entry.id : index}`) : entry));
  }

  /** A claim: its cites, and the cite of every proof item in every element. Unresolved proof items are dropped. */
  claim(claim: Entry, where: string): Entry {
    return {
      ...this.entry(claim, where),
      elements: this.nested(Array.isArray(claim.elements) ? claim.elements : [], where, (element, at) => ({ ...element, proof: this.proof(element.proof, at) })),
    };
  }

  /** A link: its cites, and the cites of every statement about it. */
  link(link: Entry, where: string): Entry {
    const out: Entry = { ...this.entry(link, where) };
    if (link.statements !== undefined) out.statements = this.nested(link.statements, where, (statement, at) => this.entry(statement, at));
    return out;
  }

  /** A violation: its cites, and the cites of every step, figure and contrast side. */
  violation(violation: Entry, where: string): Entry {
    const out: Entry = { ...this.entry(violation, where) };
    if (violation.steps !== undefined) out.steps = this.nested(violation.steps, where, (step, at) => this.entry(step, at));
    if (violation.figures !== undefined) out.figures = this.nested(violation.figures, where, (figure, at) => this.entry(figure, at));
    if (violation.contrast !== undefined) out.contrast = this.nested(violation.contrast, `${where}/contrast`, (side, at) => this.entry(side, at));
    return out;
  }

  /** A track: the cite of every proof item in every point, and its brief's cites. A track has no cites of its own. */
  track(track: Entry, where: string): Entry {
    const out: Entry = { ...track };
    if (track.points !== undefined) out.points = this.nested(track.points, where, (point, at) => ({ ...point, proof: this.proof(point.proof, at) }));
    if (isRecord(track.brief)) out.brief = this.brief(track.brief, `${where}/brief`);
    return out;
  }

  /**
   * A brief: the cites of its hurdles and dates, each exhibit's cite (an unresolved exhibit is dropped), and each
   * draft's path turned into its documents.id (an unresolved draft is dropped). Both drops are listed.
   */
  private brief(brief: Entry, where: string): Entry {
    const out: Entry = { ...brief };
    if (brief.hurdles !== undefined) out.hurdles = this.nested(brief.hurdles, `${where}/hurdles`, (hurdle, at) => this.entry(hurdle, at));
    if (brief.dates !== undefined) out.dates = this.nested(brief.dates, `${where}/dates`, (item, at) => this.entry(item, at));
    if (Array.isArray(brief.exhibits)) {
      out.exhibits = brief.exhibits.flatMap((exhibit, index) => {
        if (!isRecord(exhibit)) return [exhibit];
        const cite = this.cite(exhibit.cite, `${where}/exhibits/${index}`);
        return cite ? [{ ...exhibit, cite }] : [];
      });
    }
    if (Array.isArray(brief.drafts)) out.drafts = brief.drafts.flatMap((draft, index) => this.draft(draft, `${where}/drafts/${index}`));
    return out;
  }

  /** A fragment draft link `{ label, path }` as a built one `{ label, doc }`; none when malformed or not live. */
  private draft(raw: unknown, where: string): unknown[] {
    if (!isRecord(raw) || typeof raw.path !== 'string') {
      this.problems.push(`${where}: a draft needs a path`);
      return [];
    }
    const { path: rawPath, ...rest } = raw;
    const doc = resolvePath(this.resolver, rawPath);
    if (!doc) {
      this.unresolved.push({ where, path: rawPath, page: null });
      return [];
    }
    this.cited.add(doc);
    return [{ ...rest, doc }];
  }
}
