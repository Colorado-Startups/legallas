// SPDX-License-Identifier: Apache-2.0
// An email saved as an .eml file (RFC 5322 with MIME) set out as plain text: its From, To, Cc, Bcc, Reply-To, Date
// and Subject, its attachments by name, then the message text. The text is the text/plain part; a message with only
// HTML is turned into text (htmlText). Attachments are never decoded, only named. A message attached to the email
// (message/rfc822, as when one is forwarded as an attachment) is set out the same way after the text. The sync
// indexes this text (scripts/extract.ts directTextPages) and the text viewer shows the same (doc-views.ts showText),
// so a cite's pinpoint quote is found on screen. Pure, with no DOM, so Node and the browser share it. A file that
// does not open with a header block gives null and is shown and indexed as it is. Bump EMAIL_RENDER_VERSION
// (scripts/extract.ts) when the output changes.

/** The headers shown, in this order, each when present. */
const SHOWN = ['From', 'To', 'Cc', 'Bcc', 'Reply-To', 'Date', 'Subject'];
/** Nested multiparts and attached messages followed at most; deeper ones are left out. */
const MAX_DEPTH = 8;
/** MIME parts read at most in one message. */
const MAX_PARTS = 500;
const HEADER_LINE = /^([!-9;-~]+):[ \t]*(.*)$/;
const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018',
  rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', bull: '\u2022', middot: '\u00b7', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', euro: '\u20ac', pound: '\u00a3', cent: '\u00a2', sect: '\u00a7', deg: '\u00b0',
  times: '\u00d7', laquo: '\u00ab', raquo: '\u00bb', shy: '', zwnj: '', zwj: '',
};

interface Entity {
  /** Lowercase header name to its first value, unfolded. */
  headers: Map<string, string>;
  body: string;
}

interface Walk {
  texts: string[];
  attachments: string[];
  /** Parts read so far, shared with attached messages. */
  budget: { parts: number };
}

/** Headers and body of a message or MIME part (line ends already "\n"), or null when it has no header block. */
function parseEntity(raw: string): Entity | null {
  const end = raw.startsWith('\n') ? 0 : raw.indexOf('\n\n');
  const head = end < 0 ? raw : raw.slice(0, end);
  const headers = new Map<string, string>();
  let last: string | null = null;
  for (const line of head === '' ? [] : head.split('\n')) {
    if (/^[ \t]/.test(line) && last) {
      headers.set(last, `${headers.get(last)} ${line.trim()}`);
      continue;
    }
    const match = HEADER_LINE.exec(line);
    if (!match) return null;
    const name = match[1]!.toLowerCase(); // safe: group 1 always takes part in a match
    last = headers.has(name) ? null : name;
    if (last) headers.set(last, match[2] ?? '');
  }
  return { headers, body: end < 0 ? '' : raw.slice(end + (end === 0 ? 1 : 2)) };
}

/** Base64 to bytes, or null when it is not base64. Whitespace and padding are ignored. */
function base64Bytes(text: string): Uint8Array | null {
  let clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  if (clean.length % 4 === 1) clean = clean.slice(0, -1);
  try {
    return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Quoted-printable to bytes: "=XX" is a byte, anything else its UTF-8 bytes. Soft line breaks go first. */
function qpBytes(text: string): Uint8Array {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < text.length; i += 1) {
    const hex = text[i] === '=' ? /^[0-9A-Fa-f]{2}$/.exec(text.slice(i + 1, i + 3)) : null;
    if (hex) {
      bytes.push(parseInt(hex[0], 16));
      i += 2;
    } else {
      for (const byte of encoder.encode(text[i])) bytes.push(byte);
    }
  }
  return Uint8Array.from(bytes);
}

/** Bytes in the named charset; an unknown charset reads as UTF-8. Bad bytes become U+FFFD, never an error. */
function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset.replace(/\*.*$/, '').trim() || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** RFC 2047 encoded words (=?charset?B?...?= and =?charset?Q?...?=) decoded; whitespace between two is dropped. */
function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g, (whole, charset: string, encoding: string, text: string) => {
      const bytes = encoding.toUpperCase() === 'B' ? base64Bytes(text) : qpBytes(text.replace(/_/g, ' '));
      return bytes ? decodeBytes(bytes, charset) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** RFC 2231 parameter sections (name*0*, name*1, ...) joined in order, then decoded. */
function joinSections(raw: Map<string, string>, name: string): string {
  const sections = [...raw.entries()].filter(([key]) => key === name || key.startsWith(`${name}*`));
  sections.sort(([a], [b]) => Number(/\*(\d+)/.exec(a)?.[1] ?? 0) - Number(/\*(\d+)/.exec(b)?.[1] ?? 0));
  const joined = sections.map(([, value]) => value).join('');
  const extended = sections.some(([key]) => key.endsWith('*')) ? /^([^']*)'[^']*'(.*)$/s.exec(joined) : null;
  if (!extended) return decodeWords(joined);
  return decodeBytes(qpBytes(extended[2]!.replace(/%(?=[0-9A-Fa-f]{2})/g, '=')), extended[1] || 'utf-8'); // safe: group 2 always matches
}

/** A structured header such as Content-Type: its lowercase value, and its parameters by lowercase name. */
function headerParams(header: string | undefined): { value: string; params: Map<string, string> } {
  const pieces = (header ?? '').match(/(?:"(?:\\.|[^"\\])*"|[^;"])+/g) ?? [];
  const raw = new Map<string, string>();
  for (const piece of pieces.slice(1)) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const value = piece.slice(eq + 1).trim();
    raw.set(piece.slice(0, eq).trim().toLowerCase(), /^".*"$/s.test(value) ? value.slice(1, -1).replace(/\\(.)/g, '$1') : value);
  }
  const params = new Map<string, string>();
  for (const key of raw.keys()) {
    const name = key.replace(/\*.*$/, '');
    if (!params.has(name)) params.set(name, joinSections(raw, name));
  }
  return { value: (pieces[0] ?? '').trim().toLowerCase(), params };
}

/** A leaf part's text, its transfer encoding undone and its charset applied. */
function partText(entity: Entity): string {
  const charset = headerParams(entity.headers.get('content-type')).params.get('charset') ?? 'utf-8';
  const encoding = (entity.headers.get('content-transfer-encoding') ?? '').trim().toLowerCase();
  if (encoding === 'base64') {
    const bytes = base64Bytes(entity.body);
    return bytes ? decodeBytes(bytes, charset) : entity.body;
  }
  if (encoding === 'quoted-printable') return decodeBytes(qpBytes(entity.body.replace(/=[ \t]*\n/g, '')), charset);
  return entity.body;
}

/** HTML as plain text: no head, scripts, styles or comments; blocks and breaks become lines; entities decoded. */
export function htmlText(html: string): string {
  // Each removal repeats until nothing changes: removing one piece can join its neighbours into a new comment or tag.
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<(head|script|style|title)\b[\s\S]*?<\/\1(?:[\s/][^>]*)?>/gi, '');
  } while (text !== previous);
  text = text
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?(?:p|div|tr|h[1-6]|blockquote|table|ul|ol|pre|section|article|header|footer)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' ');
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== previous);
  return text
    .replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/gi, (whole, ref: string) => {
      if (ref[0] !== '#') return HTML_ENTITIES[ref.toLowerCase()] ?? whole;
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The child parts of a multipart body. An unterminated one (a cut file) keeps what it has. */
function children(body: string, boundary: string): Entity[] {
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of body.split('\n')) {
    const bare = line.trimEnd();
    if (bare === `--${boundary}` || bare === `--${boundary}--`) {
      if (current) parts.push(current.join('\n'));
      if (bare.length > boundary.length + 2) return parts.map(parseEntity).filter((e): e is Entity => e !== null);
      current = [];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) parts.push(current.join('\n'));
  return parts.map(parseEntity).filter((e): e is Entity => e !== null);
}

const typeOf = (entity: Entity) => headerParams(entity.headers.get('content-type')).value || 'text/plain';

/** Collects the readable text and the attachment names of one part and everything under it. */
function walk(entity: Entity, depth: number, out: Walk): void {
  if (depth > MAX_DEPTH || ++out.budget.parts > MAX_PARTS) return;
  const contentType = headerParams(entity.headers.get('content-type'));
  const type = contentType.value || 'text/plain';
  const disposition = headerParams(entity.headers.get('content-disposition'));
  const name = disposition.params.get('filename') || contentType.params.get('name');
  if (type.startsWith('multipart/')) {
    const boundary = contentType.params.get('boundary');
    const kids = boundary ? children(entity.body, boundary) : [];
    // Alternatives say the same thing: the plain text one, else the last (richest) one.
    const chosen = type === 'multipart/alternative' ? [kids.find((kid) => typeOf(kid) === 'text/plain') ?? kids.at(-1)] : kids;
    for (const kid of chosen) if (kid) walk(kid, depth + 1, out);
  } else if (type === 'message/rfc822') {
    out.attachments.push(name || 'attached message');
    const inner = parseEntity(partText(entity).replace(/\r\n?/g, '\n'));
    if (inner) out.texts.push(`Attached message:\n${render(inner, depth + 1, out.budget)}`);
  } else if (disposition.value === 'attachment' || (name && !type.startsWith('text/'))) {
    out.attachments.push(name || `unnamed ${type}`);
  } else if (type === 'text/plain') {
    out.texts.push(partText(entity));
  } else if (type === 'text/html') {
    out.texts.push(htmlText(partText(entity)));
  }
}

/** The shown headers, the attachments line, then the texts, separated by blank lines. */
function render(entity: Entity, depth: number, budget = { parts: 0 }): string {
  const out: Walk = { texts: [], attachments: [], budget };
  walk(entity, depth, out);
  const head = SHOWN.flatMap((label) => {
    const value = entity.headers.get(label.toLowerCase());
    return value ? [`${label}: ${decodeWords(value)}`] : [];
  });
  if (out.attachments.length > 0) head.push(`Attachments: ${out.attachments.join('; ')}`);
  const texts = out.texts.map((text) => text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()).filter((text) => text !== '');
  return [head.join('\n'), ...texts].filter((block) => block !== '').join('\n\n');
}

/** The email as text, or null when `raw` does not open with a header block naming a sender, date or subject. */
export function renderEml(raw: string): string | null {
  const text = raw.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').replace(/^From [^\n]*\n/, '');
  const entity = parseEntity(text);
  if (!entity || !['from', 'date', 'subject'].some((name) => entity.headers.has(name))) return null;
  return render(entity, 0);
}
