// SPDX-License-Identifier: Apache-2.0
// legallas_get_file: one original file (owner: session 3, plan D3 and D7). Claude, and only Claude, gets small PNG,
// JPEG and WebP images as embedded content: base64 of at most EMBED_MAX_BASE64_CHARS characters, at most
// IMAGE_MAX_PIXELS. Every other client, every PDF and anything larger gets the file's details, its page count, a
// pointer to legallas_read_pages and the room link; a visual gets a pointer to legallas_view_visual. PDFs are never
// sent as files: Claude's client refuses an embedded PDF (live check, 2026-10-20), so the bytes would reach no
// model. The bytes never leave as a URL: the only link is the room's own page, behind Access. The query keeps
// NOT_HIDDEN_SQL, removed_at IS NULL and privilegeFilter; r2_key is read to fetch the bytes and never returned, and
// sha256 and etag are never selected.
// Every byte pull is audited as `download` with the client's name, never deduplicated, before any byte goes out, and
// a member pulls at most DAILY_DOWNLOAD_CAP files a UTC day this way; past it, the answer falls back to the details.
// GIFs are never embedded: a GIF can declare a small canvas and carry larger or many frames, so its header says
// nothing reliable about what a client would decode.
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { utcDay } from '../../worker/usage.ts';
import { canPerform } from '../../worker/auth.ts';
import type { Role } from '../../worker/env.ts';
import { NOT_HIDDEN_SQL } from '../../worker/files-catalog.ts';
import { privilegeFilter } from '../../worker/privilege.ts';
import { downloadsToday, reserveDownload } from '../audit.ts';
import { DAILY_DOWNLOAD_CAP, EMBED_MAX_BASE64_CHARS, IMAGE_MAX_PIXELS, type ToolContext, type ToolDefinition } from '../contract.ts';
import { embeddable, imageResult, jsonResult, retrievedOn } from '../format.ts';
import { markUntrusted, noted } from '../untrusted.ts';
import { canRead, DOC_ID, documentFields, documentNotFound, forbidden, type DocumentRow } from './documents.ts';
import { withToolPrefix } from '../tool-prefix.ts';
import { FILE_OUTPUT } from './output.ts';

/** The largest file whose base64 fits EMBED_MAX_BASE64_CHARS (4 characters per 3 bytes), as format.ts embeddable has it. */
export const MAX_EMBED_BYTES = (EMBED_MAX_BASE64_CHARS / 4) * 3;

/** What can be embedded, by the type its first bytes show. PDF, SVG (markup) and GIF are never embedded. */
export type EmbedType = 'image/png' | 'image/jpeg' | 'image/webp';
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Why a file came back as details only. */
export type NotEmbedded = 'client' | 'pdf_as_text' | 'type' | 'too_large' | 'not_allowed' | 'download_limit' | 'unavailable' | 'unrecognized';

const NOTES: Record<NotEmbedded, string> = {
  client: 'This connection receives file details, not file contents.',
  pdf_as_text: 'PDFs come back as their text, not as files.',
  type: 'Only PNG, JPEG or WebP images come back as files.',
  too_large: `Files come back only up to ${MAX_EMBED_BYTES.toLocaleString('en-US')} bytes, and images only up to one megapixel.`,
  not_allowed: 'This connection may not download files.',
  download_limit: 'The daily limit for file downloads through AI tools is reached. It resets at midnight UTC.',
  unavailable: 'The file could not be read just now.',
  unrecognized: 'The file does not match its recorded type, so it is not sent.',
};

interface FileRow extends DocumentRow {
  content_type: string;
  size: number;
  r2_key: string;
}

const COLUMNS = 'id, path, folder, name, kind, pages, updated_at, source, control_seq, key_at, content_type, size, r2_key';

/** One live, non-hidden document that `role` may see, with what fetching its bytes needs. */
async function findFile(db: D1Database, id: string, role: Role): Promise<FileRow | null> {
  return db
    .prepare(`SELECT ${COLUMNS} FROM documents WHERE id = ?1 AND removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(role)}`)
    .bind(id)
    .first<FileRow>();
}

const ascii = (bytes: Uint8Array, at: number, text: string) => [...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));
const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const be32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const le16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const le24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

/** The type the first bytes show, or null for anything that is not a PNG, JPEG or WebP image (a PDF or GIF too). */
export function sniffType(bytes: Uint8Array): EmbedType | null {
  if (bytes.length >= 24 && be32(bytes, 0) === 0x89504e47 && be32(bytes, 4) === 0x0d0a1a0a && ascii(bytes, 12, 'IHDR')) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
  return null;
}

// JPEG markers that start a frame (SOF0 to SOF15, except DHT C4, JPG C8 and Partner CC), and those with no length.
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const STANDALONE = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 9 <= b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at += 1;
    } else if (SOF.has(marker)) {
      return { width: be16(b, at + 7), height: be16(b, at + 5) };
    } else if (marker === 0xda || marker === 0xd9) {
      return null;
    } else {
      at += STANDALONE(marker) ? 2 : 2 + be16(b, at + 2);
    }
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  if (ascii(b, 12, 'VP8X')) return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) };
  if (ascii(b, 12, 'VP8L') && b[20] === 0x2f) {
    return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
  }
  if (ascii(b, 12, 'VP8 ') && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  return null;
}

/** An image's width and height from its header, or null when the header cannot be read. */
export function imageSize(bytes: Uint8Array, type: EmbedType): { width: number; height: number } | null {
  if (type === 'image/png') return { width: be32(bytes, 16), height: be32(bytes, 20) };
  if (type === 'image/jpeg') return jpegSize(bytes);
  if (type === 'image/webp') return webpSize(bytes);
  return null;
}

/** Base64 of bytes, in chunks so a large argument list never overflows the stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/**
 * Why a row cannot be embedded before any byte is read, or null when it may be fetched. A PDF stops here for every
 * client, so it is never read, never audited as a download and never counted against DAILY_DOWNLOAD_CAP.
 */
function refuseEarly(ctx: ToolContext, row: FileRow): NotEmbedded | null {
  if (ctx.clientKind !== 'claude') return 'client';
  if (row.kind === 'pdf') return 'pdf_as_text';
  if (row.kind !== 'image') return 'type';
  if (row.kind === 'image' && !IMAGE_TYPES.has(row.content_type)) return 'type';
  if (!embeddable(row.size)) return 'too_large';
  if (!canPerform(ctx.member.role, 'download')) return 'not_allowed';
  return null;
}

/**
 * Whether the member has already pulled DAILY_DOWNLOAD_CAP files through AI tools today (UTC). A first look, so a
 * member at the cap never makes the file be read; reserveDownload is the gate that holds when calls run in parallel.
 */
async function atDownloadCap(ctx: ToolContext): Promise<boolean> {
  return (await downloadsToday(ctx.env.DB, ctx.member.email, utcDay(ctx.now))) >= DAILY_DOWNLOAD_CAP;
}

/** What a pulled image is: its type and size. */
interface Checked {
  type: EmbedType;
  width: number;
  height: number;
}

/** What the bytes are, or why they are not sent: they must be an embeddable image, and fit. */
function checkBytes(bytes: Uint8Array): Checked | NotEmbedded {
  if (!embeddable(bytes.byteLength)) return 'too_large';
  const type = sniffType(bytes);
  if (type === null) return 'unrecognized';
  const size = imageSize(bytes, type);
  if (!size || size.width < 1 || size.height < 1) return 'unrecognized';
  if (size.width * size.height > IMAGE_MAX_PIXELS) return 'too_large';
  return { type, ...size };
}

/**
 * The file's bytes, checked, or why they are not sent. The row's size was checked before this; the stored object is
 * checked again in case the two ever differ, and a body too large to send is cancelled unread.
 */
async function pull(files: R2Bucket, row: FileRow): Promise<{ bytes: Uint8Array; checked: Checked } | NotEmbedded> {
  const object = await files.get(row.r2_key);
  if (!object) return 'unavailable';
  if (!embeddable(object.size)) {
    await object.body.cancel();
    return 'too_large';
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const checked = checkBytes(bytes);
  return typeof checked === 'string' ? checked : { bytes, checked };
}

/** Details only: the file's facts, why it was not sent, and where to read it instead. */
function detailsResult(fields: Record<string, unknown>, row: FileRow, reason: NotEmbedded, toolPrefix?: string): CallToolResult {
  return jsonResult(noted({
    ...fields,
    content_type: row.content_type,
    size_bytes: row.size,
    embedded: false,
    reason,
    read_with: withToolPrefix('legallas_read_pages', toolPrefix),
    note: withToolPrefix(`${NOTES[reason]} Read its text with legallas_read_pages, or open the original from the room link.`, toolPrefix),
  }));
}

function visualResult(fields: Record<string, unknown>, toolPrefix?: string): CallToolResult {
  return jsonResult(noted({
    ...fields,
    embedded: false,
    reason: 'visual',
    view_with: withToolPrefix('legallas_view_visual', toolPrefix),
    note: withToolPrefix('This is a page of the visual binder. Call legallas_view_visual with this id for its text, or without an id to list the binder; or open it from the room link.', toolPrefix),
  }));
}

/** The image itself: its details as text (and structured content), then the bytes as image content. */
function fileResult(fields: Record<string, unknown>, bytes: Uint8Array, checked: Checked): CallToolResult {
  const { type, width, height } = checked;
  const details = { ...fields, content_type: type, size_bytes: bytes.byteLength, embedded: true, width, height };
  return imageResult(noted(details), { data: toBase64(bytes), mimeType: type });
}

const inputSchema = z.object({ id: DOC_ID });

/** The legallas_get_file tool, which gets an original file. */
export const getFileTool: ToolDefinition<typeof inputSchema> = {
  name: 'legallas_get_file',
  title: 'Get an original file',
  description:
    'The original file of one document. Small PNG, JPEG and WebP images come back as the image itself where the ' +
    'app supports it; otherwise, PDFs and larger files included, the result gives the file details, page count and ' +
    'room link, and legallas_read_pages reads its text. Visual binder pages point to legallas_view_visual.',
  inputSchema,
  outputSchema: FILE_OUTPUT,
  async handler(args, ctx) {
    if (!canRead(ctx)) return forbidden();
    const row = await findFile(ctx.env.DB, args.id, ctx.member.role);
    if (!row) return documentNotFound(ctx.toolPrefix);
    const fields = markUntrusted({ retrieved: retrievedOn(ctx.now), ...documentFields(row, ctx.env.CONTROL_PREFIX) });
    if (row.kind === 'visual') {
      await ctx.audit('ai_read', row.id);
      return visualResult(fields, ctx.toolPrefix);
    }
    const refused = refuseEarly(ctx, row) ?? ((await atDownloadCap(ctx)) ? 'download_limit' : null);
    const pulled = refused ?? (await pull(ctx.env.FILES, row));
    if (typeof pulled === 'string') {
      await ctx.audit('ai_read', row.id);
      return detailsResult(fields, row, pulled, ctx.toolPrefix);
    }
    // Only bytes that will be sent are reserved, so a file that turns out too large or mistyped writes no download
    // row. One statement checks today's count and writes the row; it throws when the write fails (fails closed), and
    // runTool turns that into internal_error. ToolContext carries no request, so the row has no ip or user agent.
    const entry = { email: ctx.member.email, documentId: row.id, via: ctx.props.clientName };
    if (!(await reserveDownload(ctx.env.DB, entry, DAILY_DOWNLOAD_CAP, utcDay(ctx.now)))) {
      await ctx.audit('ai_read', row.id);
      return detailsResult(fields, row, 'download_limit', ctx.toolPrefix);
    }
    return fileResult(fields, pulled.bytes, pulled.checked);
  },
};
