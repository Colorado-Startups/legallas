# Connect Claude to the room

Works in claude.ai and the Claude desktop app, with the same steps in either. Once connected, you can also use it
in the Claude mobile apps, Claude for Word, Excel, PowerPoint and Outlook (beta) and Claude Code, on the same Claude
account. You need the email address you use for the room.

**The setup page:** `https://mcp.room.example.com/connect`

**The link:** `https://mcp.room.example.com/mcp`

## Before you start

- **Your Claude plan.** On Free, Pro or Max you add it yourself. Free allows one custom connector, so remove any
  other custom connector first. On Team or Enterprise, an Owner of your organization's Claude account adds it first
  (see "What your IT team does once"); then you only choose **Connect**.
- **A computer.** Add it on claude.ai or in the desktop app. Adding connectors on a phone is still in beta.
- **The United States.** Sign-in works from the United States only. Turn off any VPN that connects through
  another country.
- **Your inbox, and the exact address your room invitation went to.** An alias or forwarding address gets no
  code. If the code doesn't come, see [If the sign-in code doesn't arrive](README.md#if-the-sign-in-code-doesnt-arrive).

## What you do

**Claude Free, Pro or Max (your own account),** signed in to claude.ai or the desktop app with the Claude account you
use for work:

1. Open the **Add to Claude** link (the same button is on the setup page's Claude card):
   <https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Legallas&connectorUrl=https%3A%2F%2Fmcp.room.example.com%2Fmcp>
   Claude opens its **Add custom connector** dialog with the name and the link filled in.
2. Check that the link reads `https://mcp.room.example.com/mcp`. If Claude shows more choices, keep
   **Sign in now** and **Use Claude's published identity (Recommended)**, choosing **Continue** between steps.
   Leave any client ID and secret blank. Choose **Continue** (or **Add**).
3. Sign in. On the page titled **Log in to Legallas AI connect (sign-in)**, under **Email**, type the exact address
   your room invitation went to, not an alias or forwarding address (ignore the **Cloudflare** button; it is for the
   room's owner). Choose **Send login code**, then type the code from your inbox. If no sign-in page opens, choose
   **Connect** next to Legallas.
4. Check that **Access goes to** reads `claude.ai`, then choose **Connect claude.ai**. Claude now shows Legallas as
   **Connected**.

By hand instead: **Customize > Connectors**, choose **+** (or **Add**), then **Add custom connector**, name it
`Legallas` and paste the link. In the desktop app, **Customize** is in the sidebar.

**Claude Team or Enterprise (your organization's account):** you cannot add a custom connector yourself, so an Owner adds
it once (next section). Then go to **Customize > Connectors**, find **Legallas** (it usually has a **Custom**
label), choose **Connect**, and sign in as in steps 3 and 4.

**Let it read without asking each time (recommended):** go to **Customize > Connectors > Legallas > Tool
permissions** and set the read-only tools to **Always allow**. Every Legallas tool is read-only. If Claude asks in
a chat instead, choose **Always allow** rather than **Allow once**. If **Always allow** is not offered, your
organization's Claude Owner has limited it; ask the Owner.

**In a chat:** choose **+** > **Connectors** and turn **Legallas** on for that conversation, then ask. Claude cites
the control number and page, with a link that opens the page in the room. On Team or Enterprise, connectors work
in private projects only; in a shared project, start a chat outside it. Claude's own Gmail, Google Drive and Google
Calendar connectors can be on in the same chat.

**On your phone, in Office and in Claude Code:** nothing more to do once you have added it on claude.ai or in the
desktop app. Legallas appears in the Claude mobile apps the next time you sign in there, in Claude for Word, Excel,
PowerPoint and Outlook (beta), and in Claude Code (`/mcp` lists it). Each needs a sign-in with your Claude account:
Claude reached through Amazon Bedrock, Google Vertex AI or a company AI gateway does not get it.

**Every 30 days:** the connection ends. Claude shows **Reconnect** next to Legallas in **Customize > Connectors**,
or a **Connect** card in the chat. Choose it and sign in again with a new code.

### The room's kits

Six kits run over the room: matter board, review grid, cite check, chronology, entity-choice matrix and deviation
board. Download the Claude plugin from the setup page's Claude card
(`https://mcp.room.example.com/connect/legallas-claude-plugin.zip`). It brings the room's connector with it.

| In | Do this |
|---|---|
| claude.ai or the desktop app | **Customize > Plugins > Add > Upload plugin**, then pick the ZIP |
| Claude Code | `claude --plugin-dir legallas-claude-plugin.zip` (this session only) |

Then ask for a kit by name, for example "Build a matter board from the room."

### Anthropic's legal plugins, reading the room

Anthropic's `litigation-legal` and `corporate-legal` plugins read documents from a source you name. Name the room:
in the plugin's setup interview, give **Legallas (connector)** as the document source, or the data room. In a chat,
say "the documents are in the Legallas room". No new tools: each skill reads through the ones below. Every result
keeps its control number, page and a link that opens that page in the room.

**Counsel: litigation skills** (founders too)

| Skill | Reads elsewhere | Reads in the room |
|---|---|---|
| `chronology` | An eDiscovery export or production index | `legallas_case_overview` (events), `legallas_list_documents` (`since`), `legallas_search`, `legallas_read_pages`. Or the room's **chronology** kit |
| `claim-chart` | Pleadings and evidence, pin-cited | `legallas_search` for each element, `legallas_read_pages` for the pin cite: control number and page |
| `privilege-log-review` | A privilege log, or a document set | `legallas_list_documents` (each row has `privileged`), `legallas_read_pages` |
| `legal-hold` | The matter file, custodians | `legallas_search` for the trigger date and the custodians the documents name. The hold itself stays on the owner's hold screen |
| Matter board (the room's kit) | | `legallas_case_overview`, `legallas_list_documents` |

**Investors: diligence skills, with the room as the data room** (founders too)

These skills name Box, Intralinks and Datasite as data rooms. The Legallas room is the data room here: no upload
or export.

| Skill | Reads elsewhere | Reads in the room |
|---|---|---|
| `diligence-issue-extraction` | A virtual data room | `legallas_list_documents` (the round's folders), `legallas_read_pages`, `legallas_search`. Each issue cites a control number and page |
| `closing-checklist` | Data room uploads | `legallas_list_documents` (`since` the last check), `legallas_get_document` |
| `tabular-review` | A document set | `legallas_read_pages`. Or the room's **review grid** kit |

An investor's AI reads 6 tools: `legallas_search`, `legallas_list_documents`, `legallas_get_document`,
`legallas_read_pages`, `legallas_view_visual` and `legallas_search_law`. Privileged documents never reach it.

### Good questions to start with

- "Give me an overview of the room, with cites."
- "Search the record for the key documents on [topic], and cite each one by control number and page."
- "Read the pages of [document] and summarize what it says, citing each page."
- In a case room: "List what the operative complaint alleges about [topic] and which documents bear on each allegation."
- "List the room's visuals, then explain the one on [topic], with cites."
- "Summarize the comment threads on [document] and what is still open."

### Good to know

- Read-only: your AI tool can search and read the room, including the visuals, the comment threads and, for apps
  that accept them, small original files. It cannot change, upload or delete anything.
- The connection lasts 30 days. Then your tool asks you to sign in again with a new code.
- Sign-in works from the United States only.
- Each member has 3,000 AI look-ups a day. The count resets at midnight UTC.
- The owner sees which documents were opened and through which AI tool, never what you asked.
- What your AI tool reads goes to your organization's AI provider under its agreement with them, the same as a
  document you paste in.
- One Claude connection per member: connecting Legallas from a second Claude account ends the first one's
  connection.

### Disconnect

Open `https://mcp.room.example.com/connections`, sign in with your room email, choose **Disconnect**.
Removing the connector inside your AI tool alone does not end it on our side.

### If something goes wrong

On the sign-in page:

| You see | Do this |
|---|---|
| "A code has been emailed to you", but no code comes, or "This One-Time PIN has already been used" | See [If the sign-in code doesn't arrive](README.md#if-the-sign-in-code-doesnt-arrive) (the same list is on the setup page: `https://mcp.room.example.com/connect#sign-in-code`) |
| "That account does not have access." | The code was mistyped, has expired, or a newer code replaced it. Ask for a new code and type it straight away |
| "Sign-in works only from the United States." | You are outside the United States, or a VPN makes it look that way. Turn the VPN off, or connect once you are back |
| "This room is private." | You signed in another way, for example with the **Cloudflare** button. Choose **Sign out**, then start again from Claude and use **Email** |
| "This page has expired" | A sign-in page works once, for 10 minutes, in the browser that opened it. Go back to Claude and choose **Connect** again |
| "This link cannot be used" | Go back to Claude and choose **Connect** again. If the page comes back, tell the owner |
| "No access" | You signed in with an address that is not a room member. Use the email your invitation went to, or ask the owner |
| "App not allowed" | You started from Claude Code's own server settings or another app. Add Legallas on claude.ai or in the desktop app instead |

In Claude:

| You see | Do this |
|---|---|
| No **Add custom connector**, or Claude says you can't add one yourself | You are on Team or Enterprise. An Owner adds it first: use **Email your IT team** on the setup page |
| Claude will not let you add a second custom connector | The Free plan allows one. Remove the other custom connector, or use Pro or Max |
| "This corporate identity belongs to an Enterprise that manages access through their own Claude account" | Your organization runs Claude Enterprise. Sign in to its Claude, and ask its Owner to add Legallas |
| "Couldn't reach the MCP server" | Check the link reads exactly `https://mcp.room.example.com/mcp`, with no space or slash at the end. Remove Legallas and add it again with the **Add to Claude** button |
| "Authorization with the MCP server failed" | Choose **Connect** again. If it fails twice, send the owner the reference in the error that starts with `ofid_` (it is time-limited, so send it soon) |
| Legallas shows **Connect** or **Reconnect** | Sign-in did not finish, or your 30 days are up. Choose it and sign in |
| Nothing happens when you choose **Connect** | Your browser may have blocked the sign-in window. Allow pop-ups for claude.ai, then choose **Connect** again |
| Claude asks before every look-up | Set **Tool permissions** to **Always allow** (above) |
| "This tool is not enabled for your role. Contact your administrator." | Your organization's Claude Enterprise role blocks it. Ask its Claude Owner |
| No Legallas under **+** > **Connectors** | Check it shows **Connected** under **Customize > Connectors**. In a Team or Enterprise shared project connectors are off; use a private project or a plain chat |
| A tool named in this guide is missing | Try **Disconnect** on Legallas in **Customize > Connectors**, then **Connect** again. If it is still missing, tell the owner |
| "The daily limit for AI tool calls is reached" | Wait until midnight UTC, or ask the owner if you need more |
| "Too many tool calls in one minute" | Wait a minute, then ask again |

## What your IT team does once

Only for Claude Team or Enterprise, where members cannot add custom connectors. An Owner, about two minutes:

1. Open the **Add to Claude for your organization** link (the same button is on the setup page, under Claude >
   For your IT team):
   <https://claude.ai/admin-settings/connectors?modal=add-custom-connector&connectorName=Legallas&connectorUrl=https%3A%2F%2Fmcp.room.example.com%2Fmcp>
   Claude opens **Organization settings > Connectors** with the name and the link filled in.
2. Check that the link reads `https://mcp.room.example.com/mcp`. Keep **Use Claude's published identity
   (Recommended)**, leave the client ID and secret blank, and choose **Add**.
3. Recommended: set the Legallas tools to **Always allow** for members. Every Legallas tool is read-only. On
   Enterprise the Owner's setting is the most a member can choose, so without it each member approves every
   look-up.

By hand instead: **Organization settings > Connectors**, choose **Add**, then **Custom** (if asked for the type,
choose **Web**), paste the link, leave the client ID and secret blank, and choose **Add**.

On Enterprise, a member whose custom role includes **Manage access to Libraries** can add it too. If you use
Enterprise custom roles, check that the members' role does not block Legallas or its tools.

The room's kits for everyone: download the Claude plugin from the setup page, then **Organization settings >
Plugins & skills > Inventory > Add > Upload a plugin**, and set its **Default access**.

Your network needs to let members' browsers reach `mcp.room.example.com` and
`room.cloudflareaccess.com`. For the sign-in code's sender and the allowlist, see [If the sign-in code doesn't arrive](README.md#if-the-sign-in-code-doesnt-arrive). Nothing else is
needed: Claude reaches the room from Anthropic's servers (`160.79.104.0/21`), not from your network.

Adding the connector for the organization does not give anyone access to the room. Each member still signs in with their
own room email, and only room members get through.

## Appendix: technical details

- **Authentication choices.** Claude's dialog may offer **Sign in now**, **Sign in when needed** or **No sign in**,
  then **Use Claude's published identity (Recommended)**, **Register automatically** or **Use your own OAuth
  client**. Keep **Sign in now** and **Use Claude's published identity**. The server reads Claude's client details
  from the Client ID Metadata Document Anthropic hosts, so there is nothing to register and no client ID or secret
  to enter. Claude cannot change these settings after the connector is added; to change them, remove it and add
  it again.
- **Removing it from Claude.** **Customize > Connectors**, select **Legallas**, then **Remove** (Owners use
  **Organization settings > Connectors**). This removes it from Claude only; use the connections page above to end
  it on our side.
- **Claude Code.** A Legallas connector added on claude.ai works in Claude Code when you sign in with your Claude
  account. Adding the server directly in Claude Code (`claude mcp add`) signs in through your own computer, which
  the room refuses by default; ask the owner if you need it.
- **Tokens.** Claude renews its access every hour on its own. The sign-in itself lasts 30 days from the day you
  sign in, however often you use it.

### Sources

Checked 2026-10-02; the install links and menu paths again on 2026-10-20, and every step and error message on
this page on 2026-10-20.

- Anthropic, Directory connectors vs custom connectors (the custom connector install link, for members and for
  Owners): https://claude.com/docs/connectors/building/directory-vs-custom
- Anthropic, Add a connector that isn't in the directory: https://claude.com/docs/connectors/custom/add-unlisted
- Anthropic, Getting started with connectors (Customize > Connectors, Tool permissions, Connect and Reconnect):
  https://claude.com/docs/connectors/getting-started
- Anthropic, Connector troubleshooting (the two error messages and the `ofid_` reference):
  https://claude.com/docs/connectors/building/troubleshooting
- Anthropic, Authentication for connectors (the callback, Client ID Metadata Documents, token refresh):
  https://claude.com/docs/connectors/building/authentication
- Anthropic, Get started with custom connectors using remote MCP (plans, the Free limit, Owners, Team and
  Enterprise, mobile; checked again 2026-10-21): https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Anthropic, Claude for Office, connectors and skills (Word, Excel, PowerPoint and Outlook; a Claude account, not
  Bedrock, Vertex AI or a gateway; checked 2026-10-21): https://claude.com/docs/office-agents/connectors-and-skills
- Anthropic, Use connectors to extend Claude's capabilities (mobile, private projects, the corporate identity
  message): https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities
- Anthropic, When to use desktop and web connectors (every Claude surface):
  https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors
- Anthropic, Manage custom roles on Enterprise plans (the Owner's tool setting as the ceiling, the role message):
  https://support.claude.com/en/articles/13930452-manage-custom-roles-on-enterprise-plans
- Anthropic, Claude Code, use MCP servers from claude.ai: https://code.claude.com/docs/en/mcp
- Anthropic, plugins (Upload plugin, the Owner's Inventory and Default access, a `.zip` for `--plugin-dir`; read
  2026-11-06): https://claude.com/docs/plugins, https://claude.com/docs/plugins/admin,
  https://code.claude.com/docs/en/plugins/loading
- Anthropic, IP addresses (outbound range): https://platform.claude.com/docs/en/api/ip-addresses
- Cloudflare, One-time PIN login (the sign-in messages; the sender and allowlist are in README.md):
  https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
