// SPDX-License-Identifier: Apache-2.0
// The public "Connect your AI" page at /connect, where every invitation lands (worker/invite.ts). It opens with the
// panel: one card per AI, each with its one button or copy-paste, the room's link already in it, and its step count.
// Then "Ask your AI for a kit", then one section per AI with its steps, the email to whoever turns it on and their
// folded steps, then the sign-in steps once (#sign-in), which every AI links to. The setup kit (web/connect/) says the
// same thing, step for step (connect-panel.test.ts counts both).
//
// | Reader (?for=, worker/invite.ts) | Panel order |
// |---|---|
// | founder | Claude, Copilot, OpenCode |
// | counsel (and no ?for=) | Claude, Copilot, Harvey, OpenCode |
// | investor | Claude, Copilot, OpenCode |
//
// Only the panel follows the reader: every section stays, so counsel always finds Harvey. No scripts (the page CSP has
// no script-src): links and copy boxes sit in select-all boxes, the IT steps fold into <details>, and the email buttons
// are mailto: links. The anchors are fixed, because emails and the room link to them: #claude, #copilot, #harvey,
// #open-weight, each tool's #<id>-it, #kits, #sign-in, #sign-in-code, #help and #disconnect.
import { CLAUDE_PLUGIN_NAME, CLAUDE_PLUGIN_PATH, SKILL_ZIP_PATH } from '../claude-plugin.ts';
import { CONNECT_PATH, DEFAULT_DAILY_TOOL_CAP, MCP_ORIGIN, MCP_RESOURCE, REFRESH_TOKEN_TTL_SECONDS, SERVER_NAME } from '../contract.ts';
import { KITS } from '../kits.ts';
import { AGENT_ZIP_PATH, COPILOT_CHECKLIST, SHARED_AGENT_STEPS, cellText, copilotConnectorSection, copilotPackageSection, troubleTable } from './connect-copilot.ts';
import { HELP_SECTION } from './connect-help.ts';
import { KEEPS_SECTION } from './connect-keeps.ts';
import { CONTACT, escapeHtml, frame } from './html.ts';
import { SECURITY_PATH } from './security.ts';
import { CODE_SENDER, CODE_SENDER_IPS, SIGN_IN_CODE_ID } from './sign-in-code.ts';
import { DEFAULT_READER, type Reader } from '../../worker/invite.ts';
import { instanceName, ownerName, sentence } from '../../worker/room-settings.ts';

/** The sign-in code's sender, re-exported for importers of this page module. */
export { CODE_SENDER, CODE_SENDER_IPS };
/** The page's own address, for the IT emails. */
export const CONNECT_URL = `${MCP_ORIGIN}${CONNECT_PATH}`;
/** The one sign-in section every tool links to. */
export const SIGN_IN_ID = 'sign-in';
const DAYS = Math.round(REFRESH_TOKEN_TTL_SECONDS / 86_400);

/** What the page varies on. mcp/oauth.ts sets them from the request and env (pro adds the downloads, mcp/pro.ts). */
export interface ConnectPageOptions {
  /** The shared Legallas agent can be downloaded. */
  copilotPackage?: boolean;
  /** The shared registration's Reference ID, for the connector steps (without it, the firm uses its own). */
  copilotReferenceId?: string;
  /** The room's PROPOSALS_ENABLED is "1": a member may let a connection propose drafts (docs/design/propose-and-approve.md). */
  proposals?: boolean;
  /** The kits can be downloaded: the Claude plugin and the skill folder (mcp/claude-plugin.ts, added by pro). */
  claudePlugin?: boolean;
  /** Who the invitation was for: it orders and trims the panel (PANEL_ORDER). */
  reader?: Reader;
  /** The room has no published matter (worker/room-shape.ts isCompanyRoom): the emails say "company room" to counsel too. */
  company?: boolean;
}

/**
 * The room as each reader knows it. The page's own words follow it (the title, the emails); the names other apps show
 * (the Copilot agent, the Harvey connector) and the server's quoted messages stay as they are. In a room with no
 * published matter, mcp/index.ts then says "company room" for the rest (mcp/room-words.ts). The emails are
 * percent-encoded in their links, out of its reach, so they take the room's kind here (`company`).
 */
export const ROOM_NOUN: Readonly<Record<Reader, string>> = { founder: 'company room', counsel: 'counsel room', investor: 'deal room' };

/** `text` in the reader's words: their room's kind, and the room's documents rather than a client's case record. */
export function inReaderWords(text: string, reader: Reader, company = false): string {
  if (reader === 'counsel' && !company) return text;
  const noun = reader === 'counsel' ? ROOM_NOUN.founder : ROOM_NOUN[reader];
  return text.replace(/\bcounsel room\b/g, noun).replaceAll("a client's case record", "the room's documents");
}

/** Who uploads the Copilot agent: a firm's IT team for counsel; a startup's own Microsoft 365 admin, often the reader. */
const copilotAdmin = (reader: Reader) => (reader === 'counsel' ? 'your IT team' : 'your Microsoft 365 admin');

/** The four ways in, as the page's anchors. */
export type AiId = 'claude' | 'copilot' | 'harvey' | 'open-weight';

/** The panel's cards for each reader, Claude first. Harvey is a law firm's tool, so only counsel's panel shows it. */
export const PANEL_ORDER: Readonly<Record<Reader, readonly AiId[]>> = {
  founder: ['claude', 'copilot', 'open-weight'],
  counsel: ['claude', 'copilot', 'harvey', 'open-weight'],
  investor: ['claude', 'copilot', 'open-weight'],
};

/**
 * Claude's prefilled "Add custom connector" dialog. Anthropic documents both forms, the same query on the member
 * and the Owner path, with connectorUrl percent-encoded (claude.com/docs/connectors/building/directory-vs-custom,
 * read 2026-10-20). The dialog only prefills: the person still reviews the values and confirms. In the live test
 * as test counsel (2026-10-20) the member dialog warned that an external link suggested it and confirmed with
 * Continue; Anthropic's docs still say Add, which the Owner steps keep (that path was not tested live).
 */
const CLAUDE_ADD_QUERY = `modal=add-custom-connector&connectorName=${encodeURIComponent(instanceName)}&connectorUrl=${encodeURIComponent(MCP_RESOURCE)}`;
/** For a member's own account (Free, Pro, Max). */
export const CLAUDE_ADD_URL = `https://claude.ai/customize/connectors?${CLAUDE_ADD_QUERY}`;
/** For a Team or Enterprise Owner: the organization's connector, shown to every member. */
export const CLAUDE_ADD_ORG_URL = `https://claude.ai/admin-settings/connectors?${CLAUDE_ADD_QUERY}`;

/** A button-styled link that opens claude.ai in a new tab, so these steps stay open beside it. */
function addButton(href: string, label: string): string {
  return `<p class="cx-add"><a class="btn btn--primary" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}<span class="u-vh"> (opens claude.ai in a new tab)</span></a></p>`;
}

/** Page-only rules, added to the shared sheet in <head>. Tokens only; light only, like the rest. */
const CONNECT_STYLES = `
.cx-cards{margin:1.5rem 0 0;padding:0;list-style:none;display:grid;gap:0.75rem;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))}
.cx-card{display:flex;flex-direction:column;gap:0.5rem;min-width:0;padding:1rem;border:1px solid var(--border);border-top:3px solid var(--forest);border-radius:var(--radius);background:var(--surface)}
.cx-card>a{color:var(--forest);font:600 1.125rem/1.5rem var(--font-serif)}
.cx-card p,.cx-card .cx-add{margin:0}
.cx-wide{grid-column:1/-1}
.cx-n{color:var(--ink-2);font:500 0.8125rem/1.25rem var(--font-sans)}
.cx-n b{color:var(--forest);letter-spacing:0.15em}
.cx-pre{margin:0;padding:0.5rem 0.75rem;background:var(--panel);border-radius:var(--radius);overflow:auto;font:500 0.8125rem/1.25rem var(--font-mono);user-select:all}
.cx-kits{margin:1rem 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:0.5rem}
.cx-kits li{margin:0;padding:0.5rem 1rem;border:1px solid var(--forest);border-radius:999px;color:var(--forest);font:600 0.9375rem/1.25rem var(--font-sans)}
.cx-link{margin-top:1rem;padding:1rem 1.5rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)}
.cx-link code{display:block;margin-top:0.375rem;padding:0.5rem 0.75rem;background:var(--panel);border-radius:var(--radius);font:500 1rem/1.5rem var(--font-mono);overflow-wrap:anywhere;user-select:all}
.cx-who,.cx-note{color:var(--ink-2)}
code.cx-copy{padding:0 0.25rem;background:var(--panel);border-radius:var(--radius-chip);font:500 0.875rem/1.5rem var(--font-mono);overflow-wrap:anywhere;user-select:all}
.cx-tool{margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--brass-rule)}
.cx-tool>h2{margin-top:0}
h3{font-size:1.0625rem;line-height:1.5rem;margin-top:1.5rem}
.prose ol{padding-left:1.5rem;margin:0.75rem 0 0}
.prose ul ul{margin-top:0.375rem}
.cx-it{margin-top:1.5rem;max-width:66ch;border:1px solid var(--rule);border-radius:var(--radius);background:var(--surface)}
.cx-it>summary{min-height:var(--target);padding:0.75rem 1rem;cursor:pointer;font:600 0.9375rem/1.25rem var(--font-sans);color:var(--forest)}
.cx-it>div{padding:0 1rem 1.25rem;border-top:1px solid var(--rule)}
.cx-it form{margin-top:1rem;padding:1rem;background:var(--paper);border:1px solid var(--rule);border-radius:var(--radius)}
.cx-it .field{margin-top:0}
.cx-it .actions{margin-top:1rem}
.cx-ask,.cx-add{margin-top:1rem}
.cx-it h4{margin-top:1.25rem;font:600 0.9375rem/1.375rem var(--font-sans);color:var(--ink)}
.cx-trouble{margin-top:0.75rem}
.cx-trouble td{height:auto;padding:0.5rem 0.75rem;vertical-align:top;overflow-wrap:anywhere}
@media (max-width:48rem){.cx-link{padding:1rem}.cx-it>div{padding:0 0.75rem 1rem}}
@media (forced-colors:active){.cx-link,.cx-it,.cx-card,.cx-kits li{border-color:CanvasText}}`.replace(/\n/g, '');

/** A main path's steps: the person's own, then whoever turns it on once. connect-panel.test.ts counts both. */
export interface Steps {
  /** The person's steps, as HTML. They link to #sign-in rather than repeat it. */
  you: readonly string[];
  /** Who turns it on once, for the card ("Your IT team"), and their steps; none when the person does it all. */
  once?: { who: string; steps: readonly string[] };
}

/** One AI tool's section: who does what, what the person does, the email to whoever turns it on, their steps. */
interface Tool {
  id: Exclude<AiId, 'open-weight'>;
  name: string;
  /** Who does what, and how long: the line under the tool's name. */
  who: string;
  steps: Steps;
  /** What follows the steps, as HTML: alternatives, then (for these options) Claude's kits. */
  after: (options: ConnectPageOptions) => string;
  /** Who turns the tool on for the firm, for the email button and the folded steps ("your IT team"). */
  admin: string;
  /** One sentence before the email button: who turns the tool on. */
  notThere: string;
  mail: { subject: string; lines: string[] };
  /** The steps for whoever turns it on, as HTML. Only Copilot's vary, on the shared registration. */
  it: (options: ConnectPageOptions) => string;
}

const LINK = `<code class="cx-copy">${MCP_RESOURCE}</code>`;
/** The link each tool's steps use instead of repeating the sign-in steps. */
const SIGN_IN_LINK = `<a href="#${SIGN_IN_ID}">Signing in</a>`;
/** The sign-in step every path shares: the email and the code (Signing in, steps 1 and 2). */
const SIGN_IN_STEP = `Sign in with the email your invitation went to, and the code it sends: see ${SIGN_IN_LINK}.`;
const list = (steps: readonly string[]) => `<ol>\n${steps.map((step) => `<li>${step}</li>`).join('\n')}\n</ol>`;

/** The Claude plugin's places (claude.com/docs/plugins, read 2026-11-06). The download sits on the panel's card. */
const CLAUDE_KITS = `<h3>The room's kits</h3>
<p>Upload the plugin from the Claude card: Customize &gt; Plugins &gt; Add &gt; <strong>Upload plugin</strong>. In Claude Code: <code class="cx-copy">claude --plugin-dir ${CLAUDE_PLUGIN_NAME}</code>.</p>`;
const CLAUDE_KITS_ORG = `<p>The room's kits for everyone: <a href="${CLAUDE_PLUGIN_PATH}">download the Claude plugin</a>, then Organization settings &gt; Plugins &amp; skills &gt; Inventory &gt; Add &gt; <strong>Upload a plugin</strong>, and set its default access.</p>`;

const CLAUDE: Tool = {
  id: 'claude',
  name: 'Claude',
  who: 'You, about two minutes.',
  steps: {
    you: [
      'Choose <strong>Add to Claude</strong> on the Claude card. Claude opens Add custom connector, prefilled.',
      `Claude warns that an external link suggested it: check that the link reads ${LINK}, then choose <strong>Continue</strong>.`,
      `${SIGN_IN_STEP} If no sign-in page opens, choose <strong>Connect</strong> next to ${instanceName}.`,
      'Choose <strong>Connect claude.ai</strong>.',
    ],
  },
  after: ({ claudePlugin = false }) => `<p>Then <strong>Always allow</strong> the read-only tools (Customize &gt; Connectors &gt; ${instanceName} &gt; Tool permissions). In a chat: <strong>+</strong> &gt; Connectors &gt; ${instanceName}. On Team or Enterprise, an Owner adds it first (below).</p>${claudePlugin ? CLAUDE_KITS : ''}`,
  admin: 'your IT team',
  notThere: `On Team or Enterprise, no ${instanceName} under Connectors? A Claude Owner in your organization adds it once.`,
  mail: {
    subject: `Please add the ${instanceName} counsel room connector to Claude`,
    lines: [
      'Hello,',
      '',
      `Please add the ${instanceName} counsel room connector to our Claude organization. It is a read-only link to a client's case record. An Owner does this once; the steps are at ${CONNECT_URL}#claude-it`,
      '',
      `Open ${CLAUDE_ADD_ORG_URL}, check the link reads ${MCP_RESOURCE}, leave the client ID and secret blank, and choose Add. Then set the read-only ${instanceName} tools to Always allow.`,
      '',
      'Thank you.',
    ],
  },
  it: (options) => `${addButton(CLAUDE_ADD_ORG_URL, 'Add to Claude for your organization')}
<ol>
<li>As an Owner, choose <strong>Add to Claude for your organization</strong>. Claude opens Organization settings &gt; Connectors, prefilled.</li>
<li>Check that the link reads ${LINK}. Keep <strong>Use Claude's published identity (Recommended)</strong>, leave the client ID and secret blank, and choose <strong>Add</strong>.</li>
<li>Recommended: <strong>Always allow</strong> the read-only tools, or each member approves every look-up.</li>
</ol>
<p>By hand: Organization settings &gt; Connectors &gt; Add &gt; Custom &gt; Web; paste the link, no client ID or secret.</p>${options.claudePlugin ? CLAUDE_KITS_ORG : ''}`,
};

/** What Copilot Studio's orchestrator reads to decide when to call the server (its "Server description"). */
export const STUDIO_DESCRIPTION = 'Read-only search, document facts, page text, visuals and comment threads from a litigation counsel room.';

/** The Copilot Studio steps, short: the values to type; copilot.md has each screen. Nothing to ask the owner for. */
const STUDIO_STEPS = `<ol>
<li>In an agent named ${instanceName} counsel room, generative orchestration on: <strong>Tools</strong> &gt; <strong>Add a tool</strong> &gt; <strong>New tool</strong> &gt; <strong>Model Context Protocol</strong>. Server name <code class="cx-copy">${instanceName} counsel room</code>, description <code class="cx-copy">${STUDIO_DESCRIPTION}</code>, URL ${LINK}, <strong>OAuth 2.0</strong>, <strong>Dynamic discovery</strong>.</li>
<li><strong>Create a new connection</strong> with a room member signing in, then <strong>Add to agent</strong>; in the tool's details choose <strong>End user credentials</strong>.</li>
<li>Publish, and add the <strong>Teams and Microsoft 365 Copilot</strong> channel for the room's members.</li>
</ol>`;

/** The Copilot IT steps: the checklist, the agent, the connector as the alternative, Copilot Studio, the table. */
function copilotIt({ copilotPackage = false, copilotReferenceId }: ConnectPageOptions): string {
  const agent = copilotPackageSection(copilotPackage);
  const connector = copilotConnectorSection(copilotReferenceId || null);
  return `${COPILOT_CHECKLIST}\n${agent}\n${connector}\n<h4>Other option: Copilot Studio</h4>\n${STUDIO_STEPS}\n${troubleTable()}`;
}

const COPILOT: Tool = {
  id: 'copilot',
  name: 'Microsoft 365 Copilot',
  who: `In Outlook, Teams and Word. Your IT team adds ${instanceName} once, then you sign in.`,
  steps: {
    you: [
      `Open Copilot's agents (in Outlook or Word, the <strong>Copilot</strong> pane's menu; in Teams, the <strong>Copilot</strong> app in the left rail, then <strong>Agents</strong>, not the @ list) and choose <strong>${instanceName} counsel room</strong>.`,
      `Ask a question, then choose <strong>Sign in to ${instanceName} counsel room</strong>.`,
      `${SIGN_IN_STEP} In the desktop apps, sign-in opens its own window and may need one more code; keep it open until it closes.`,
      'Choose <strong>Connect</strong>.',
    ],
    once: { who: 'Your IT team', steps: SHARED_AGENT_STEPS },
  },
  after: () => `<p>Your firm added the connector instead? In Copilot Chat: <strong>+</strong> &gt; <strong>Change data sources</strong> &gt; <strong>${instanceName} counsel room</strong> &gt; <strong>Connect</strong> &gt; <strong>Continue to ${instanceName} counsel room</strong>, sign in, then a <strong>New chat</strong>. Its consent card says "read and write"; every ${instanceName} tool is read-only.</p>`,
  admin: 'your IT team',
  notThere: `No ${instanceName} counsel room under Agents? Your Microsoft 365 IT team adds it once.`,
  mail: {
    subject: `Please add the ${instanceName} counsel room to Microsoft 365 Copilot`,
    lines: [
      'Hello,',
      '',
      `Please add the ${instanceName} counsel room to Microsoft 365 Copilot (Outlook, Teams and Word) for me. It is a read-only link to a client's case record. Steps and IT checklist: ${CONNECT_URL}#copilot-it`,
      '',
      `The server link is ${MCP_RESOURCE}. Each member then signs in once with their own room email.`,
      '',
      'Thank you.',
    ],
  },
  it: copilotIt,
};

/** Harvey's Bring Your Own MCP form, as the admin fills it in (the Harvey card shows the same values). */
const HARVEY_NAME = `${instanceName} counsel room`;

const HARVEY: Tool = {
  id: 'harvey',
  name: 'Harvey',
  who: 'Your Harvey admin turns it on once, then you sign in.',
  steps: {
    you: [
      `In Harvey, go to Settings &gt; User Settings &gt; Connectors &gt; <strong>${HARVEY_NAME}</strong> and choose <strong>Connect</strong>.`,
      SIGN_IN_STEP,
      'Choose <strong>Connect</strong>.',
    ],
    once: {
      who: 'Your Harvey admin',
      steps: [
        `As a workspace admin, go to Settings &gt; Org Settings &gt; Connectors and add a custom MCP server (Bring Your Own MCP). Name: <code class="cx-copy">${HARVEY_NAME}</code>. URL: ${LINK}. Authentication: <strong>OAuth</strong>; Harvey registers itself, nothing to type.`,
        "Enable it for the room's members, and allow every tool.",
      ],
    },
  },
  after: () => `<p>Then in Assistant, turn the ${instanceName} source on and ask.</p>`,
  admin: 'your Harvey admin',
  notThere: `No ${instanceName} counsel room under Connectors? Your Harvey workspace admin turns it on once.`,
  mail: {
    subject: `Please connect the ${instanceName} counsel room to Harvey`,
    lines: [
      'Hello,',
      '',
      `Please connect the ${instanceName} counsel room to Harvey for me. It is a read-only link to a client's case record. A Harvey workspace admin does this once; the steps are at ${CONNECT_URL}#harvey-it`,
      '',
      `The server link is ${MCP_RESOURCE}. Each member then signs in once with their own room email.`,
      '',
      'Thank you.',
    ],
  },
  it: (options) => `${list(HARVEY.steps.once!.steps.map((step, i) => (i === 1 ? `${step} ${readOnlyLine(options)}` : step)))}
<p>Turning it on gives nobody access by itself: each member still signs in.</p>
<p>If Harvey opens the room's sign-in while you add it, close it: no code reaches you. Never let a member type their code into your session.</p>
<p>If Harvey reports a callback or redirect error, or asks for a client ID and secret, email ${ownerName} at <a href="mailto:${CONTACT}">${CONTACT}</a> with the callback URL it shows.</p>
<p>Code sender: <a href="#${SIGN_IN_CODE_ID}">If the sign-in code doesn't arrive</a>. Members' messages: <a href="#help">In Harvey</a>.</p>`,
};

/** The tools with a firm admin, in the order the page offers them. The fourth way in, OpenCode, follows them. */
export const TOOLS: readonly Tool[] = [CLAUDE, COPILOT, HARVEY];

/** A mailto: link with no recipient (the member picks one), the subject and the body percent-encoded, CRLF lines. */
export function mailtoHref(subject: string, lines: readonly string[]): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\r\n'))}`;
}

function toolSection(tool: Tool, options: ConnectPageOptions): string {
  const reader = options.reader ?? DEFAULT_READER;
  const words = (text: string) => inReaderWords(text, reader, options.company);
  const mail = mailtoHref(words(tool.mail.subject), tool.mail.lines.map(words));
  return `<section class="cx-tool prose" id="${tool.id}" aria-labelledby="${tool.id}-title">
<h2 id="${tool.id}-title">${escapeHtml(tool.name)}</h2>
<p class="cx-who">${escapeHtml(tool.who)}</p>
<h3>What you do</h3>
${list(tool.steps.you)}
${tool.after(options)}
<h3>Not there yet?</h3>
<p>${escapeHtml(tool.notThere)}</p>
<p class="cx-ask"><a class="btn" href="${escapeHtml(mail)}">Email ${escapeHtml(tool.admin)}<span class="u-vh"> about ${escapeHtml(tool.name)}</span></a></p>
<details class="cx-it" id="${tool.id}-it">
<summary>For ${escapeHtml(tool.admin)} (once)</summary>
<div>${tool.it(options)}</div>
</details>
</section>`;
}

/**
 * The fourth way in: OpenCode with an open-weight model, no firm tool to turn on, so no email or IT steps. The config
 * is web/connect/open-weight.md's, with this room's link: it pins one open-weight model on one zero-retention host
 * before anything reaches the room. The guide holds the why of each line.
 */
export const OPEN_WEIGHT_NAME = 'OpenCode, with an open-weight model';
export const OPEN_WEIGHT_WHO = 'You, once the owner turns on desktop apps.';
const OPENCODE_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
/** The config, exactly as open-weight.md prints it with this room's link (connect-panel.test.ts compares them). */
export const OPENCODE_CONFIG = `{
  "$schema": "https://opencode.ai/config.json",
  "share": "disabled",
  "enabled_providers": ["openrouter"],
  "model": "openrouter/${OPENCODE_MODEL}",
  "small_model": "openrouter/${OPENCODE_MODEL}",
  "provider": {
    "openrouter": {
      "whitelist": ["${OPENCODE_MODEL}"],
      "models": {
        "${OPENCODE_MODEL}": {
          "options": {
            "provider": { "order": ["baseten/fp4/us"], "allow_fallbacks": false, "zdr": true, "data_collection": "deny" }
          }
        }
      }
    }
  },
  "mcp": {
    "${SERVER_NAME}": { "type": "remote", "url": "${MCP_RESOURCE}", "oauth": {} }
  }
}`;

const OPEN_WEIGHT_STEPS: Steps = {
  you: [
    'Save the config on the OpenCode card as <code>~/.config/opencode/opencode.json</code>, never in a project folder. Ask OpenCode a test question: OpenRouter\'s Activity page should show only BaseTen.',
    `In a terminal, run <code class="cx-copy">opencode mcp auth ${SERVER_NAME}</code>. ${SIGN_IN_STEP}`,
    'Choose <strong>Connect</strong>.',
  ],
  once: { who: sentence(ownerName), steps: ['Turns on desktop apps for the room (open-weight.md).'] },
};

const OPEN_WEIGHT = `<section class="cx-tool prose" id="open-weight" aria-labelledby="open-weight-title">
<h2 id="open-weight-title">${OPEN_WEIGHT_NAME}</h2>
<p class="cx-who">${OPEN_WEIGHT_WHO}</p>
<p>Before you start: OpenCode (opencode.ai) with OpenRouter added (<code>/connect</code>), every OpenRouter <strong>Zero Data Retention</strong> toggle on and BaseTen the only allowed provider. Open-weight models only, such as gpt-oss or Nemotron. A model on your computer instead: <code>open-weight.md</code>.</p>
<h3>What you do</h3>
${list(OPEN_WEIGHT_STEPS.you)}
<p>The kits: unzip the skill folder on the card into <code>~/.agents/skills/</code>.</p>
</section>`;

/** Every main path, for the panel's counts and the tests: the tools', then OpenCode's. */
export const STEPS: Readonly<Record<AiId, Steps>> = { claude: CLAUDE.steps, copilot: COPILOT.steps, harvey: HARVEY.steps, 'open-weight': OPEN_WEIGHT_STEPS };

/** One line of a card's step count: who, a dot per step, the number. */
function countLine(who: string, n: number): string {
  return `<p class="cx-n">${who} <b aria-hidden="true">${'●'.repeat(n)}</b> ${n} step${n === 1 ? '' : 's'}</p>`;
}

/** A copy-paste box: select-all on click, no script. */
const copyBox = (text: string) => `<pre class="cx-pre"><code>${cellText(text)}</code></pre>`;

/** Each card's one action, the room's link already in it. */
function cardAction(id: AiId, options: ConnectPageOptions): string {
  const reader = options.reader ?? DEFAULT_READER;
  const kits = (href: string, label: string) => (options.claudePlugin ? `<p><a href="${href}">${label}</a></p>` : '');
  switch (id) {
    case 'claude':
      return `${addButton(CLAUDE_ADD_URL, 'Add to Claude')}${kits(CLAUDE_PLUGIN_PATH, 'The Claude plugin, with the six kits')}`;
    case 'copilot':
      return options.copilotPackage
        ? `<p class="cx-add"><a class="btn btn--primary" href="${AGENT_ZIP_PATH}">Download the agent</a></p><p class="cx-note">${reader === 'counsel' ? 'For your IT team to upload.' : 'Your Microsoft 365 admin uploads this once (often you).'}</p>`
        : `<p class="cx-add"><a class="btn" href="#copilot-it">Steps for ${copilotAdmin(reader)}</a></p>`;
    case 'harvey':
      return `<p class="cx-note">Bring Your Own MCP, for your admin:</p><p>Name <code class="cx-copy">${HARVEY_NAME}</code></p><p>URL ${LINK}</p><p>Authentication <strong>OAuth</strong></p>`;
    case 'open-weight':
      return `${copyBox(OPENCODE_CONFIG)}${kits(SKILL_ZIP_PATH, 'The skill folder, with the six kits')}`;
  }
}

const CARD_NAMES: Readonly<Record<AiId, string>> = { claude: 'Claude', copilot: 'Microsoft 365 Copilot', harvey: 'Harvey', 'open-weight': 'OpenCode' };

/** The panel: one card per AI for this reader, each its name (a link to its section), its counts and its action. */
function panel(options: ConnectPageOptions): string {
  const reader = options.reader ?? DEFAULT_READER;
  const cards = PANEL_ORDER[reader].map((id) => {
    const steps = STEPS[id];
    const once = steps.once ? countLine(id === 'copilot' ? sentence(copilotAdmin(reader)) : steps.once.who, steps.once.steps.length) : '';
    const wide = id === 'open-weight' ? ' cx-wide' : '';
    return `<li class="cx-card${wide}" data-ai="${id}"><a href="#${id}">${CARD_NAMES[id]}</a>${once}${countLine('You', steps.you.length)}${cardAction(id, options)}</li>`;
  });
  return `<ul class="cx-cards" aria-label="Your AI">\n${cards.join('\n')}\n</ul>`;
}

/** What to ask once connected: the six kits (mcp/kits.ts), the same in every AI. */
const KITS_SECTION = `<section class="cx-tool prose" id="kits" aria-labelledby="kits-title">
<h2 id="kits-title">Ask your AI for a kit</h2>
<p>Name one, for example &ldquo;Build a matter board from the room.&rdquo;</p>
<ul class="cx-kits">${KITS.map((kit) => `<li>${kit.title}</li>`).join('')}</ul>
</section>`;

/** The shared sign-in-code help (sender facts in sign-in-code.ts). The per-tool guides link to its fixed id. */
const SIGN_IN_CODE = `<h3 id="${SIGN_IN_CODE_ID}">If the sign-in code doesn't arrive</h3>
<ul>
<li>Use the exact email address your room invitation went to. For any other address no code is sent, even though the page says one was.</li>
<li>The code comes from <code>${CODE_SENDER}</code> (Cloudflare, which runs the sign-in). Check your junk or quarantine folder.</li>
<li>A code works once, for 10 minutes. If the page says it was already used or has expired, request a new code.</li>
<li>Ask your IT team to allowlist <code>${CODE_SENDER}</code> (domain <code>notify.cloudflare.com</code>, sending IPs ${CODE_SENDER_IPS}) and to exempt it from link rewriting or scanning: a scanner that opens the message first can use up the code.</li>
</ul>`;

/** The sign-in steps, once for every tool. */
const SIGN_IN = `<section class="cx-tool prose" id="${SIGN_IN_ID}" aria-labelledby="sign-in-title">
<h2 id="sign-in-title">Signing in (the same in every AI tool)</h2>
<ol>
<li>Your AI tool opens a sign-in page. Under <strong>Email</strong>, type the exact address your room invitation went to, not an alias or forwarding address. Ignore the <strong>Cloudflare</strong> button; it is for the room's owner.</li>
<li>Choose <strong>Send login code</strong>, then type the code from your inbox.</li>
<li>On the next page, choose <strong>Connect</strong> (the button names your AI tool, for example <strong>Connect claude.ai</strong>).</li>
</ol>
<p>Access is yours alone: nobody else can use your connection. Any message on the way: <a href="#help">If something goes wrong</a>.</p>
${SIGN_IN_CODE}
</section>`;

/** What the tools may do: all read-only, or, while the room's proposals are on, read-only plus a proposal a person approves. */
function readOnlyLine({ proposals = false }: ConnectPageOptions): string {
  return proposals
    ? 'All are read-only, except that a member may let their connection propose a draft, which changes nothing until they approve it in the room.'
    : 'All are read-only.';
}

const goodToKnow = (options: ConnectPageOptions) => `<section class="cx-tool prose" aria-labelledby="know-title">
<h2 id="know-title">Good to know</h2>
<ul>
<li>Read-only: your AI tool can search and read the room, including the visuals, the comment threads and, for apps that accept them, small original files. It cannot change, upload or delete anything.${options.proposals ? ' If you let it propose when you connect, it can also propose a draft, which changes nothing until you approve it in the room.' : ''}</li>
<li>The connection lasts ${DAYS} days. Then your tool asks you to sign in again with a new code.</li>
<li>Sign-in works from the United States only.</li>
<li>Each member has ${DEFAULT_DAILY_TOOL_CAP.toLocaleString('en-US')} AI look-ups a day. The count resets at midnight UTC.</li>
<li>${sentence(ownerName)} sees which documents were opened and through which AI tool, never what you asked.</li>
<li>What your AI tool reads goes to its AI provider under your organization's agreement with them, the same as a document you paste in.</li>
</ul>
</section>`;

const DISCONNECT = `<section class="cx-tool prose" id="disconnect" aria-labelledby="disconnect-title">
<h2 id="disconnect-title">Disconnect</h2>
<p>Open <a href="/connections">Your AI connections</a>, sign in with your room email, and choose <strong>Disconnect</strong>. Removing the connector inside your AI tool alone does not end it on our side.</p>
</section>`;

/**
 * The whole page. The panel, the title and the emails follow the reader; the title and the emails follow the room's
 * kind too; the Copilot IT steps and the downloads follow the other options. mcp/oauth.ts serves it for GET and HEAD /connect (publicPage); it is public, because firm IT, who are not
 * room members, read it too, and an invitee reaches it in one click before signing in anywhere.
 */
export function renderConnectPage(options: ConnectPageOptions = {}): string {
  const body = `<h1>Connect your AI</h1>
<p class="lead">It reads the room live, read-only, signed in as you. Pick yours:</p>
${panel(options)}
<div class="cx-link">
<p class="label">The link</p>
<code>${MCP_RESOURCE}</code>
<p class="cx-note">Click the link once to select all of it, then copy it.</p>
</div>
${KITS_SECTION}
${TOOLS.map((tool) => toolSection(tool, options)).join('\n')}
${OPEN_WEIGHT}
${SIGN_IN}
${goodToKnow(options)}
${KEEPS_SECTION}
${HELP_SECTION}
${DISCONNECT}`;
  const nav = [{ href: '/connections', label: 'Your AI connections' }, { href: SECURITY_PATH, label: 'Security' }];
  const html = frame({ title: 'Connect your AI', body, nav }).replace(/<title>[^<]*<\/title>/, (title) => inReaderWords(title, options.reader ?? DEFAULT_READER, options.company));
  return html.replace('</style>', `${CONNECT_STYLES}</style>`);
}
