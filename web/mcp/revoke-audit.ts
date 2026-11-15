// SPDX-License-Identifier: Apache-2.0
// RFC 7009 revocation audit. When an AI tool revokes a refresh token at POST /token, the OAuth library deletes the
// whole grant but writes nothing to audit_log, so the member's activity feed would never show the disconnect.
// This wraps the library call: it reads the grant before and after, and writes ai_disconnect when a 200 removed
// it. Revoking an access token leaves the grant in place and writes nothing. The token itself is never logged.
import { aiAudit } from './audit.ts';
import type { GrantMetadata, McpEnv } from './contract.ts';

/** audit_log.via when neither the grant, the client record nor a CIMD client ID names the app. */
export const REVOKE_VIA = 'revocation';

const TOKEN_PATH = '/token';

export type RevokeAuditEnv = Pick<McpEnv, 'DB' | 'OAUTH_KV'>;

interface GrantRef {
  userId: string;
  grantId: string;
}

/** What the audit needs from a stored grant (the library's record; metadata is ours, from completeAuthorization). */
interface StoredGrant {
  clientId?: unknown;
  metadata?: Partial<GrantMetadata> | null;
}

/**
 * The grant a token names, using the library's own rule: exactly three ':'-separated parts, `userId:grantId:secret`.
 * Null for anything else, which the library answers with a bare 200.
 */
export function grantRefFromToken(token: string): GrantRef | null {
  const parts = token.split(':');
  if (parts.length !== 3 || parts[0] === '' || parts[1] === '') return null;
  return { userId: parts[0], grantId: parts[1] };
}

/** The token a revocation request carries, or null when the request is anything else (the library's own test). */
async function revocationToken(request: Request): Promise<string | null> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== TOKEN_PATH) return null;
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return null;
  try {
    const form = await request.clone().formData();
    const token = form.get('token');
    return !form.get('grant_type') && typeof token === 'string' && token !== '' ? token : null;
  } catch {
    return null;
  }
}

async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    return await kv.get<T>(key, 'json');
  } catch {
    return null;
  }
}

function named(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The host of a Client ID Metadata Document client ID (an https URL), else null. */
function cimdHost(clientId: string): string | null {
  if (!clientId.startsWith('https://')) return null;
  try {
    return new URL(clientId).hostname || null;
  } catch {
    return null;
  }
}

/**
 * The app's name for audit_log.via: the name consent showed (grant metadata, as /connections and the sweep use),
 * else the registered client's name (KV `client:{clientId}`), else a CIMD client ID's host, else REVOKE_VIA.
 */
export async function viaForGrant(kv: KVNamespace, grant: StoredGrant): Promise<string> {
  const fromGrant = named(grant.metadata?.clientName);
  if (fromGrant) return fromGrant;
  const clientId = named(grant.clientId);
  if (!clientId) return REVOKE_VIA;
  const client = await readJson<{ clientName?: unknown }>(kv, `client:${clientId}`);
  return named(client?.clientName) ?? cimdHost(clientId) ?? REVOKE_VIA;
}

/**
 * Forwards `request` to the library (`forward`, which gets the original, unread request) and, for a revocation
 * that removed a grant, writes one ai_disconnect row for the grant's member. A failed audit write is logged by
 * code and never changes the library's answer: the revocation already stands. `audit` is injectable for tests.
 */
export async function withRevocationAudit(
  request: Request,
  env: RevokeAuditEnv,
  forward: (request: Request) => Promise<Response>,
  audit: typeof aiAudit = aiAudit,
): Promise<Response> {
  const token = await revocationToken(request);
  const ref = token === null ? null : grantRefFromToken(token);
  if (!ref) return forward(request);
  const key = `grant:${ref.userId}:${ref.grantId}`;
  const before = await readJson<StoredGrant>(env.OAUTH_KV, key);
  const response = await forward(request);
  if (!before || response.status !== 200) return response;
  try {
    if ((await env.OAUTH_KV.get(key)) !== null) return response;
    const via = await viaForGrant(env.OAUTH_KV, before);
    await audit(env, { email: ref.userId, action: 'ai_disconnect', documentId: null, via, request });
  } catch {
    console.error('mcp_revoke_audit_failed');
  }
  return response;
}
