// SPDX-License-Identifier: Apache-2.0
// Passages as the index holds them. scripts/indexparts.ts writes each page of a document to a part keyed
// text/<doc_id>.p<N>.md whose text carries [[doc:<id> p:<n>]] markers; AI Search returns those parts, the keyword
// index (fts.ts) returns the same marked text, and retrieval.ts, the MCP and Ask read ids and pages back from them,
// then keep the live documents they belong to (CitableDoc).
// No imports, so the scripts and both Workers can use it.

/** Document ids are random (crypto.randomUUID) or similar opaque tokens: never paths. */
export const DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;

// text/<doc_id>.p<N>.md, as written by scripts/indexparts.ts partKey().
const INDEX_KEY = /^text\/([A-Za-z0-9_-]{1,64})\.p[1-9][0-9]{0,5}\.md$/;
// What the index text carries: [[doc:<id> p:<n>]].
const PAGE_SPLIT = /\[\[doc:([A-Za-z0-9_-]{1,64}) p:([0-9]{1,6})\]\]/;

/** A passage before the live-document filter: its document and its text with [[doc:<id> p:<n>]] markers. */
export interface FoundPassage {
  docId: string;
  text: string;
}

/** A passage of a live document, named, as retrieval.ts hands it on (Ask's prompt.ts PromptChunk adds its flags). */
export interface Passage {
  docId: string;
  name: string;
  text: string;
}

/** A live document that appeared in this question's retrieved set. */
export interface CitableDoc {
  id: string;
  name: string;
  /** PDF page count, or null when unknown (text files). */
  pages: number | null;
  control_seq?: number | null;
  /** The folder it sits in, for its source kind (source-kind.ts); absent where the caller did not read it. */
  folder?: string | null;
}

/** The document id an AI Search item key belongs to, or null for anything that is not an index part. */
export function docIdFromKey(key: string): string | null {
  return INDEX_KEY.exec(key)?.[1] ?? null;
}

/** The runs of text that follow a [[doc:<id> p:<page>]] marker, from every retrieved chunk of that document. */
export function pageSegments(chunks: readonly FoundPassage[], id: string, page: number): string[] {
  const out: string[] = [];
  for (const chunk of chunks) {
    if (chunk.docId !== id) continue;
    // split() with two capture groups yields [before, id, page, text, id, page, text, ...].
    const parts = chunk.text.split(PAGE_SPLIT);
    for (let i = 1; i + 2 < parts.length; i += 3) {
      if (parts[i] === id && Number(parts[i + 1]) === page) out.push(parts[i + 2]!); // safe: bounds checked above
    }
  }
  return out;
}
