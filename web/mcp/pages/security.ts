// SPDX-License-Identifier: Apache-2.0
// The public /security page, for a firm's IT, security and risk teams: the security brief (connect/security-brief.md)
// with this room's names and hosts. The brief reaches the Worker word for word as security-brief.generated.ts
// (scripts/security-brief.ts writes it, security.test.ts fails when it drifts), so the page and the brief cannot say
// different things. It shows no room's live settings: the page is public, and a room's weaker settings would help an
// attacker more than a reader. No sign-in, no scripts, no forms.
import { CONNECT_PATH, MCP_ORIGIN } from '../contract.ts';
import { contactEmail, mcpHost, operatorName, ownerName, ownerWebsite, sentence } from '../../worker/room-settings.ts';
import { escapeHtml, frame } from './html.ts';
import { inline, renderMarkdown, slug } from './markdown.ts';
import { SECURITY_BRIEF_MD } from './security-brief.generated.ts';

/** The page's path, beside /connect. Links in emails and the room point here. */
export const SECURITY_PATH = '/security';

/** The names and hosts the brief is written with, and what each becomes in a room. */
export interface BriefNames {
  mcpOrigin: string;
  mcpHost: string;
  contact: string;
  /** The owner's website, whose /.well-known/security.txt the brief cites for the contact. */
  website: string;
  /** "the owner" in a sentence (room-settings.ts ownerName). */
  owner: string;
  /** Who operates the room (room-settings.ts operatorName). */
  operator: string;
}

/** What connect/security-brief.md says, which are room-settings.ts's defaults: a room with no settings shows it as written. */
export const BRIEF_PLACEHOLDERS: BriefNames = {
  mcpOrigin: 'https://mcp.room.example.com',
  mcpHost: 'mcp.room.example.com',
  contact: 'email@example.com',
  website: 'https://example.com',
  owner: 'the owner',
  operator: 'the owner',
};

/** This room's values, fixed when the Worker is built (room-settings.ts). */
export const ROOM_NAMES: BriefNames = {
  mcpOrigin: MCP_ORIGIN,
  mcpHost,
  contact: contactEmail,
  website: ownerWebsite,
  owner: ownerName,
  operator: operatorName,
};

/**
 * The brief with a room's names. One pass over the text, longest placeholder first, so a value that holds another
 * placeholder (a host under example.com) is never replaced twice.
 */
export function fillBrief(markdown: string, names: BriefNames): string {
  const p = BRIEF_PLACEHOLDERS;
  const pairs = new Map<string, string>([
    [`Operator: **${p.operator}**`, `Operator: **${names.operator}**`],
    [p.mcpOrigin, names.mcpOrigin],
    [p.mcpHost, names.mcpHost],
    [p.contact, names.contact],
    [p.website, names.website],
    [sentence(p.owner), sentence(names.owner)],
    [p.owner, names.owner],
  ]);
  const pattern = new RegExp([...pairs.keys()].map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return markdown.replace(pattern, (match) => pairs.get(match) ?? match);
}

/** The brief as the page shows it: the opening paragraph as the lead, the sections, and their headings for the contents. */
export function briefParts(markdown: string): { lead: string; sections: string; headings: string[] } {
  const text = markdown.replace(/\r\n?/g, '\n').replace(/^# .*\n+/, '');
  const cut = text.indexOf('\n\n');
  const intro = cut < 0 ? text : text.slice(0, cut);
  const rest = cut < 0 ? '' : text.slice(cut);
  const headings = [...rest.matchAll(/^## +(\S.*)$/gm)].map((match) => match[1].trim());
  return { lead: inline(intro.split('\n').map((line) => line.trim()).join(' ')), sections: renderMarkdown(rest), headings };
}

/** The brief with this room's names, rendered once per isolate: the build fixes both. */
let roomBrief: ReturnType<typeof briefParts> | undefined;

/** Page-only rules, added to the shared sheet in <head>. Tokens only. */
const SECURITY_STYLES = `
.sx-toc{margin:1.5rem 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:0 1.25rem;max-width:66ch}
.sx-toc a{display:inline-flex;align-items:center;min-height:var(--target)}
.sx td{height:auto;padding:0.5rem 0.75rem;vertical-align:top;overflow-wrap:anywhere}
.sx th{white-space:normal}
.sx p{margin:0.75rem 0 0}
.sx h3{font-size:1.0625rem;line-height:1.5rem;margin-top:1.5rem}
.sx pre{margin:1rem 0 0;padding:0.75rem 1rem;background:var(--panel);border-radius:var(--radius);overflow-x:auto;font:500 0.75rem/1.125rem var(--font-mono)}
.sx :not(pre)>code{padding:0 0.25rem;background:var(--panel);border-radius:var(--radius-chip);font:500 0.875em var(--font-mono);overflow-wrap:anywhere}
.sx .table-wrap{max-width:none}`.replace(/\n/g, '');

/**
 * The whole page. mcp/oauth.ts serves it for GET and HEAD /security (publicPage, the same headers as /connect). Public,
 * because a firm's IT and security team are not room members.
 */
export function renderSecurityPage(names: BriefNames = ROOM_NAMES): string {
  const brief = names === ROOM_NAMES ? (roomBrief ??= briefParts(fillBrief(SECURITY_BRIEF_MD, names))) : briefParts(fillBrief(SECURITY_BRIEF_MD, names));
  const contents = brief.headings.map((heading) => `<li><a href="#${slug(heading)}">${escapeHtml(heading)}</a></li>`).join('');
  const body = `<div class="sx">
<h1>Security</h1>
<p class="lead">${brief.lead}</p>
<nav aria-label="On this page"><ul class="sx-toc">${contents}</ul></nav>
<div class="prose">
${brief.sections}
</div>
</div>`;
  const html = frame({ title: 'Security', body, nav: [{ href: CONNECT_PATH, label: 'Connect your AI' }] });
  return html.replace('</style>', `${SECURITY_STYLES}</style>`);
}
