// SPDX-License-Identifier: Apache-2.0
// The shape of one opinion in a room's law library (a law pack's `sources.cases`, pack.ts). Text comes from the
// Caselaw Access Project's public domain copy of the reporter (static.case.law); where CAP lacks one, from the slip
// opinion a court announced, as CourtListener (Free Law Project) keeps it (slip.ts), or from CourtListener's opinion
// HTML supplied into the raw cache (`supplied`, courtlistener.ts). `url` is the CourtListener page a reader opens.
import type { LawTrack } from '../../worker/law-cite.ts';

/**
 * Text obtained outside the build and supplied into the raw cache (node scripts/law/seed.ts), never downloaded: the
 * build reads it from the cache under `text`, refuses a body whose hash differs, and says why on --refresh.
 */
export interface SuppliedText {
  /** The page format: CourtListener's `html_with_citations` (courtlistener.ts). */
  format: 'courtlistener-html';
  sha256: string;
  /** YYYY-MM-DD it was retrieved. */
  retrieved: string;
  /** How it was obtained, kept in the cache entry and the part's source line. */
  via: string;
  /** Why the build cannot download it, shown on --refresh. */
  why: string;
}

/** A case the library builds from: its name, which is checked against the parties in the CAP head matter. */
export interface CaseSource {
  /** The case name; buildCase checks it against the parties in the CAP head matter (a wrong file is refused). */
  name: string;
  court: 'Colo.' | 'Colo. App.';
  year: number;
  /**
   * The cite of the reporter the CAP copy paginates (its star pages), canonical (normalizeCitation); for a slip
   * opinion, its neutral cite, which its numbered paragraphs pinpoint.
   */
  cite: string;
  /** The public domain citation ("2012 CO 9") for opinions since 2012, shown in the title. */
  neutral?: string;
  /** The official reporter's parallel cite ("32 Colo. App. 320"), shown in the title when the cite is P.2d. */
  parallel?: string;
  /**
   * The CAP case HTML (static.case.law/<reporter>/<volume>/html/<page>-<n>.html), with the cite's star pages; or, with
   * `slip`, the announced slip opinion PDF CourtListener keeps (storage.courtlistener.com/pdf/<date>/<name>.pdf).
   */
  text: string;
  /**
   * The text is the Court of Appeals' slip opinion (no CAP copy exists). Its REST API needs a token, so the build
   * reads the stored PDF; only the opinions in the pack's `slipCases` may.
   */
  slip?: true;
  /** The text is supplied into the raw cache, never downloaded (cache-only); `text` is its cache key. */
  supplied?: SuppliedText;
  /** The CourtListener opinion page. */
  url: string;
  /** What the opinion is in the library for; a pack's own words. */
  topics: readonly string[];
  track: LawTrack;
}
