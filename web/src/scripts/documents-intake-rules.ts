// SPDX-License-Identifier: Apache-2.0
// Card P5b (Documents, intake). The plain-language rules behind "Send to client": what the room accepts, the one
// sentence each refusal reads as, and the status words for counsel's files. Pure (documents-intake.test.ts).
// The allowlist and the size cap are the Worker's own constants, so this page and the server always agree.
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, uploadTypeOf } from '../../worker/files-upload.ts';

/** "95 MB": the cap in the binary megabytes the Worker counts in. */
export const MAX_UPLOAD_LABEL = `${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`;

/** The file picker's accept list: ".pdf,.png,...". */
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

/** The one line under the list that says what can be sent. */
export const UPLOAD_LIMITS = `PDF, Word, Excel, PowerPoint, PNG, JPEG, text, CSV, Markdown or ZIP, up to ${MAX_UPLOAD_LABEL} each.`;

const WHOLE = 'The upload did not arrive whole; try again.';

/** One sentence per error code the upload route returns (worker/routes/files.ts), plus the client's own. */
const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: 'This account cannot send files to the client.',
  bad_name: 'That file name cannot be used; rename the file and try again.',
  type_not_allowed: `That file type is not accepted; send ${UPLOAD_LIMITS.replace(/, up to .*$/, '')} files.`,
  empty_file: 'That file is empty.',
  too_large: `That file is larger than ${MAX_UPLOAD_LABEL}.`,
  content_mismatch: 'The contents do not match the file type, for example a .pdf that is not a PDF.',
  active_content: 'That file can run code when opened, such as a PDF with scripts or an Office file with macros; send a copy without them.',
  pii_in_name: 'That file name holds a Social Security number; rename the file and try again.',
  pii_in_file: 'That file holds a Social Security number; send a copy without it.',
  length_required: WHOLE,
  bad_length: WHOLE,
  incomplete_body: WHOLE,
  network: 'The connection dropped before the upload finished; try again.',
  canceled: 'Upload canceled.',
};

const FALLBACK = 'The upload failed; try again.';

/** The sentence for an error code; a general one for anything unknown. */
export function messageFor(code: string | null | undefined): string {
  return (code && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined) ?? FALLBACK;
}

/** The error code to refuse a file with before sending a byte, or null. The server checks all of it again. */
export function precheck(file: { name: string; size: number }): string | null {
  if (!uploadTypeOf(file.name)) return 'type_not_allowed';
  if (file.size === 0) return 'empty_file';
  if (file.size > MAX_UPLOAD_BYTES) return 'too_large';
  return null;
}

function field(body: string, name: 'error' | 'id'): string | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown> | null;
    const value = parsed?.[name];
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  }
}

/** The error code in an upload response body ({"error": "too_large"}), or null. */
export function errorCode(body: string): string | null {
  return field(body, 'error');
}

/** The new document's id in a 201 upload response ({"id": "..."}), or null. */
export function uploadedId(body: string): string | null {
  return field(body, 'id');
}

/** A whole percentage, clamped to 0..100. */
export function percent(loaded: number, total: number): number {
  if (!(total > 0) || !(loaded > 0)) return 0;
  return Math.min(100, Math.round((loaded / total) * 100));
}

/** Where a counsel file stands: still in the room only, or copied into the client's case files. */
export function syncStatus(pulled: boolean): { state: 'waiting' | 'synced'; label: string } {
  return pulled ? { state: 'synced', label: 'Synced to client files' } : { state: 'waiting', label: 'Waiting for sync' };
}

/** "2026-10-01" in the reader's time zone, for metadata columns; '' when unparseable. */
export function isoDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
