// SPDX-License-Identifier: Apache-2.0
// Two locks: Cloudflare Access proves who you are (a signed JWT), the members table decides whether
// you are allowed in. Both must pass on every request, including static files.
//
// Why not ctx.access: Cloudflare does not pass ctx.access to Workers that serve static assets, so the
// Worker verifies the Cf-Access-Jwt-Assertion header itself against the team's public keys.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { normalizeEmail } from './email.ts';
import type { Env, Member, Role } from './env.ts';
import { hasSecondFactor } from './mfa.ts';

type AuthEnv = Pick<Env, 'TEAM_DOMAIN' | 'ACCESS_AUD' | 'ALLOW_DEV_IDENTITY' | 'DEV_IDENTITY_EMAIL'>;

/** Hosts where local-only switches (the dev identity, ASK_MOCK) may take effect. */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

// One key set per team domain per isolate; jose caches and refreshes the keys itself.
const keySets = new Map<string, JWTVerifyGetKey>();

function accessKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = keySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain));
    keySets.set(teamDomain, keys);
  }
  return keys;
}

/**
 * What the gate learns from a verified Access token. `sub` and `iat` identify the Access session
 * (a new login issues a new token, so a new `iat`); `country` is where the user authenticated from.
 * Only `email` is guaranteed: the others are null when the token lacks them, and always for the
 * localhost dev identity. `secondFactor` says whether the token's `amr` claim names a second factor (mfa.ts); it is
 * null only for the dev identity, which has no token, so REQUIRE_MFA never refuses it.
 */
export interface AccessIdentity {
  email: string;
  sub: string | null;
  iat: number | null;
  country: string | null;
  secondFactor: boolean | null;
}

const COUNTRY = /^[A-Z]{2}$/;
const MAX_SUB = 128;

/**
 * The caller's verified identity, or null. Fails closed: missing config, a missing, unsigned, forged,
 * expired or wrong-audience token, or a token without an email all return null. `getKey` exists for tests.
 */
export async function verifyAccessIdentity(
  request: Request,
  env: AuthEnv,
  getKey?: JWTVerifyGetKey,
): Promise<AccessIdentity | null> {
  const { hostname } = new URL(request.url);
  if (env.ALLOW_DEV_IDENTITY === '1' && LOCAL_HOSTS.has(hostname)) {
    const email = normalizeEmail(env.DEV_IDENTITY_EMAIL);
    // No token, so no Access session: the dev identity never counts as a sign-in.
    return email ? { email, sub: null, iat: null, country: null, secondFactor: null } : null;
  }

  const teamDomain = env.TEAM_DOMAIN?.trim().replace(/\/+$/, '');
  const audiences = (env.ACCESS_AUD ?? '').split(',').map((aud) => aud.trim()).filter(Boolean);
  if (!teamDomain || audiences.length === 0) return null;

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getKey ?? accessKeys(teamDomain), {
      issuer: teamDomain,
      audience: audiences,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'email'],
      clockTolerance: 5,
    });
    const email = normalizeEmail(payload.email);
    if (!email) return null;
    const { sub, iat, country, amr } = payload;
    return {
      email,
      sub: typeof sub === 'string' && sub.length > 0 && sub.length <= MAX_SUB ? sub : null,
      iat: Number.isSafeInteger(iat) ? (iat as number) : null,
      country: typeof country === 'string' && COUNTRY.test(country) ? country : null,
      secondFactor: hasSecondFactor(amr),
    };
  } catch {
    return null;
  }
}

type SyncAuthEnv = Pick<Env, 'TEAM_DOMAIN' | 'SYNC_ACCESS_AUD' | 'ALLOW_DEV_IDENTITY' | 'DEV_SYNC_CLIENT_ID'>;

const CLIENT_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * The Client ID of the Access service token behind this request, or null. The sync endpoints' check, kept apart from
 * verifyAccessIdentity, which refuses every service token because it requires an email. Fails closed the same way, and:
 * the audience is SYNC_ACCESS_AUD alone, and a token that names a person (an email, or a `sub` that is not empty) is
 * refused, so no one's sign-in reaches sync. Access says a service token carries its Client ID as `common_name`, `sub`
 * empty and `type` "app". `getKey` exists for tests.
 */
export async function verifySyncToken(request: Request, env: SyncAuthEnv, getKey?: JWTVerifyGetKey): Promise<string | null> {
  const { hostname } = new URL(request.url);
  if (env.ALLOW_DEV_IDENTITY === '1' && LOCAL_HOSTS.has(hostname)) {
    const id = env.DEV_SYNC_CLIENT_ID ?? '';
    return CLIENT_ID.test(id) ? id : null;
  }

  const teamDomain = env.TEAM_DOMAIN?.trim().replace(/\/+$/, '');
  const audience = env.SYNC_ACCESS_AUD?.trim();
  if (!teamDomain || !audience) return null;

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getKey ?? accessKeys(teamDomain), {
      issuer: teamDomain,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'common_name'],
      clockTolerance: 5,
    });
    if (payload.email !== undefined || (payload.sub ?? '') !== '' || payload.type !== 'app') return null;
    const { common_name: id } = payload;
    return typeof id === 'string' && CLIENT_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The caller's verified, normalized email, or null. See verifyAccessIdentity. */
export async function verifyAccess(request: Request, env: AuthEnv, getKey?: JWTVerifyGetKey): Promise<string | null> {
  return (await verifyAccessIdentity(request, env, getKey))?.email ?? null;
}

/**
 * The member row for a verified email, or null. Default-deny: no row, no entry. A row whose role the code does not
 * know is no entry either, such as a family row written before migration 0010 retired that role.
 */
export async function findMember(db: D1Database, email: string): Promise<Member | null> {
  const row = await db
    .prepare('SELECT email, role, name FROM members WHERE email = ?1')
    .bind(email)
    .first<{ email: string; role: string; name: string | null }>();
  return row && isRole(row.role) ? { email: row.email, role: row.role, name: row.name } : null;
}

/**
 * Everything a member can try to do in the room. Route modules check one of these before acting.
 * `flag` marks Key; `readComments` sees threads and the feed; `connect` links an AI tool (legallas-mcp);
 * `viewPrivileged` reaches documents under a privileged folder (worker/privilege.ts applies it everywhere).
 * `propose` lets the member's own connected AI propose a draft as them; `approve` lets them approve, edit and approve, or
 * reject what their own AI proposed (worker/proposal-review.ts). Both matter only while PROPOSALS_ENABLED is "1".
 * `viewActivity` also shows the owner every member's proposals, which only their own member decides.
 * `setCompany` changes the company's entity type, formation date and report month on /checklist/ (worker/company-settings.ts).
 */
export type Action =
  | 'view'
  | 'viewPrivileged'
  | 'download'
  | 'readComments'
  | 'comment'
  | 'resolve'
  | 'upload'
  | 'ask'
  | 'flag'
  | 'connect'
  | 'viewActivity'
  | 'propose'
  | 'approve'
  | 'setCompany';

/**
 * Who may do what, and the only roles there are. Counsel can do everything except read the owner's activity log, which
 * includes seeing other members' proposals, and change the company's own facts, which are the owner's to say. Each member decides the proposals their own AI made
 * (docs/design/propose-and-approve.md); sending, filing and sharing will take the owner when those kinds exist.
 * The read-only family role was retired on 2026-10-20 (migration 0010): like any role not listed here, it is allowed
 * nothing (canPerform) and is no member at all (findMember).
 */
const PERMISSIONS: Readonly<Record<Role, Readonly<Record<Action, boolean>>>> = {
  owner: {
    view: true, viewPrivileged: true, download: true, readComments: true, comment: true, resolve: true,
    upload: true, ask: true, flag: true, connect: true, viewActivity: true, propose: true, approve: true, setCompany: true,
  },
  counsel: {
    view: true, viewPrivileged: true, download: true, readComments: true, comment: true, resolve: true,
    upload: true, ask: true, flag: true, connect: true, viewActivity: false, propose: true, approve: true, setCompany: false,
  },
};

/** Whether `value` is a role listed in PERMISSIONS. Own keys only, so a prototype name such as "constructor" is not. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.hasOwn(PERMISSIONS, value);
}

/**
 * The role a room guest's connected AI reads with: a grant's role, and with `#<n>` one tool call's (privilege.ts
 * withGuestScope). Never a members row, so never in PERMISSIONS or isRole. It may only view, and privilege.ts
 * privilegeFilter cuts every document query to that call's rooms.
 */
export const ROOM_READER = 'room_reader' as Role;

/** Whether `role` is ROOM_READER, bare or one call's. */
export function isRoomReader(role: string): boolean {
  return role === ROOM_READER || role.startsWith(`${ROOM_READER}#`);
}

/**
 * The role matrix: may a member with `role` perform `action`? Fails closed: an unknown role or action
 * (including prototype names such as "constructor") is never allowed, because only own keys holding
 * exactly `true` count.
 */
export function canPerform(role: Role, action: Action): boolean {
  if (isRoomReader(role)) return action === 'view';
  if (!isRole(role)) return false;
  const actions = PERMISSIONS[role];
  return Object.hasOwn(actions, action) && actions[action] === true;
}
