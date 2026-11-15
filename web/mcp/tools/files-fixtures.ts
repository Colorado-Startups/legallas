// SPDX-License-Identifier: Apache-2.0
// Test support only (never imported by the Worker), for legallas_get_comments and legallas_get_file: a ToolContext
// for a given client kind and response profile that records audits with their `via`, a fake legallas-files bucket,
// and image headers built byte by byte. Fixtures use made-up Roe names; the room's own fixture is Doe v. Harbor Labs.
import type { Role } from '../../worker/env.ts';
import { PROFILE_OF, type ClientKind, type McpEnv, type ResponseProfile, type ToolContext } from '../contract.ts';

/** A recorded audit call: its action and the document id. */
export interface AuditCall {
  action: string;
  documentId: string | null;
  /** The client name, as runTool passes it to aiAudit. */
  via: string;
}

/** The app name each kind of client registered with, as the consent page shows it. */
export const CLIENT_NAMES: Record<ClientKind, string> = { claude: 'Claude', harvey: 'Harvey', microsoft: 'Microsoft Copilot', unknown: 'Some App' };

/** Options for building a test tool context, such as the role and client kind. */
export interface CtxOptions {
  role?: Role;
  clientKind?: ClientKind;
  /** Defaults to the client's profile (PROFILE_OF, plan D6). */
  profile?: ResponseProfile;
  files?: R2Bucket;
  /** The call's time. Defaults to the real clock: audit rows take the database's clock, and daily counts must agree. */
  now?: Date;
}

/** A ToolContext over `db` as runTool builds it for this client, recording every audit call with its `via`. */
export function clientCtx(db: D1Database, options: CtxOptions = {}) {
  const kind = options.clientKind ?? 'claude';
  const role = options.role ?? 'counsel';
  const audits: AuditCall[] = [];
  const env = { DB: db, FILES: options.files, CONTROL_PREFIX: 'DOE', TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const ctx: ToolContext = {
    env,
    props: { email: 'counsel@example.test', role: 'owner', clientId: 'c1', clientName: CLIENT_NAMES[kind] },
    member: { email: 'counsel@example.test', role, name: 'Counsel' },
    now: options.now ?? new Date(),
    clientKind: kind,
    profile: options.profile ?? PROFILE_OF[kind],
    audit: async (action, documentId) => {
      audits.push({ action, documentId, via: CLIENT_NAMES[kind] });
    },
  };
  return { ctx, audits };
}

/** A fake legallas-files bucket: `get` returns the stored bytes and size, and records each key asked for. */
export function fakeFiles(objects: ReadonlyMap<string, Uint8Array>) {
  const gets: string[] = [];
  const bucket = {
    async get(key: string) {
      gets.push(key);
      const bytes = objects.get(key);
      if (bytes === undefined) return null;
      return { size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer, body: new Blob([bytes.slice()]).stream() };
    },
  };
  return { gets, bucket: bucket as unknown as R2Bucket };
}

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

/** `bytes` followed by `pad` filler bytes, so a fixture can reach a given file size. */
function withPadding(bytes: number[], pad: number): Uint8Array {
  const out = new Uint8Array(bytes.length + pad);
  out.set(bytes);
  for (let i = bytes.length; i < out.length; i += 1) out[i] = i % 251;
  return out;
}

/** A PNG signature and IHDR chunk for width by height, then `pad` bytes. */
export function pngBytes(width: number, height: number, pad = 64): Uint8Array {
  const ihdr = [...be32(13), ...ascii('IHDR'), ...be32(width), ...be32(height), 8, 6, 0, 0, 0, 0, 0, 0, 0];
  return withPadding([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr], pad);
}

/**
 * A JPEG with an APP0 segment and then a frame header for width by height: baseline SOF0, or with `progressive` a
 * SOF2 after a standalone RST0 marker and a fill byte, as some encoders write.
 */
export function jpegBytes(width: number, height: number, pad = 64, progressive = false): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const frame = [0x00, 0x11, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sof = progressive ? [0xff, 0xd0, 0xff, 0xff, 0xc2, ...frame] : [0xff, 0xc0, ...frame];
  return withPadding([0xff, 0xd8, ...app0, ...sof], pad);
}

/** A GIF89a logical screen for width by height. */
export function gifBytes(width: number, height: number, pad = 64): Uint8Array {
  return withPadding([...ascii('GIF89a'), ...le16(width), ...le16(height), 0, 0, 0], pad);
}

/** An extended (VP8X) WebP for width by height. */
export function webpBytes(width: number, height: number, pad = 64): Uint8Array {
  const vp8x = [...ascii('VP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)];
  return withPadding([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...vp8x], pad);
}

/** A lossless (VP8L) WebP for width by height: 14-bit sizes less one, packed least significant bit first. */
export function webpLosslessBytes(width: number, height: number, pad = 64): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const header = [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255];
  return withPadding([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8L'), 0, 0, 0, 0, ...header], pad);
}

/** A lossy (VP8) WebP for width by height: a frame tag, the start code, then 14-bit sizes. */
export function webpLossyBytes(width: number, height: number, pad = 64): Uint8Array {
  const frame = [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...le16(width & 0x3fff), ...le16(height & 0x3fff)];
  return withPadding([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 '), 0, 0, 0, 0, ...frame], pad);
}

/** A PDF header, then `pad` bytes. */
export function pdfBytes(pad = 64): Uint8Array {
  return withPadding(ascii('%PDF-1.7\n'), pad);
}

/** Base64 of `bytes`, to compare with what a tool embedded. */
export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
