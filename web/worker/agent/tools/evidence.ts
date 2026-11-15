// SPDX-License-Identifier: Apache-2.0
// What this turn's tools found, kept on the server for the final answer (plan D10): the passages and pages the record
// tools returned, with the live documents they come from, and the law passages. The final answer's cite book is built
// from this alone (final.ts, through ask-turn.ts), so nothing a client sends, and nothing from an earlier turn, can
// ever make a page citable.
//
// The tool-step model never sees a document id: it sees short aliases (R1, R2, ...) that this book maps back, so a
// garbled id cannot send a tool to the wrong document (glm-5.3-flash garbled about 5 of 88 answers' ids, ask.ts).
import type { LawChunk } from '../../law-cite.ts';
import type { LawPassage } from '../../law.ts';
import type { CitableDoc } from '../../passages.ts';
import type { PromptChunk } from '../../prompt.ts';

/** A record passage marker, exactly as scripts/indexparts.ts writes it (worker/citations.ts). */
const MARKER = /\[\[doc:([A-Za-z0-9_-]{1,64}) p:([0-9]{1,6})\]\]/g;

/** Passages kept for the final answer, at most; final.ts trims further to fit its input. */
export const MAX_EVIDENCE_CHUNKS = 60;

/** Counts for the page: how much the tools have looked at. Never a query, a name or text. */
export interface EvidenceCounts {
  searches: number;
  documents: number;
  pages: number;
}

/** The evidence a turn gathers: prompt chunks, and the documents it may cite. */
export class Evidence {
  readonly chunks: PromptChunk[] = [];
  readonly citable = new Map<string, CitableDoc>();
  readonly law: LawPassage[] = [];
  readonly lawCitable = new Map<string, LawChunk>();
  searches = 0;
  readonly #seen = new Set<string>();
  readonly #aliasOf = new Map<string, string>();
  readonly #idOf = new Map<string, string>();

  /** The tool-step alias for a document id, minted on first sight. */
  alias(id: string): string {
    let alias = this.#aliasOf.get(id);
    if (!alias) {
      alias = `R${this.#aliasOf.size + 1}`;
      this.#aliasOf.set(id, alias);
      this.#idOf.set(alias, id);
    }
    return alias;
  }

  /** The document id an argument names: an alias this turn minted, else the argument as given (tools check it). */
  resolve(idOrAlias: string): string {
    return this.#idOf.get(idOrAlias.trim()) ?? idOrAlias;
  }

  /** Every id this turn has aliased, longest first (so one id that contains another is replaced first). */
  aliasedIds(): string[] {
    return [...this.#aliasOf.keys()].sort((a, b) => b.length - a.length);
  }

  /** Adds record passages from live documents the member may see; repeats and documents not in `citable` are dropped. */
  addChunks(chunks: readonly PromptChunk[], citable: ReadonlyMap<string, CitableDoc>): void {
    for (const chunk of chunks) {
      const doc = citable.get(chunk.docId);
      if (!doc || this.chunks.length >= MAX_EVIDENCE_CHUNKS) continue;
      const key = `${chunk.docId}\n${chunk.text}`;
      if (this.#seen.has(key)) continue;
      this.#seen.add(key);
      this.chunks.push({ docId: chunk.docId, name: doc.name, text: chunk.text });
      this.citable.set(chunk.docId, doc);
    }
  }

  /** Adds law passages and the entries a [law:] cite may name. */
  addLaw(passages: readonly LawPassage[], citable: ReadonlyMap<string, LawChunk>): void {
    for (const passage of passages) {
      const entry = citable.get(passage.id);
      if (!entry || this.lawCitable.has(passage.id)) continue;
      this.law.push(passage);
      this.lawCitable.set(passage.id, entry);
    }
  }

  counts(): EvidenceCounts {
    const pages = new Set<string>();
    for (const chunk of this.chunks) {
      for (const match of chunk.text.matchAll(MARKER)) if (match[1] === chunk.docId) pages.add(`${match[1]}:${match[2]}`);
    }
    return { searches: this.searches, documents: this.citable.size, pages: pages.size };
  }
}

/** One search answer as the binding gave it: a result, or the error it threw. */
type Recorded = { ok: true; value: unknown } | { ok: false; error: unknown };

/**
 * A search binding that answers as `search` does and keeps every answer (or refusal) in order. One per tool call, so
 * tool calls the model makes in parallel never mix their answers.
 */
export function recordingSearch(search: Pick<AiSearchInstance, 'search'>): { binding: Pick<AiSearchInstance, 'search'>; answers: Recorded[] } {
  const answers: Recorded[] = [];
  const binding = {
    async search(request: AiSearchSearchRequest) {
      try {
        const value = await search.search(request);
        answers.push({ ok: true, value });
        return value;
      } catch (error) {
        answers.push({ ok: false, error });
        throw error;
      }
    },
  };
  return { binding: binding as Pick<AiSearchInstance, 'search'>, answers };
}

/**
 * The recorded answers again, in order, with no new search: the room's own retrieve() (and retrieveLaw()) run over
 * them to rebuild exactly the passages the tool saw, raw page markers included. Asked once more than recorded, it
 * throws, so a replay can never search for real.
 */
export function replaySearch(answers: readonly Recorded[]): Pick<AiSearchInstance, 'search'> {
  let next = 0;
  return {
    async search() {
      const answer = answers[next++];
      if (!answer) throw new Error('replay_exhausted');
      if (!answer.ok) throw answer.error;
      return answer.value as AiSearchSearchResponse;
    },
  } as Pick<AiSearchInstance, 'search'>;
}
