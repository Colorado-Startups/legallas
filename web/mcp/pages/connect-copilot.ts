// SPDX-License-Identifier: Apache-2.0
// The Copilot IT steps on /connect: the IT checklist, the Legallas agent (tested live in Outlook, Teams and Word on
// 2026-10-21), the connector as the alternative (tested live in Copilot Chat the same day), and the "If something goes
// wrong" table, kept as data so the page and the setup guide (web/connect/copilot.md) carry the same text;
// connect-copilot.test.ts checks both. Every Microsoft
// message below is quoted from Microsoft Learn, and every admin center or Developer Portal label from Microsoft's
// screens as seen live (sources in copilot.md, 2026-10-20 and 2026-10-21); the rest are this server's own messages
// (mcp/authorize.ts, mcp/server.ts) and Cloudflare Access's sign-in page.
import { COPILOT_PACKAGE_PATH, MCP_HOST, MCP_ORIGIN, MCP_RESOURCE, ROOM_ORIGIN, SCOPE_READ } from '../contract.ts';
import { CONTACT, escapeHtml } from './html.ts';
import { CODE_SENDER, SIGN_IN_CODE_ID } from './sign-in-code.ts';
import { accessHost, instanceName, ownerName } from '../../worker/room-settings.ts';
import { STORED_NAME } from '../../worker/stored-name.ts';

/** GET: the shared Legallas agent, built with COPILOT_REFERENCE_ID (mcp/copilot-package.ts). Its file name too. */
export const AGENT_ZIP_NAME = `${STORED_NAME}-agent.zip`;
export const AGENT_ZIP_PATH = `/connect/${AGENT_ZIP_NAME}`;
/** The form field the per-firm package route (POST COPILOT_PACKAGE_PATH) reads. */
export const REFERENCE_ID_FIELD = 'reference_id';

/** Cloudflare Access's team domain: the email-code page the sign-in passes through. */
export const ACCESS_HOST = accessHost;
/** The hosts a member's browser must reach over HTTPS: sign-in and consent, the email-code page, the room links. */
export const ALLOW_HOSTS: readonly string[] = [MCP_HOST, new URL(ROOM_ORIGIN).hostname, ACCESS_HOST];
/** The custom connector pattern IT adds to a tenant data policy (Microsoft's examples end the host with `*`). */
export const DLP_PATTERN = `https://${MCP_HOST}*`;

/** Agents > Settings > Agent and plugin access: the box that covers an uploaded agent, as the admin center labels it. */
export const ORG_AGENTS_SETTING = 'Allow apps, agents, and plugins built by your organization';
/** Developer Portal > Restrict usage by Teams app: the choice every Legallas registration needs (not the default). */
export const ANY_TEAMS_APP = 'Any Teams app (for testing and store validation only)';

/** One row of the table: what IT or a member sees (exact text where there is one), and what fixes it. */
export interface TroubleRow {
  see: string;
  fix: string;
}

/**
 * Microsoft's messages first (publishing, then using), then the firm-side sign-in problems, then the server's own
 * tool errors. The sign-in page's own messages (no code, an expired page, no access) are in "If something goes
 * wrong" at the end of /connect (connect-help.ts), which this table links rather than repeats.
 */
export const COPILOT_TROUBLE: readonly TroubleRow[] = [
  {
    see: 'The Model Context Protocol tool is greyed out, or "1 error is preventing your agent from being published."',
    fix: 'A data policy blocks it: checklist step 3. Then publish again.',
  },
  {
    see: '"At least one connector here has been blocked by your admin"',
    fix: 'The same block: checklist step 3.',
  },
  {
    see: '"Sorry, something unexpected happened. We\'re looking into it. Error code: DataLossPreventionViolation."',
    fix: 'Its connectors sit in different data policy groups: checklist step 3.',
  },
  {
    see: '"Couldn\'t load MCP tools. The MCP server rejected the request (HTTP 400)"',
    fix: `Reported after Dynamic discovery. Create the connection again; if it repeats, tell ${ownerName} the time.`,
  },
  {
    see: '"Unauthorized." (HTTP401Unauthorized) or InvalidAuthenticationToken',
    fix: 'The connection ended (30 days, Disconnect or removal). Connect again and sign in.',
  },
  {
    see: '"This tool call timed out. The operation took too long to complete."',
    fix: `Ask a narrower question; tell ${ownerName} if it repeats.`,
  },
  {
    see: `A new ${instanceName} tool does not appear in the agent`,
    fix: 'Allow all is off: turn the tool on in the MCP tool\'s settings, then publish.',
  },
  {
    see: '"OAuth authentication failed: The base URL in your authentication configuration does not match the server URL. (HTTP 401)"',
    fix: `Set the registration\'s Base URL to exactly ${MCP_RESOURCE}.`,
  },
  {
    see: '"OAuth authentication failed: No matching configuration found for referenceID in \'runtime.auth\' section of the action manifest"',
    fix: 'An old or wrong registration ID: download the agent again and upload it as a new version.',
  },
  {
    see: '"OAuth authentication failed: The App ID used in the request does not match the App ID in the authentication configuration. (HTTP 404)"',
    fix: 'Set Restrict usage by Teams app to Any Teams app.',
  },
  {
    see: '"OAuth authentication failed: Access is restricted by your organization\'s policy. (HTTP 404)"',
    fix: 'Check Restrict usage by organization, then checklist step 4.',
  },
  {
    see: 'The sign-in button does nothing, or "Request cannot be processed"',
    fix: 'Microsoft calls this temporary: ask again, or remove and re-add the agent.',
  },
  {
    see: `The agent answers that no ${instanceName} tools are available, and no Sign in button appears`,
    fix: 'No Copilot licence or pay-as-you-go covers the member: assign one, or add them to the firm\'s Copilot billing policy.',
  },
  {
    see: '"This plugin is blocked by your organization\'s policy."',
    fix: 'Checklist step 4.',
  },
  {
    see: 'The sign-in window does not open, or opens and never closes',
    fix: 'Allow pop-ups (checklist step 5). If it hangs, check that no proxy or extension rewrites the sign-in pages.',
  },
  {
    see: '"App not allowed: Only Harvey, Microsoft Copilot and Claude (claude.ai and the Claude apps) can connect to the counsel room." or a registration error naming invalid_redirect_uri',
    fix: `An unknown callback (a government cloud, say): ${ownerName} is alerted and fixes it the same day; then try again.`,
  },
  {
    see: '"Sign-in works only from the United States." for a member who is in the United States',
    fix: 'Route the three hosts through a US exit (checklist step 5).',
  },
  {
    see: '"daily_limit: The daily limit for AI tool calls is reached. It resets at midnight UTC."',
    fix: 'Wait for the reset.',
  },
  {
    see: '"rate_limited: Too many tool calls in one minute. Wait a minute, then try again."',
    fix: 'Wait a minute.',
  },
  {
    see: '"not_a_member: This connection no longer has access to the counsel room. Ask the room owner."',
    fix: `No longer a room member: ask ${ownerName}.`,
  },
];

const code = (value: string) => `<code class="cx-copy">${escapeHtml(value)}</code>`;

/** The checklist IT works through before adding the tool. Numbers match the table's "checklist step" references. */
export const COPILOT_CHECKLIST = `<h4>Before you start: the IT checklist</h4>
<ol class="cx-check">
<li><strong>Licences.</strong> The builder needs a Copilot Studio licence; a trial cannot publish, and the Teams plan has no MCP tools. Members need no Copilot Studio licence, but the ${instanceName} agent needs a Copilot licence or pay-as-you-go for each.</li>
<li><strong>Environment.</strong> One with Dataverse (Microsoft advises a non-default production one), generative orchestration allowed, and the tenant setting <strong>Publish Copilots with AI features</strong> on.</li>
<li><strong>Data policy.</strong> Power Platform admin center &gt; Security &gt; Data and privacy &gt; Data policy &gt; the environment's policy &gt; Edit Policy &gt; Custom connectors: add ${code(DLP_PATTERN)} as <strong>Business</strong>, above <code>*</code>. Keep <strong>Microsoft Teams + Microsoft 365 Channel in Copilot Studio</strong> in Business, and move the ${instanceName} connector to Business in any environment policy. Allow an hour, at most 24.</li>
<li><strong>Microsoft 365 admin center.</strong> Agents &gt; Settings: the members are in User access, and "${ORG_AGENTS_SETTING}" is ticked. Agents &gt; Tools &gt; Registry: nothing blocks the ${instanceName} MCP server. A Global or AI Administrator uploads the agent or adds the connector.</li>
<li><strong>Web filter.</strong> Let members' browsers reach ${ALLOW_HOSTS.map(code).join(', ')} over HTTPS from a US address, not marked unsanctioned in Defender for Cloud Apps, with pop-ups allowed for Copilot, Teams and the admin center.</li>
<li><strong>Email.</strong> Allowlist the sign-in code's sender, ${code(CODE_SENDER)}, and exempt it from link rewriting and scanning, which can use up the code. Details: <a href="#${SIGN_IN_CODE_ID}">If the sign-in code doesn't arrive</a>.</li>
<li><strong>Nothing else.</strong> No Entra app registration, no inbound firewall rule.</li>
</ol>`;

/** Text-node escaping (`&`, `<`, `>`): the cells hold no attributes, and quotes stay readable and short. */
export const cellText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The table. On a phone the rows stack, and the bold first cell reads as each row's label. */
export function troubleTable(rows: readonly TroubleRow[] = COPILOT_TROUBLE): string {
  const body = rows.map((row) => `<tr><td>${cellText(row.see)}</td><td>${cellText(row.fix)}</td></tr>`).join('\n');
  return `<h4 id="copilot-trouble">If something goes wrong in Copilot</h4>
<p>Sign-in page messages: <a href="#help">On the sign-in page</a>, below.</p>
<div class="table-wrap cx-trouble"><table>
<thead><tr><th scope="col">What you see</th><th scope="col">What to do</th></tr></thead>
<tbody>
${body}
</tbody></table></div>`;
}

/** IT's three steps with the shared download, the admin center wizard as copilot.md walks it (connect.ts counts them). */
export const SHARED_AGENT_STEPS: readonly string[] = [
  'Microsoft 365 admin center &gt; <strong>Agents</strong> &gt; <strong>All agents</strong> &gt; <strong>Add agent</strong>: choose the ZIP as downloaded, then <strong>Next</strong>.',
  "Pick the members' group under both <strong>Publish</strong> and <strong>Install</strong>, so it is preinstalled in their Copilot, then <strong>Next</strong>.",
  'Keep the defaults: <strong>Next</strong>, <strong>Next</strong>, then <strong>Publish</strong>.',
];

/** The shared download and IT's three steps: one file, nothing to register, nothing to ask the owner for. */
const SHARED_AGENT = `<h4 id="copilot-agent">The ${instanceName} agent for Microsoft 365</h4>
<p>One file your Microsoft 365 admin uploads; tested live on 2026-10-21 in Outlook, Teams and Word. Each needs a Microsoft 365 Copilot licence (or Copilot Business) or the firm's Copilot pay-as-you-go billing: with Copilot Chat alone the agent appears but cannot reach the room.</p>
<p class="cx-add"><a class="btn btn--primary" href="${AGENT_ZIP_PATH}">Download the ${instanceName} agent for Microsoft 365</a></p>
<p>Before you upload: in <strong>Agents</strong> &gt; <strong>Settings</strong>, "${ORG_AGENTS_SETTING}" is ticked and the members are in <strong>User access</strong>; checklist steps 5 and 6.</p>
<ol>
${SHARED_AGENT_STEPS.map((step) => `<li>${step}</li>`).join('\n')}
</ol>`;

/** Without the shared registration: the firm registers its own client in the Teams Developer Portal. */
const FIRM_AGENT = `<h4 id="copilot-agent">The ${instanceName} agent</h4>
<p>A ready-made package your Microsoft 365 admin uploads, with a Copilot licence (or pay-as-you-go) per member.</p>
<ol>
<li>Ask ${ownerName} for a client ID and secret (one email to <a href="mailto:${CONTACT}">${CONTACT}</a>).</li>
<li>In the Teams Developer Portal, go to Tools &gt; OAuth client registration and register:
<ul>
<li>Base URL: ${code(MCP_RESOURCE)}</li>
<li>Restrict usage by Teams app: <strong>${ANY_TEAMS_APP}</strong> (not the default)</li>
<li>Client ID and secret: the ones from ${ownerName}</li>
<li>Authorization endpoint: ${code(`${MCP_ORIGIN}/authorize`)}</li>
<li>Token endpoint and Refresh endpoint: ${code(`${MCP_ORIGIN}/token`)}</li>
<li>Scope: ${code(SCOPE_READ)}, and turn PKCE on (it starts off)</li>
</ul>
Copy the registration ID it shows.</li>
<li>Paste the registration ID here and download your firm's ${instanceName} agent (a ZIP file).<form method="post" action="${COPILOT_PACKAGE_PATH}">
<div class="field"><label for="reference-id">OAuth client registration ID (from the Teams Developer Portal)</label>
<input class="input" id="reference-id" name="${REFERENCE_ID_FIELD}" type="text" required maxlength="256" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
<div class="actions"><button class="btn btn--primary" type="submit">Download the ${instanceName} agent</button></div>
</form></li>
<li>Microsoft 365 admin center &gt; Agents &gt; All agents &gt; Add agent: upload the ZIP as downloaded, for the members' group. A new version: open the agent, Update in store.</li>
</ol>`;

/**
 * The Legallas agent block of the Copilot IT steps on /connect (connect.ts places it first). `configured`: the shared
 * registration ID is set (COPILOT_REFERENCE_ID), so IT downloads one ready-made file; otherwise the firm's own
 * registration and the ID form, as before.
 */
export function copilotPackageSection(configured: boolean): string {
  return configured ? SHARED_AGENT : FIRM_AGENT;
}

/**
 * The alternative: a federated connector (Copilot > Connectors > Connect to MCP server), tested live in Copilot Chat
 * in a test tenant. `referenceId`: the shared registration's (COPILOT_REFERENCE_ID), shown for IT to
 * copy with the full steps. Without it the firm needs its own registration first (the agent's steps 1 and 2), so the
 * page gives one paragraph and the setup guide the rest (the page stays under 40,000 bytes either way).
 */
export function copilotConnectorSection(referenceId: string | null): string {
  const heading = '<h4 id="copilot-connector">Alternative, if your firm prefers a connector</h4>';
  if (!referenceId) {
    return `${heading}
<p>A data source each member turns on in Copilot Chat (a Copilot licence each): admin center &gt; <strong>Copilot</strong> &gt; <strong>Connectors</strong> &gt; <strong>Connect to MCP server</strong>, ${code(MCP_RESOURCE)}, <strong>OAuth 2.0</strong> with your firm's own registration ID (the agent's steps 1 and 2).</p>`;
  }
  const auth = `the Reference ID ${code(referenceId)}`;
  return `${heading}
<p>A data source each member turns on in Copilot Chat (tested live there on 2026-10-21), with a Copilot licence per member.</p>
<ol>
<li>Microsoft 365 admin center &gt; <strong>Copilot</strong> &gt; <strong>Connectors</strong> &gt; <strong>Gallery</strong> &gt; <strong>Create a new connector</strong> &gt; <strong>Connect to MCP server</strong>.</li>
<li>Name: ${code(`${instanceName} counsel room`)}. Server URL: ${code(MCP_RESOURCE)}. Authentication: <strong>OAuth 2.0</strong>, with ${auth}.</li>
<li>Choose <strong>Authorize</strong>; in the pop-up, a room member signs in with their room email. Accept Microsoft's notice terms, then <strong>Create</strong>.</li>
<li>Use staged rollout to the room's members. It shows <strong>Ready</strong> in about 10 to 15 minutes.</li>
</ol>`;
}
