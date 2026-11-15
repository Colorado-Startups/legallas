// SPDX-License-Identifier: Apache-2.0
// The four things the scan attacks: each Worker of the fictional room, as a member and as a stranger. Each is its own
// `wrangler dev --local` server inside the CI job, on 127.0.0.1, told by `--local-upstream` which host it stands for:
// wrangler sets the URL the Worker sees from that, whatever Host header arrives (workers-sdk start-dev.ts and
// LocalRuntimeController.ts getUserWorkerInnerUrlOverrides, read 2026-11-06). The room and legallas-mcp honour the dev
// identity only on localhost (web/worker/auth.ts LOCAL_HOSTS), so the `localhost` servers answer as the room's owner and
// the STRANGER_HOST servers as nobody, with the dev identity still switched on. run.ts proves both before it scans.

/** Reserved for testing by RFC 2606, so it can never name a real host. Mapped to 127.0.0.1 inside the scanner's container. */
export const STRANGER_HOST = 'anon.test';
/** The lab's ports (quality-speed/pages/data-room/lab/room.ts); run.ts checks they still agree. */
export const ROOM_PORT = 8789;
export const MCP_PORT = 8790;

export type TargetName = 'room-member' | 'room-stranger' | 'mcp-member' | 'mcp-stranger';

export interface Target {
  /** The ZAP context's name, and the key findings and triage use. */
  name: TargetName;
  surface: 'room' | 'mcp';
  audience: 'member' | 'stranger';
  host: 'localhost' | typeof STRANGER_HOST;
  port: number;
  /** Where ZAP's spider starts: a page this target answers with 200. */
  spiderPath: string;
  /** Scheme, host and port, no trailing slash. */
  origin: string;
  /** For the report. */
  label: string;
  /** The active scan's limit for this target, in minutes. */
  activeMinutes: number;
}

const target = (name: TargetName, surface: Target['surface'], audience: Target['audience'], port: number, label: string, activeMinutes: number): Target => {
  const host = audience === 'member' ? 'localhost' : STRANGER_HOST;
  // A stranger's room answers only the front door's public pages; legallas-mcp's root is a 404 page.
  const spiderPath = surface === 'mcp' ? '/connect' : audience === 'stranger' ? '/welcome/' : '/';
  return { name, surface, audience, host, port, spiderPath, origin: `http://${host}:${port}`, label, activeMinutes };
};

export const TARGETS: readonly Target[] = [
  target('room-member', 'room', 'member', ROOM_PORT, 'Room, signed in as its owner', 15),
  target('room-stranger', 'room', 'stranger', 8791, 'Room, as a stranger', 3),
  target('mcp-member', 'mcp', 'member', MCP_PORT, 'MCP server, with a member\'s AI token', 12),
  target('mcp-stranger', 'mcp', 'stranger', 8792, 'MCP server, as a stranger', 3),
];

export const targetNamed = (name: TargetName): Target => TARGETS.find((t) => t.name === name)!; // safe: every TargetName is in TARGETS

/**
 * The target a ZAP site (scheme://host:port) belongs to, or null for any other site, which the scan never targets. By
 * host and port: ZAP's HTTP Only Site rule tries https on the same server, which is still the job's own.
 */
export function targetOfSite(site: string): Target | null {
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    return null;
  }
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return TARGETS.find((t) => t.host === url.hostname && String(t.port) === port) ?? null;
}

/** Where the stranger servers keep their state: empty and migrated, so nothing a stranger does touches the seeded room. */
export const strangerState = (room: string): string => `${room}/stranger-state`;

/** The `npx` arguments for one target's `wrangler dev` server, run in web/. */
export function serverArgs(target: Target, room: string): string[] {
  const inspector = 9229 + TARGETS.indexOf(target);
  const args = ['wrangler', 'dev'];
  if (target.surface === 'mcp') args.push('-c', 'wrangler.mcp.jsonc');
  args.push('--local', '--ip', '127.0.0.1', '--port', String(target.port), '--inspector-port', String(inspector));
  // The URL the Worker sees, whose host decides whether the dev identity applies.
  args.push('--local-upstream', `${target.host}:${target.port}`, '--show-interactive-dev-session=false');
  if (target.audience === 'stranger') {
    // Its own name, so the dev registry keeps the member servers as legallas-mcp and legallas-web.
    args.push('--name', target.surface === 'mcp' ? 'legallas-mcp-stranger' : 'legallas-web-stranger', '--persist-to', strangerState(room));
  }
  return args;
}
