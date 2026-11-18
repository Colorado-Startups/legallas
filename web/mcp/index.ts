// SPDX-License-Identifier: Apache-2.0
// The legallas-mcp Worker: the core server, and a core-only server's entry. A room with pro enters through
// mcp/entry-pro.ts, which adds pro's tools and pages first. The only file that loads the OAuth library and `cloudflare:workers` as values; tests never import it and
// drive mcp/oauth.ts, mcp/sweep.ts with fakes instead.
import { isCompanyRoom } from '../worker/room-shape.ts';
import { roomWords } from './room-words.ts';
import { OAuthProvider, getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { env, waitUntil, WorkerEntrypoint } from 'cloudflare:workers';
import type { McpEnv } from './contract.ts';
import { originGate, rateLimitGate } from './gates.ts';
import { withNosniff } from './headers.ts';
import { liveAi, type AiStatus } from './member-grants.ts';
import { oauthOptions, rootResourceMetadataRequest } from './oauth.ts';
import { prepareOAuthRequest, reportOAuthFailure } from './oauth-request.ts';
import { usePageNames } from './pages/html.ts';
import { loadAllowedRedirects, mergeRedirectAllow, recordRefusedRedirect } from './redirects.ts';
import { withRevocationAudit } from './revoke-audit.ts';
import { recordSignInFailure } from './signin-failure.ts';
import { sweepSmokeClients } from './smoke-clients.ts';
import { sweepOrphanGrants } from './sweep.ts';
import { sweepLapsedChecks } from '../worker/public-records.ts';
import { sweepRetention } from '../worker/data-retention.ts';

const mcpEnv = env as unknown as McpEnv;
// Every page's frame names the room by INSTANCE_NAME (worker/room-names.ts), the same for the whole deployment.
usePageNames(mcpEnv);
/** Paths whose handlers check redirect URIs against the allowlist; /mcp traffic skips the KV read. */
const REDIRECT_PATHS = new Set(['/register', '/authorize', '/admin/clients']);
/**
 * The OAuth options with `redirectAllow` for the registration callback, which the library calls without env. On
 * REDIRECT_PATHS each request builds its own provider around the list it loaded (the callbacks the owner allowed on
 * /admin/clients), so no request's list sits in module scope. Everywhere else: the configured list alone.
 */
function optionsWith(redirectAllow: string | undefined) {
  return oauthOptions({
    redirectAllow: () => redirectAllow,
    onRefusedRedirect: (uri) => waitUntil(recordRefusedRedirect(mcpEnv, uri)),
    onSignInFailure: (failure) => waitUntil(recordSignInFailure(mcpEnv, failure)),
    waitUntil: (promise) => waitUntil(promise),
    dcrEnabled: () => mcpEnv.DCR_ENABLED,
    devOrigin: mcpEnv.MCP_DEV_ORIGIN,
  });
}
const options = optionsWith(mcpEnv.MCP_REDIRECT_ALLOW);
const provider = new OAuthProvider<McpEnv>(options);

/**
 * legallas-web's MCP_GRANTS service binding (its wrangler.jsonc): one member's live AI connection for the room's
 * Overview panel, only { connected, via, at } (mcp/member-grants.ts). A named entrypoint with no fetch handler, so
 * only a service binding reaches it, never the internet. It answers for any email it is given and checks no role:
 * the caller decides who may ask (legallas-web's GET /api/me/ai asks only for the signed-in member, and only when
 * their role may connect). The library injects OAUTH_PROVIDER only on fetch, so this builds its helpers, as
 * scheduled() does.
 */
export class MemberGrants extends WorkerEntrypoint<McpEnv> {
  async live(email: string): Promise<AiStatus> {
    return liveAi(getOAuthApi(options, this.env), email);
  }
}

/** A page of a room with no published matter says "company room", not "counsel room" (card 12.1). Anything but HTML passes. */
async function shapedPages(response: Response, env: McpEnv): Promise<Response> {
  if (!(response.headers.get('Content-Type') ?? '').includes('text/html') || !(await isCompanyRoom(env))) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(roomWords(await response.text(), true), { status: response.status, statusText: response.statusText, headers });
}

export default {
  /**
   * Rate limits and the /mcp Origin gate first (mcp/gates.ts), the root RFC 9728 path aliased to the /mcp document
   * (mcp/oauth.ts), /token's scope narrowed (mcp/oauth-request.ts), then the library, auditing RFC 7009
   * revocations. A failed /token or /register answer is reported to the owner (mcp/signin-failure.ts).
   */
  async fetch(request: Request, workerEnv: McpEnv, ctx: ExecutionContext): Promise<Response> {
    const refused = (await rateLimitGate(request, workerEnv)) ?? originGate(request, workerEnv);
    if (refused) return withNosniff(refused);
    request = rootResourceMetadataRequest(request) ?? request;
    let oauth = provider;
    if (REDIRECT_PATHS.has(new URL(request.url).pathname)) {
      // /authorize re-checks the redirect against env.MCP_REDIRECT_ALLOW, so the merged list goes into env too.
      const allow = mergeRedirectAllow(workerEnv.MCP_REDIRECT_ALLOW, await loadAllowedRedirects(workerEnv));
      workerEnv = { ...workerEnv, MCP_REDIRECT_ALLOW: allow };
      oauth = new OAuthProvider<McpEnv>(optionsWith(allow));
    }
    const prepared = await prepareOAuthRequest(request);
    const response = await withRevocationAudit(prepared.request, workerEnv, (forwarded) => oauth.fetch(forwarded, workerEnv, ctx));
    if (prepared.source) ctx.waitUntil(reportOAuthFailure(workerEnv, prepared.source, response));
    return withNosniff(await shapedPages(response, workerEnv));
  },
  /**
   * The daily cron (wrangler.mcp.jsonc): the orphan-grant sweep, then the production smoke's old clients, then lapsed
   * public-records requests, then the room's retention schedule (worker/data-retention.ts; each logs its own counts; a
   * failure of one never stops the next). The library injects OAUTH_PROVIDER only on fetch, so pass its helpers.
   * Awaited, not handed to ctx.waitUntil: the runtime waits up to 15 minutes for the handler's own promise, but only
   * 30 seconds for waitUntil work once the handler returns (Cloudflare docs, Scheduled Handler and Limits).
   */
  async scheduled(_controller: ScheduledController, workerEnv: McpEnv): Promise<void> {
    const sweepEnv = { ...workerEnv, OAUTH_PROVIDER: getOAuthApi(options, workerEnv) };
    const failed = (event: string) => (error: unknown) => console.error(JSON.stringify({ event, code: error instanceof Error ? error.name : 'unknown' }));
    await sweepOrphanGrants(sweepEnv)
      .then((result) => console.log(JSON.stringify({ event: 'mcp.sweep', ...result })), failed('mcp.sweep_failed'))
      .then(() => sweepSmokeClients(sweepEnv))
      .catch(failed('mcp.smoke_sweep_failed'))
      // Lapsed public-records requests (worker/public-records.ts), whose names must not stay in the room.
      .then(() => sweepLapsedChecks(workerEnv.DB, new Date()))
      .then((deleted) => console.log(JSON.stringify({ event: 'mcp.records_sweep', deleted })), failed('mcp.records_sweep_failed'))
      // Off unless the room sets RETAIN_SIGNINS_DAYS or RETAIN_AUDIT_DAYS_AFTER_CLOSE; a legal hold stops it.
      .then(() => sweepRetention(workerEnv, new Date()))
      .catch(failed('mcp.retention_failed'));
  },
} satisfies ExportedHandler<McpEnv>;
