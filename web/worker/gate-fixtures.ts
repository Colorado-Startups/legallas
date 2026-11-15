// SPDX-License-Identifier: Apache-2.0
// Tests only. pastTheGate runs the room route for a request as room.ts does once the gate has let `member` in,
// without the gate itself: the gate refuses any role the code does not know (auth.ts findMember), so this is how a
// test reaches a route's own canPerform wall, which must hold on its own. leftoverFamilySql writes a members row with
// the retired family role, which migration 0010's triggers now refuse, as only a row written before 0010 could be.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { canPerform, type Action } from './auth.ts';
import type { Env, Member, Role } from './env.ts';
import { roomRoutes } from './room.ts';
import { matchRoute } from './router.ts';
import { sqlLiteral } from './sql.ts';

/**
 * A role that may not do `action`, for a test that calls a query directly to prove its own wall holds. It is the retired
 * family role, which the gate refuses first; it throws if that role can ever do the action, so the test can't pass vacuously.
 */
export function roleWithout(action: Action): Role {
  const role = 'family' as Role;
  if (canPerform(role, action)) throw new Error(`the retired family role can now ${action}; pick another role for this test`);
  return role;
}

export async function pastTheGate(request: Request, env: Env, member: Member, ctx = {} as ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const match = matchRoute(roomRoutes(env), request.method, url.pathname);
  if (match.kind !== 'found') throw new Error(`no room route for ${request.method} ${url.pathname}`);
  return match.route.handler({ request, env, ctx, url, member, params: match.params });
}

const NO_FAMILY = readFileSync(join(import.meta.dirname, '..', 'migrations', '0010_members_no_family.sql'), 'utf8');
const INSERT_TRIGGER = /CREATE TRIGGER members_no_family_insert[\s\S]*?\nEND;/.exec(NO_FAMILY)?.[0];

/** The statements, one each, that step back before 0010's insert trigger, write the family row, then restore it. */
export function leftoverFamilySql(email: string, name: string | null = null): string[] {
  if (!INSERT_TRIGGER) throw new Error('0010_members_no_family.sql no longer defines members_no_family_insert');
  return [
    'DROP TRIGGER members_no_family_insert',
    `INSERT INTO members (email, role, name) VALUES (${sqlLiteral(email)}, 'family', ${sqlLiteral(name)})`,
    INSERT_TRIGGER,
  ];
}

/** leftoverFamilySql on real SQLite. */
export function addLeftoverFamily(sqlite: DatabaseSync, email: string, name: string | null = null): void {
  for (const statement of leftoverFamilySql(email, name)) sqlite.exec(statement);
}
