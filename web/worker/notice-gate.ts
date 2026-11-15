// SPDX-License-Identifier: Apache-2.0
// A3, the full notice before first use (docs/legal/product-notices.md).
// | Member                    | Pages           | Anything else       |
// | No row for NOTICE_VERSION | 303 to /notice/ | 403 notice_required |
// | Ticked                    | as before       | as before           |
// Sign-out is Access's /cdn-cgi/access/logout. Owner view: GET /api/activity/notice. Guests: rooms.ts.
// AI sign-in and tool calls: mcp/authorize.ts, mcp/server.ts (tickedCurrent).
import { clientInfo } from './audit.ts';
import { canPerform } from './auth.ts';
import type { Env, Member, RequestContext } from './env.ts';
import { roomMark } from './extensions.ts';
import { FIRST_USE_PRIVILEGE, FULL_NOTICE, NOTICE_TICK, NOTICE_VERSION, tickedCurrent } from './full-notice.ts';
import { withSecurityHeaders } from './headers.ts';
import { errorJson, json, readLimited } from './http.ts';
import { roomNamesOf } from './room-names.ts';
import type { Route } from './router.ts';

export const NOTICE_PATH = '/notice/';
export const NOTICE_TICKS_PATH = '/api/activity/notice';
const MAX_BODY = 4096; // three short form fields

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

const PRIVILEGE_ID = 'privilege'; // A7's block, where A3's "Read more" points

/** A notices-file line as HTML: escaped, then **bold**, A3's A7 link, other links and [placeholders] as words. */
export function inlineHtml(markdown: string): string {
  return escapeHtml(markdown)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(#a7-privilege-and-confidentiality\)/g, `<a href="#${PRIVILEGE_ID}">$1</a>`)
    .replace(/\[([^\]]+)\](?:\([^)]*\))?/g, '$1');
}

/** After the tick: a path on this room, else "/". */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 2000 || !value.startsWith('/') || value.startsWith('//') || /[\\\p{Cc}]/u.test(value)) return '/';
  if (value === '/notice' || value === NOTICE_PATH || value.startsWith(`${NOTICE_PATH}?`)) return '/';
  return value;
}

async function tickedAt(db: D1Database, email: string): Promise<string | null> {
  return db.prepare('SELECT ticked_at FROM notice_acks WHERE email = ?1 AND version = ?2').bind(email, NOTICE_VERSION).first<string>('ticked_at');
}

type PageState = { ticked: string } | { message: string | null };

/** Like the door: the public stylesheet only, no room script. */
function noticePage(env: Pick<Env, 'INSTANCE_NAME'>, next: string, state: PageState, status = 200): Response {
  const [title, ...paragraphs] = FULL_NOTICE;
  const [privilege, ...cautions] = FIRST_USE_PRIVILEGE;
  const action =
    'ticked' in state
      ? `<p class="door-lede">You ticked this notice on ${escapeHtml(state.ticked.slice(0, 16).replace('T', ' '))} UTC.</p>` +
        `<p class="door-help"><a class="door-button" href="${escapeHtml(next)}">Continue to the room</a></p>`
      : (state.message ? `<p class="door-lede" role="alert">${escapeHtml(state.message)}</p>` : '') +
        `<form class="door-help" method="post" action="${NOTICE_PATH}">` +
        `<input type="hidden" name="version" value="${NOTICE_VERSION}">` +
        `<input type="hidden" name="next" value="${escapeHtml(next)}">` +
        `<p><label><input type="checkbox" name="tick" value="1" required> ${escapeHtml(NOTICE_TICK)}</label></p>` +
        '<p><button class="door-button" type="submit">Continue</button></p></form>';
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><meta name="color-scheme" content="light">' +
    '<link rel="icon" href="/welcome/favicon.svg" type="image/svg+xml">' +
    `<link rel="stylesheet" href="/welcome/door.css"><title>${escapeHtml(roomNamesOf(env).instanceName)}</title></head>` +
    `<body><main class="door door-compact">${roomMark()(false)}` +
    `<h1 class="door-title door-title-small">${inlineHtml(title.replace(/^\*\*(.*)\*\*$/, '$1'))}</h1>` +
    paragraphs.map((p) => `<p class="door-help">${inlineHtml(p)}</p>`).join('') +
    `<section class="door-help" id="${PRIVILEGE_ID}"><p>${inlineHtml(privilege)}</p>` +
    `<ul>${cautions.map((c) => `<li>${inlineHtml(c.replace(/^- /, ''))}</li>`).join('')}</ul></section>` +
    action +
    `<p class="door-help">Notice version ${NOTICE_VERSION}.</p>` +
    '<hr class="door-rule"><a class="door-button" href="/cdn-cgi/access/logout">Sign out</a></main></body></html>';
  return withSecurityHeaders(new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }), 'page');
}

async function serveNotice(request: Request, env: Env, url: URL, member: Member): Promise<Response> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    const next = safeNext(url.searchParams.get('next'));
    const ticked = await tickedAt(env.DB, member.email);
    return noticePage(env, next, ticked === null ? { message: null } : { ticked });
  }
  if (request.method !== 'POST') {
    const response = errorJson('method_not_allowed', 405);
    response.headers.set('Allow', 'GET, HEAD, POST');
    return withSecurityHeaders(response, 'api');
  }
  const text = await readLimited(request, MAX_BODY);
  if (text === null) return withSecurityHeaders(errorJson('too_large', 413), 'api');
  const form = new URLSearchParams(text);
  const next = safeNext(form.get('next'));
  if (form.get('version') !== NOTICE_VERSION) {
    return noticePage(env, next, { message: 'This notice changed while you read it. Read this version, then tick the box.' }, 409);
  }
  if (form.get('tick') !== '1') return noticePage(env, next, { message: 'Tick the box to continue.' }, 400);
  const { ip, userAgent } = clientInfo(request);
  await env.DB.prepare('INSERT OR IGNORE INTO notice_acks (email, version, ip, user_agent) VALUES (?1, ?2, ?3, ?4)')
    .bind(member.email, NOTICE_VERSION, ip, userAgent)
    .run();
  const to = new URL(next, url.origin);
  return withSecurityHeaders(new Response(null, { status: 303, headers: { Location: to.origin === url.origin ? to.href : url.origin + '/' } }), 'page');
}

/** room.ts, after the write-origin check: a Response until the member ticks, else null. */
export async function noticeGate(request: Request, env: Env, url: URL, member: Member): Promise<Response | null> {
  if (url.pathname === NOTICE_PATH || url.pathname === '/notice') return serveNotice(request, env, url, member);
  if (await tickedCurrent(env.DB, member.email)) return null;
  const page = (request.method === 'GET' || request.method === 'HEAD') && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/files/');
  if (!page) return withSecurityHeaders(errorJson('notice_required', 403), 'api');
  const to = new URL(NOTICE_PATH, url.origin);
  if (url.pathname !== '/') to.searchParams.set('next', url.pathname + url.search);
  return withSecurityHeaders(new Response(null, { status: 303, headers: { Location: to.href, 'Cache-Control': 'no-store' } }), 'page');
}

export interface NoticeTick {
  email: string;
  name: string | null;
  role: string;
  version: string | null;
  ticked_at: string | null;
  current: boolean;
}

const TICKS_SQL = `
SELECT m.email, m.name, m.role, n.version, n.ticked_at
  FROM members m
  LEFT JOIN notice_acks n ON n.id = (SELECT id FROM notice_acks WHERE email = m.email ORDER BY ticked_at DESC, id DESC LIMIT 1)
 ORDER BY m.email`;

/** Each member's last tick (viewActivity: owner). */
async function listNoticeTicks({ env, member }: RequestContext): Promise<Response> {
  if (!canPerform(member.role, 'viewActivity')) return errorJson('forbidden', 403);
  const { results } = await env.DB.prepare(TICKS_SQL).all<Omit<NoticeTick, 'current'>>();
  return json({ current: NOTICE_VERSION, members: results.map((row) => ({ ...row, current: row.version === NOTICE_VERSION })) });
}

export const routes: Route[] = [{ method: 'GET', path: NOTICE_TICKS_PATH, handler: listNoticeTicks }];
