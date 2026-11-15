// SPDX-License-Identifier: Apache-2.0
// "If something goes wrong" on the public /connect page (#help, linked from every error page as "Setup help").
// Each item quotes what the member sees, then the one thing to do. A code that never comes or is already used
// points to "If the sign-in code doesn't arrive" (#sign-in-code, in Signing in), which owns the sender, the
// allowlist and the 10 minutes; this section does not repeat them. The sign-in messages are Cloudflare Access's
// own (developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) and the room's
// /welcome/away/ and /welcome/denied/ pages, which the Access app uses as its deny pages; the Claude messages
// are Anthropic's (claude.com/docs/connectors/building/troubleshooting and getting-started), all read 2026-10-20,
// except "already exists" and "no tools available", which claude.ai showed in the live test as test counsel
// (2026-10-20) and Anthropic does not document. web/connect/claude-ai.md carries the documented rows in full, and the
// ones the page's Claude steps and Good to know already answer (Always allow, Reconnect after the 30 days).
// Microsoft's messages are in the Copilot IT steps' table (connect-copilot.ts), which the Copilot group points to.
// Harvey publishes none of its connector messages (help.harvey.ai, read 2026-10-20), so the Harvey rows quote the
// room's own; web/connect/harvey.md has them in full.
// The groups follow the page's tool order: Claude, Microsoft 365 Copilot, Harvey.
import { MCP_RESOURCE } from '../contract.ts';
import { CONTACT } from './html.ts';
import { accessHost, instanceName, mcpHost, ownerAllows, ownerName } from '../../worker/room-settings.ts';

/** The hosts a member's browser must reach during sign-in: this server and the room's Access team domain. */
export const SIGN_IN_HOSTS = [mcpHost, accessHost] as const;

/** One problem: what the member sees (HTML, already quoted where it is a message) and what to do (HTML). */
type Row = [seen: string, fix: string];

const q = (text: string) => `&ldquo;${text}&rdquo;`;
/** claude.ai's own messages from the live test (2026-10-20): re-adding a connector it has, and the tool list's lag. */
export const ALREADY_ADDED = 'A connector with this URL already exists in your organization.';
export const NO_TOOLS_YET = 'This connector has no tools available.';
/** The shared sign-in code block in Signing in (pages/connect.ts). */
const CODE_HELP = '<a href="#sign-in-code">If the sign-in code doesn\'t arrive</a>';

const SIGN_IN_ROWS: Row[] = [
  [`No code comes, or ${q('This One-Time PIN has already been used')}`, `See ${CODE_HELP} under Signing in.`],
  [q('That account does not have access.'), 'The code was mistyped, expired or replaced by a newer one. Ask for a new code and type it straight away.'],
  [q('Sign-in works only from the United States.'), 'You are outside the United States, or a VPN makes it look that way. Turn the VPN off, or connect once you are back.'],
  [q('This room is private.'), 'You signed in another way, for example with the <strong>Cloudflare</strong> button. Choose <strong>Sign out</strong>, start again from your AI tool and use <strong>Email</strong>.'],
  [q('This page has expired'), 'A sign-in page works once, for 10 minutes, in the browser that opened it. Go back to your AI tool and choose <strong>Connect</strong> again.'],
  [`${q('No access')} or ${q('This link cannot be used')}`, `Start again from your AI tool with the email your room invitation went to. If the page comes back, email ${ownerName} at <a href="mailto:${CONTACT}">${CONTACT}</a>.`],
];

const COPILOT_ROWS: Row[] = [
  ['A Microsoft message in Copilot, or the sign-in window does not open or close.', 'Your IT team has a table of each message and its fix: <a href="#copilot-it">For your IT team</a>, under Microsoft 365 Copilot.'],
];

const HARVEY_ROWS: Row[] = [
  [q('App not allowed'), `Harvey used a sign-in callback the room does not know yet. Email ${ownerName} at <a href="mailto:${CONTACT}">${CONTACT}</a>; once ${ownerAllows} it, choose <strong>Connect</strong> again.`],
  ['Harvey answers without citing the room.', `In Assistant, turn the ${instanceName} source on, then ask again.`],
];

const CLAUDE_ROWS: Row[] = [
  ['No <strong>Add custom connector</strong>.', 'On Team or Enterprise, an Owner adds it first: use <strong>Email your IT team</strong> under Claude. On Free, Claude allows one custom connector, so remove the other one first.'],
  [q(ALREADY_ADDED), `Claude has it already (on Team or Enterprise, your Owner added it): in Customize &gt; Connectors, choose ${instanceName}, then <strong>Connect</strong>.`],
  [q("Couldn't reach the MCP server"), `Check that the link reads exactly <code class="cx-copy">${MCP_RESOURCE}</code>, with nothing after <code>/mcp</code>. Remove ${instanceName} and add it again with <strong>Add to Claude</strong>.`],
  [q('Authorization with the MCP server failed'), `Choose <strong>Connect</strong> again. If it fails twice, send ${ownerName} the reference in the error that starts with <code>ofid_</code>, soon: it is time-limited.`],
  [q(NO_TOOLS_YET), 'Reload the page a few seconds after connecting: all ten tools appear.'],
  [`No ${instanceName} under <strong>+</strong> &gt; Connectors.`, 'Check that it shows <strong>Connected</strong> under Customize &gt; Connectors. On Team or Enterprise, connectors work in private projects only.'],
];

function list(rows: readonly Row[]): string {
  return `<ul>${rows.map(([seen, fix]) => `\n<li><strong>${seen}</strong> ${fix}</li>`).join('')}\n</ul>`;
}

/** The whole section. Static: the same for every visitor. */
export const HELP_SECTION = `<section class="cx-tool prose" id="help" aria-labelledby="help-title">
<h2 id="help-title">If something goes wrong</h2>
<h3>On the sign-in page</h3>
${list(SIGN_IN_ROWS)}
<h3>In Claude</h3>
${list(CLAUDE_ROWS)}
<h3>In Microsoft 365 Copilot</h3>
${list(COPILOT_ROWS)}
<h3>In Harvey</h3>
${list(HARVEY_ROWS)}
<h3>For your IT team</h3>
<p>Let members' browsers reach ${SIGN_IN_HOSTS.map((h) => `<code class="cx-copy">${h}</code>`).join(' and ')}. For the sign-in code's sender, see ${CODE_HELP}. The AI tools reach the room from their own servers, not from your network.</p>
<p>Anything else: email ${ownerName} at <a href="mailto:${CONTACT}">${CONTACT}</a> with what the page said.</p>
</section>`;
