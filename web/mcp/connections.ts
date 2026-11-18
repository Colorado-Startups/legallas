// SPDX-License-Identifier: Apache-2.0
// /connections: a member lists and revokes their own AI connections; the owner sees and revokes everyone's
// (owner: session C2). Access and membership are checked by the router before handleConnections runs. Revoking
// is a same-origin form with the double-submit token from forms.ts, and writes ai_disconnect through audit.ts.
import type { GrantSummary } from '@cloudflare/workers-oauth-provider';
import { canPerform } from '../worker/auth.ts';
import type { Member } from '../worker/env.ts';
import { aiAudit } from './audit.ts';
import { userIdFor, type ConnectionRow, type GrantMetadata, type GrantStore, type McpEnv } from './contract.ts';
import { GRANT_FIELD, checkForm, formToken } from './forms.ts';
import { formPageResponse, htmlResponse, renderConnections, renderMessage } from './pages/index.ts';

/** The library issues 16-character ids from this alphabet; anything else is refused before any lookup. */
const GRANT_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** listUserGrants' maximum page, and a bound on pages so a bad cursor can never loop forever. */
const PAGE_LIMIT = 1000;
const MAX_PAGES = 50;

function clientNameOf(grant: GrantSummary): string {
  const metadata = grant.metadata as Partial<GrantMetadata> | null | undefined;
  const name = typeof metadata?.clientName === 'string' ? metadata.clientName.trim() : '';
  return name || grant.clientId;
}

function toRow(email: string, grant: GrantSummary): ConnectionRow {
  return {
    grantId: grant.id,
    email,
    clientName: clientNameOf(grant),
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt ?? null,
  };
}

/** GrantStore over env.OAUTH_PROVIDER (listUserGrants, revokeGrant; GrantMetadata.clientName). */
export function grantStore(env: Pick<McpEnv, 'OAUTH_PROVIDER'>): GrantStore {
  return {
    async listForMember(email) {
      const rows: ConnectionRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await env.OAUTH_PROVIDER.listUserGrants(userIdFor(email), { limit: PAGE_LIMIT, cursor });
        for (const grant of result.items) rows.push(toRow(email, grant));
        if (!result.cursor) break;
        cursor = result.cursor;
      }
      return rows;
    },
    async revoke(grantId, email) {
      await env.OAUTH_PROVIDER.revokeGrant(grantId, userIdFor(email));
    },
  };
}

/** The owner's oversight permission (the same one that reads the activity log) shows everyone's connections. */
function seesEveryone(member: Member): boolean {
  return canPerform(member.role, 'viewActivity');
}

/** The connections this member may see and revoke: their own, or every member's for the owner. Newest first. */
export async function visibleConnections(env: McpEnv, member: Member): Promise<ConnectionRow[]> {
  const store = grantStore(env);
  let emails = [member.email];
  if (seesEveryone(member)) {
    const { results } = await env.DB.prepare('SELECT email FROM members ORDER BY email').all<{ email: string }>();
    emails = results.map((row) => row.email);
  }
  const lists = await Promise.all(emails.map((email) => store.listForMember(email)));
  return lists.flat().sort((a, b) => a.email.localeCompare(b.email) || b.createdAt - a.createdAt);
}

interface PageOptions {
  notice?: string;
  status?: number;
  /** A grant just revoked: KV listings are eventually consistent, so it may still be listed for a short while. */
  revoked?: string;
}

async function renderPage(request: Request, env: McpEnv, member: Member, { notice, status = 200, revoked }: PageOptions = {}) {
  const rows = (await visibleConnections(env, member)).filter((row) => row.grantId !== revoked);
  const { token, setCookie } = formToken(request);
  const html = renderConnections({ memberEmail: member.email, isOwner: seesEveryone(member), rows, formToken: token, notice });
  return formPageResponse(html, status, setCookie ? { 'set-cookie': setCookie } : undefined);
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function message(status: number, title: string, text: string): Response {
  return htmlResponse(renderMessage({ title, message: text, status }), status);
}

async function revokeFromForm(request: Request, env: McpEnv, member: Member, audit: typeof aiAudit) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return message(400, 'Bad request', 'The form could not be read. Reload the page and try again.');
  }
  if (!(await checkForm(request, form))) {
    return message(403, 'Form expired', 'This form is out of date or came from another site. Reload the page and try again.');
  }
  const grantId = form.get(GRANT_FIELD);
  if (typeof grantId !== 'string' || !GRANT_ID.test(grantId)) {
    return message(400, 'Bad request', 'No connection was named. Reload the page and try again.');
  }
  // Only a grant in this member's own view can be revoked: counsel see theirs, the owner sees everyone's.
  const row = (await visibleConnections(env, member)).find((r) => r.grantId === grantId);
  if (!row) return renderPage(request, env, member, { notice: 'That connection was not found. It may already be disconnected.', status: 404 });

  // Revoke first: a logging failure must never keep a connection alive (fail-closed is for reads). A failed revoke
  // writes no audit row. The row records who acted (the room's audit rule); via names the app that lost access.
  try {
    await grantStore(env).revoke(row.grantId, row.email);
  } catch (error) {
    console.error(JSON.stringify({ event: 'connections.revoke_failed', code: errorCode(error) }));
    return message(503, 'Not disconnected', 'The disconnect may not have finished. Reload and try again.');
  }
  const whose = row.email === member.email ? '' : ` for ${row.email}`;
  let notice = `Disconnected ${row.clientName}${whose}.`;
  try {
    await audit(env, { email: member.email, action: 'ai_disconnect', documentId: null, via: row.clientName, request });
  } catch (error) {
    console.error(JSON.stringify({ event: 'connections.audit_failed', code: errorCode(error) }));
    notice = `Disconnected ${row.clientName}${whose}, but the activity log could not record it.`;
  }
  return renderPage(request, env, member, { notice, revoked: row.grantId });
}

/**
 * GET lists connections; POST revokes one. `audit` is injectable for tests (defaults to aiAudit). Access and the
 * members row are verified by the router before this runs.
 */
export async function handleConnections(request: Request, env: McpEnv, member: Member, audit: typeof aiAudit = aiAudit): Promise<Response> {
  if (request.method === 'GET' || request.method === 'HEAD') return renderPage(request, env, member);
  if (request.method === 'POST') return revokeFromForm(request, env, member, audit);
  const response = message(405, 'Not allowed', 'This page only lists and disconnects AI connections.');
  response.headers.set('allow', 'GET, HEAD, POST');
  return response;
}
