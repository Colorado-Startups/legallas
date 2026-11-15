// SPDX-License-Identifier: Apache-2.0
// The invitation: one link, straight to "Connect your AI" (legallas-mcp's public /connect, mcp/pages/connect.ts), set
// for the invitee's role. People use the room through their own AI, so the AI comes first and browsing second.
//
// | Role (where it is set) | Reader | Link |
// |---|---|---|
// | owner (npm run member -- add) | founder | /connect?for=founder |
// | counsel (npm run member -- add) | counsel | /connect?for=counsel |
// | investor (npm run room -- invite) | investor | /connect?for=investor |
// | a matter room's counsel (room matter invite) | none yet | the room only: that role may not connect an AI |
//
// scripts/member.ts and scripts/room.ts print inviteMessage; the guest page (routes/rooms.ts) links connectLink.
import { instanceName, mcpHost, roomHost } from './room-settings.ts';

/** Who reads the connect panel: it orders the AIs for them (mcp/pages/connect.ts PANEL_ORDER). */
export const READERS = ['founder', 'counsel', 'investor'] as const;
export type Reader = (typeof READERS)[number];
/** The AIs each reader's panel offers, in its order (mcp/pages/connect.ts PANEL_ORDER; connect-panel.test.ts checks). */
export const READER_AIS: Readonly<Record<Reader, readonly string[]>> = {
  founder: ['Claude', 'Microsoft 365 Copilot', 'OpenCode'],
  counsel: ['Claude', 'Microsoft 365 Copilot', 'Harvey', 'OpenCode'],
  investor: ['Claude', 'Microsoft 365 Copilot', 'OpenCode'],
};

/** The reader's AIs as a sentence: "Claude, Microsoft 365 Copilot or OpenCode". */
export function aiList(reader: Reader): string {
  const names = READER_AIS[reader];
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** The query parameter that names the reader. */
export const READER_PARAM = 'for';
/** A link with no reader, or one we do not know, reads as counsel: every AI is shown. */
export const DEFAULT_READER: Reader = 'counsel';

/** The reader a /connect address names, or the default. */
export function readerOf(url: URL): Reader {
  const named = url.searchParams.get(READER_PARAM);
  return (READERS as readonly string[]).includes(named ?? '') ? (named as Reader) : DEFAULT_READER;
}

/** A member's or guest's role as a reader: the owner is the founder. */
export function readerOfRole(role: 'owner' | 'counsel' | 'investor'): Reader {
  return role === 'owner' ? 'founder' : role;
}

/** The one link an invitation carries: the connect panel for this reader, on legallas-mcp. */
export function connectLink(reader: Reader, host: string = mcpHost): string {
  return `https://${host}/connect?${READER_PARAM}=${reader}`;
}

/**
 * Whether a guest role may connect an AI, as worker/rooms.ts GUEST_ACTIONS says (invite.test.ts checks): the scripts
 * cannot import rooms.ts, which needs the Worker's types.
 */
export const GUEST_CONNECTS: Readonly<Record<'investor' | 'counsel', boolean>> = { investor: true, counsel: false };

/**
 * The message the owner sends with an invitation: the connect link first, the room second, then any notice. Someone
 * whose role may not connect an AI (a matter room's counsel, for now) gets the room link alone.
 */
export function inviteMessage(reader: Reader, email: string, options: { notice?: string; connect?: boolean } = {}): string {
  const room = `https://${roomHost}/`;
  const body =
    options.connect === false
      ? [`You're invited to the ${instanceName} room: ${room}`, `Sign in with ${email}.`]
      : [
          `You're invited to the ${instanceName} room.`,
          '',
          `Connect your AI first (${aiList(reader)}): ${connectLink(reader)}`,
          `Sign in with ${email} when it asks. To browse instead: ${room}`,
        ];
  return [...body, ...(options.notice ? ['', options.notice] : [])].join('\n');
}
