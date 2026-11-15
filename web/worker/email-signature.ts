// SPDX-License-Identifier: Apache-2.0
/**
 * The assistant's sign-off on every email the Workers send (signins.ts sendAlertEmail), and the HTML around it.
 * A room that sets nothing signs with neutralSignature, built from its configurable names (room-names.ts: the
 * assistant and instance names). A room with a signature of its own registers it from its Worker entries
 * (extensions.ts extendRoom), and both Workers then sign with it.
 *
 * Every form keeps the safeguard line, in the third person because a signature speaks about its sender: the
 * assistant is AI, not a lawyer, and the reader isn't receiving legal advice from one (docs/legal/product-notices.md A1,
 * "Say"; #213). Its mail reaches lawyers, the other side's included, and
 * nothing it writes may read as holding itself out as one.
 *
 * No imports beyond room-names.ts (which has none), so the scripts tsconfig can compile it without the Worker's types.
 */
import type { RoomNames } from './room-names.ts';

export interface Signature {
  /** The plain-text sign-off, appended to a body that already ends in a newline. */
  text: string;
  /** The HTML signature, closing the HTML part's body (htmlEmail). */
  html: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The default sign-off: the assistant's name, what it is and for which room, and the safeguard. The text form is a
 * blank line, the RFC 3676 "-- " delimiter (so mail clients can fold it), the lines and a final newline; the HTML
 * form is one table with inline styles and no image.
 */
export function neutralSignature(names: Pick<RoomNames, 'assistantName' | 'instanceName'>): Signature {
  const lines = [
    names.assistantName,
    `AI assistant for ${names.instanceName}`,
    `${names.assistantName} is AI, not a lawyer. You aren't receiving legal advice from a licensed lawyer.`,
  ];
  const [name, role, safeguard] = lines.map(escapeHtml);
  const line = 'font-size:13px;line-height:19px;color:#5b5b5b;';
  const html = [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">',
    '  <tr>',
    '    <td style="vertical-align:top;border-left:2px solid #8a8a8a;padding:0 0 0 16px;">',
    `      <div style="font-size:15px;line-height:20px;font-weight:bold;color:#1f1f1f;">${name}</div>`,
    `      <div style="${line}">${role}</div>`,
    `      <div style="${line}padding-top:6px;">${safeguard}</div>`,
    '    </td>',
    '  </tr>',
    '</table>',
    '',
  ].join('\n');
  return { text: ['', '-- ', ...lines, ''].join('\n'), html };
}

/** A plain-text body as HTML paragraphs: blank lines split paragraphs, single line breaks become <br>. */
export function textToHtml(text: string): string {
  const trimmed = text.replace(/\r\n?/g, '\n').trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>\n')}</p>`)
    .join('\n');
}

/** A whole HTML email: the body fragment, then the signature's HTML. */
export function htmlEmail(bodyHtml: string, signatureHtml: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '</head>',
    '<body>',
    bodyHtml.trim(),
    signatureHtml.trim(),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
