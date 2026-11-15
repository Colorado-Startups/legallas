// SPDX-License-Identifier: Apache-2.0
// An approved draft's file (docs/design/propose-and-approve.md): the room's download (proposal-review.ts) and sync's
// save-back to the company folder (sync.ts) serve the same text. No imports, so the sync endpoints stay free of jose.

/** The columns of a proposals row that the file is made of. */
export interface DraftRow {
  title: string;
  body: string;
  final_title: string | null;
  final_body: string | null;
  via: string | null;
  proposed_by: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

/** A provenance line, then what the person approved, as Markdown. */
export function draftText(row: DraftRow): string {
  const title = row.final_title ?? row.title;
  const body = row.final_body ?? row.body;
  const line = (text: string) => text.replace(/\s+/g, ' ');
  const provenance =
    `> Draft proposed through ${line(row.via ?? 'an AI app')} as ${row.proposed_by} on ${row.created_at.slice(0, 10)}, ` +
    `approved by ${row.decided_by} on ${(row.decided_at ?? '').slice(0, 10)}${row.final_title || row.final_body ? ' with edits' : ''}. ` +
    "A draft. You aren't receiving legal advice from a licensed lawyer. Have your own lawyer review it before you rely on it.";
  return `${provenance}\n\n# ${title}\n\n${body}\n`;
}
