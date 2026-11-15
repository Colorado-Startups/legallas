// SPDX-License-Identifier: Apache-2.0
// The Copilot agent package (ZIP) downloads, both built by the CLI's own code (connect/copilot/package.ts, from the
// bundled copy of appPackage/) with the same validation:
// - GET /connect/legallas-agent.zip: the shared agent, with the owner's one Teams Developer Portal registration ID
//   ("Any Microsoft 365 organization") from COPILOT_REFERENCE_ID. Firm IT uploads it as it is.
// - POST /connect/copilot-package: a firm's own agent, from the registration ID its IT pastes into /connect.
// A registration ID is not secret, but it is never logged: logs carry codes only. Nothing else from env reaches
// the ZIP but the room's kind, so it never holds a secret (copilot-package.test.ts proves both). In a company room
// both are in its words, as /connect is (mcp/index.ts): the agent the page names is the one IT uploads.
import { PACKAGE_FILE_NAME, buildPackage, bundledPackage } from '../connect/copilot/package.ts';
import { REFERENCE_ID_PATTERN } from '../connect/copilot/validate.ts';
import { messagePage } from './authorize.ts';
import { CONNECT_PATH, MCP_ORIGIN, type McpEnv } from './contract.ts';
import { RETRY_AFTER_SECONDS } from './gates.ts';
import { AGENT_ZIP_NAME, AGENT_ZIP_PATH, REFERENCE_ID_FIELD } from './pages/connect-copilot.ts';
import { roomWords } from './room-words.ts';
import { instanceName, ownerFullName } from '../worker/room-settings.ts';
import { isCompanyRoom } from '../worker/room-shape.ts';

/** The form field /connect posts. */
export { REFERENCE_ID_FIELD };
/** A registration ID is at most 256 characters; a body far past that is not a paste of one. */
export const MAX_FORM_BYTES = 2048;
const FORM_TYPE = 'application/x-www-form-urlencoded';

/** Where the registration ID comes from, in the words of the setup page. */
export const REFERENCE_ID_HELP =
  'Paste the registration ID from the Teams Developer Portal: Tools > OAuth client registration, open the ' +
  `${instanceName} registration and copy its registration ID (no spaces or quotes). Then go back to the setup page ` +
  'and choose Download again.';

type ReadResult = { referenceId: string } | { refused: 'bad_type' | 'too_large' | 'bad_id' };

/** The trimmed reference_id from a form post, or why it was refused. */
async function readReferenceId(request: Request): Promise<ReadResult> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(); // safe: split returns at least one item
  if (type !== FORM_TYPE) return { refused: 'bad_type' };
  if (Number(request.headers.get('content-length') ?? '0') > MAX_FORM_BYTES) return { refused: 'too_large' };
  const body = await request.text();
  if (body.length > MAX_FORM_BYTES) return { refused: 'too_large' };
  const referenceId = (new URLSearchParams(body).get(REFERENCE_ID_FIELD) ?? '').trim();
  return REFERENCE_ID_PATTERN.test(referenceId) ? { referenceId } : { refused: 'bad_id' };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The bundled package in the room's words: in a company room every JSON file says "company room", the agent's name too. */
export function roomPackage(company: boolean): Map<string, Uint8Array> {
  const files = bundledPackage();
  if (!company) return files;
  for (const [name, bytes] of files) if (name.endsWith('.json')) files.set(name, encoder.encode(roomWords(decoder.decode(bytes), true)));
  return files;
}

function refuse(code: string): Response {
  console.warn('copilot_package_refused', code);
  return messagePage(400, 'Check the registration ID', REFERENCE_ID_HELP);
}

/** Public; PACKAGE_LIMIT in mcp/index.ts rate limits it. The package holds nothing secret. */
export async function copilotPackage(request: Request, env: McpEnv): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const read = await readReferenceId(request);
  if ('refused' in read) return refuse(read.refused);
  let zip: Uint8Array;
  try {
    zip = buildPackage(roomPackage(await isCompanyRoom(env)), read.referenceId);
  } catch {
    // The bundled package validates in npm test, so only the ID can fail here (a ${{ placeholder, say).
    return refuse('invalid_package');
  }
  console.log('copilot_package_built');
  return zipResponse(zip, PACKAGE_FILE_NAME);
}

function zipResponse(zip: Uint8Array | null, fileName: string): Response {
  return new Response(zip, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** The shared registration ID, trimmed, when it is set and looks like one (not a leftover placeholder); else null. */
function sharedReferenceId(env: Pick<McpEnv, 'COPILOT_REFERENCE_ID'>): string | null {
  const id = (env.COPILOT_REFERENCE_ID ?? '').trim();
  return REFERENCE_ID_PATTERN.test(id) && !id.includes('${{') ? id : null;
}

/** True when /connect offers the shared download instead of the per-firm form. */
export function agentConfigured(env: Pick<McpEnv, 'COPILOT_REFERENCE_ID'>): boolean {
  return sharedReferenceId(env) !== null;
}

/** What the download says while the shared registration is not set up (or its ID does not build). */
export const AGENT_NOT_OFFERED =
  `The ready-made ${instanceName} agent is not offered yet. Your IT team can build your firm's own from the Microsoft ` +
  `Copilot steps at ${MCP_ORIGIN}${CONNECT_PATH}#copilot-it, or ask ${ownerFullName}.`;

function notOffered(code: 'copilot_agent_unset' | 'copilot_agent_bad_config'): Response {
  if (code === 'copilot_agent_unset') console.warn(code);
  else console.error(code);
  return messagePage(404, 'Not offered yet', AGENT_NOT_OFFERED);
}

/**
 * PACKAGE_LIMIT, per client IP, as mcp/gates.ts applies it to the POST (which it limits before routing). Fails open
 * when the binding is missing or throws, like the gate. A browser follows this link, so the 429 is a page.
 */
async function overLimit(request: Request, env: Pick<McpEnv, 'PACKAGE_LIMIT'>): Promise<Response | null> {
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    if ((await env.PACKAGE_LIMIT.limit({ key })).success) return null;
  } catch {
    console.error('mcp_ratelimit_error', AGENT_ZIP_PATH);
    return null;
  }
  console.warn('mcp_rate_limited', AGENT_ZIP_PATH);
  const response = messagePage(429, 'Too many downloads', `Wait a minute, then download the ${instanceName} agent again.`);
  response.headers.set('retry-after', String(RETRY_AFTER_SECONDS));
  return response;
}

/** GET or HEAD /connect/legallas-agent.zip. Public, rate limited; a clear 404 page while the ID is unset. */
export async function legallasAgent(request: Request, env: McpEnv): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const limited = await overLimit(request, env);
  if (limited) return limited;
  const referenceId = sharedReferenceId(env);
  if (referenceId === null) return notOffered(env.COPILOT_REFERENCE_ID?.trim() ? 'copilot_agent_bad_config' : 'copilot_agent_unset');
  let zip: Uint8Array;
  try {
    zip = buildPackage(roomPackage(await isCompanyRoom(env)), referenceId);
  } catch {
    return notOffered('copilot_agent_bad_config');
  }
  console.log('copilot_agent_built');
  return zipResponse(request.method === 'HEAD' ? null : zip, AGENT_ZIP_NAME);
}
