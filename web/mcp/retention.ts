// SPDX-License-Identifier: Apache-2.0
// The room's zero-retention bar (docs/design/ai-connectors.md, Decision 2; docs/legal/product-notices.md, A7).
//
// | AI_POLICY | App (clientKindOf) | Connect and tool calls |
// |---|---|---|
// | unset, anything but "zdr" | any | As today |
// | "zdr" | claude.ai or claude.com (every Claude consumer plan), Microsoft | Refused: never zero-retention |
// | "zdr" | Harvey, a desktop app, unknown | Refused until the owner lists its client id in AI_ZDR_CLIENTS |
//
// An AI_ZDR_CLIENTS entry is `client-id` (every member on that client) or `member@example.com client-id` (that member
// only). A desktop or unknown app signing in with an https Client ID Metadata Document URL shares one client id across
// every install, so the owner's check of one member's setup says nothing of another's: only a member entry confirms it.
//
// Checked at /authorize, so no grant is made, and on every tool call, so a grant made before the setting fails at once.
import type { ClientKind, McpEnv } from './contract.ts';

export type RetentionEnv = Pick<McpEnv, 'AI_POLICY' | 'AI_ZDR_CLIENTS'>;

/** The two app kinds whose every plan keeps chats: they can never meet the bar. */
const NEVER_ZERO: ReadonlySet<ClientKind> = new Set(['claude', 'microsoft']);

/** True when `kind` can never meet the zero-retention bar. */
export function neverZeroRetention(kind: ClientKind): boolean {
  return NEVER_ZERO.has(kind);
}

export function zeroRetentionOnly(env: RetentionEnv): boolean {
  return env.AI_POLICY === 'zdr';
}

/** True when the owner confirmed `clientId` for `email` (see the file comment). */
function confirmedFor(env: RetentionEnv, kind: ClientKind, clientId: string, email: string): boolean {
  if (clientId === '') return false;
  const sharedDesktop = kind === 'unknown' && clientId.startsWith('https://');
  for (const entry of (env.AI_ZDR_CLIENTS ?? '').split(',')) {
    const parts = entry.trim().split(/\s+/);
    if (parts.length === 1 && parts[0] === clientId && !sharedDesktop) return true;
    if (parts.length === 2 && parts[1] === clientId && parts[0]!.toLowerCase() === email.trim().toLowerCase() && email.trim() !== '') return true;
  }
  return false;
}

/** Why this app may not connect to this room for this member or guest, or null when it may. */
export function retentionRefusal(env: RetentionEnv, kind: ClientKind, clientId: string, email: string): string | null {
  if (!zeroRetentionOnly(env)) return null;
  if (neverZeroRetention(kind)) return 'This plan can\'t be zero-retention, and this room is set to "zero retention only", so it refuses it.';
  if (confirmedFor(env, kind, clientId, email)) return null;
  return 'This room is set to "zero retention only", and the room owner hasn\'t confirmed this app keeps nothing. Ask the room owner.';
}
