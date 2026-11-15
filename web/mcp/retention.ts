// SPDX-License-Identifier: Apache-2.0
// The room's zero-retention bar (docs/design/ai-connectors.md, Decision 2; docs/legal/product-notices.md, A7).
//
// | AI_POLICY | App (clientKindOf) | Connect and tool calls |
// |---|---|---|
// | unset, anything but "zdr" | any | As today |
// | "zdr" | claude.ai or claude.com (every Claude consumer plan), Microsoft | Refused: never zero-retention |
// | "zdr" | Harvey, a desktop app, unknown | Refused until the owner lists its client id in AI_ZDR_CLIENTS |
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

/** Why this app may not connect to this room, or null when it may. */
export function retentionRefusal(env: RetentionEnv, kind: ClientKind, clientId: string): string | null {
  if (!zeroRetentionOnly(env)) return null;
  if (neverZeroRetention(kind)) return 'This plan can\'t be zero-retention, and this room is set to "zero retention only", so it refuses it.';
  const confirmed = (env.AI_ZDR_CLIENTS ?? '').split(',').map((id) => id.trim());
  if (confirmed.includes(clientId) && clientId !== '') return null;
  return 'This room is set to "zero retention only", and the room owner hasn\'t confirmed this app keeps nothing. Ask the room owner.';
}
