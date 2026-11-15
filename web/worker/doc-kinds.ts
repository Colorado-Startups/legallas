// SPDX-License-Identifier: Apache-2.0
// What kind of document a file is, from its name alone, and how its path splits. Shared by the sync engine
// (scripts/diff.ts) and the room's sync endpoints (worker/sync.ts), so the room works these out for itself rather than
// taking a laptop's word for them.

export type Kind = 'pdf' | 'image' | 'markdown' | 'csv' | 'visual' | 'text' | 'file';

export interface KindInfo {
  kind: Kind;
  contentType: string;
}

const UTF8 = '; charset=utf-8';
const KNOWN: Record<string, KindInfo> = {
  pdf: { kind: 'pdf', contentType: 'application/pdf' },
  png: { kind: 'image', contentType: 'image/png' },
  jpg: { kind: 'image', contentType: 'image/jpeg' },
  jpeg: { kind: 'image', contentType: 'image/jpeg' },
  gif: { kind: 'image', contentType: 'image/gif' },
  webp: { kind: 'image', contentType: 'image/webp' },
  svg: { kind: 'image', contentType: 'image/svg+xml' },
  md: { kind: 'markdown', contentType: `text/markdown${UTF8}` },
  csv: { kind: 'csv', contentType: `text/csv${UTF8}` },
  html: { kind: 'visual', contentType: `text/html${UTF8}` },
  htm: { kind: 'visual', contentType: `text/html${UTF8}` },
  txt: { kind: 'text', contentType: `text/plain${UTF8}` },
  xml: { kind: 'text', contentType: `application/xml${UTF8}` },
  jsx: { kind: 'text', contentType: `text/plain${UTF8}` },
  json: { kind: 'text', contentType: `application/json${UTF8}` },
  eml: { kind: 'text', contentType: 'message/rfc822' },
};
// Download-only files keep a meaningful type so the browser picks the right app.
const DOWNLOAD_TYPES: Record<string, string> = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  key: 'application/vnd.apple.keynote',
  pages: 'application/vnd.apple.pages',
  numbers: 'application/vnd.apple.numbers',
  rtf: 'application/rtf',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  heic: 'image/heic',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export function kindOf(name: string): KindInfo {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return KNOWN[ext] ?? { kind: 'file', contentType: DOWNLOAD_TYPES[ext] ?? 'application/octet-stream' };
}

/** documents.folder and documents.name for a '/'-separated relative path. */
export function splitPath(rel: string): { folder: string; name: string } {
  const slash = rel.lastIndexOf('/');
  return slash < 0 ? { folder: '', name: rel } : { folder: rel.slice(0, slash), name: rel.slice(slash + 1) };
}
