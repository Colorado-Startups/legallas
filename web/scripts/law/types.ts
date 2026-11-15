// SPDX-License-Identifier: Apache-2.0
// Shapes the law build passes between its steps: fetch (raw files) -> parse (units) -> chunk (index parts).
import type { LawChunk, LawKind, LawOpinion, LawTrack } from '../../worker/law-cite.ts';

/** How a unit numbers its subsections, for pinpoint cites (chunk.ts subsectionPath). */
export type Scheme = 'crs' | 'cfr' | 'usc' | 'outline' | 'ccr' | 'cji' | 'case';

/** One writing of an opinion (opinions.ts): the court's, or a concurrence or dissent, chunked on its own. */
export interface UnitOpinion {
  opinion: LawOpinion;
  /** "Fable, J.", or null when the reporter names no author the build can read. */
  judge: string | null;
  /** How a citation describes it: "dissenting", "concurring in the judgment", "opinion of the court". */
  role: string;
  /** Paragraphs with star pages as [*307] markers. */
  lines: string[];
  /** Footnotes, each opening with the star page its mark sits on when known: "[*848] Footnote 6: ...". */
  notes: string[];
  /** The star page the writing starts on. */
  startPage: string | null;
}

/** One citable piece of law after parsing: its catalog facts and its text, one paragraph per line. */
export interface LawUnit {
  id: string;
  cite: string;
  title: string;
  url: string;
  retrieved: string;
  track: LawTrack;
  kind: LawKind;
  source: string;
  scheme: Scheme;
  lines: string[];
  /** Opinions: the reporter page the opinion text starts on, when the head matter ends on a later page. */
  startPage?: string;
  /**
   * Opinions cited by a neutral citation from the court's slip opinion (slip.ts): parts are pinpointed by the numbered
   * paragraphs their text covers ("2011 COA 17, ¶¶ 15-17") instead of star pages.
   */
  pinpoint?: 'paragraph';
  /** Some subsections of the section only: every part, the first included, is cited with its pinpoint. */
  excerpt?: boolean;
  /** Opinions: each writing apart, so no part mixes the court's opinion with a separate one. */
  opinions?: UnitOpinion[];
}

/** One index part: the catalog entry plus the text written to law/<track>/<id>.md. */
export interface BuiltChunk extends LawChunk {
  text: string;
}

/** What the catalog (catalog.json beside the index parts) holds. */
export interface LawCatalog {
  version: 1;
  built: string;
  chunks: LawChunk[];
}
