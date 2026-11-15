# Use your AI tool with the room

The room has a secure link for AI tools. Add it once, and Claude, Microsoft 365 Copilot or Harvey can search the
documents, read pages and cite them back to the room. So can OpenCode with an open-weight model. You keep working in
the tool you already use. Your AI reads the room live, read-only, signed in as you.

**The setup page:** `https://mcp.room.example.com/connect` (the same steps as these guides, on one public
page your IT team can open too)

**The link:** `https://mcp.room.example.com/mcp`

## Connect your AI

Every invitation links straight to the setup page, set for the reader: founders and investors see Claude, Copilot and
OpenCode; counsel see Harvey too. Each card has one button or copy-paste, the room's link already in it.

| AI | The card gives | You | Once, by | Guide |
|---|---|---|---|---|
| Claude | **Add to Claude**, and the Claude plugin with the kits | 4 steps | | [claude-ai.md](claude-ai.md) |
| Microsoft 365 Copilot | The agent, for your IT team to upload | 4 steps | Your IT team, 3 steps | [copilot.md](copilot.md) |
| Harvey | The Bring Your Own MCP values, for your Harvey admin | 3 steps | Your Harvey admin, 2 steps | [harvey.md](harvey.md) |
| OpenCode | The config, and the skill folder with the kits | 3 steps | The owner, 1 step | [open-weight.md](open-weight.md) |
| None of these, or your firm says no | Ask the owner for the **counsel pack**: a copy of the documents in a folder your firm chooses | | | |

The invitation links: `https://mcp.room.example.com/connect?for=founder`, `?for=counsel` or `?for=investor`.

## Ask your AI for a kit

Name one, for example "Build a matter board from the room.": matter board, review grid, cite check, chronology,
entity-choice matrix, deviation board. Every answer carries the document's control number, page and a link that opens
that page in the room.

Anthropic's legal plugins read the room too: counsel's litigation skills, and investors' diligence skills with the room
as the data room. Which tool each skill reads: [claude-ai.md](claude-ai.md#anthropics-legal-plugins-reading-the-room).

For your company's or firm's security review: [security-brief.md](security-brief.md), also served with the room's own names at `/security` beside `/connect`.

## Signing in (the same in every AI tool)

1. Your AI tool opens a sign-in page. Under **Email**, type the exact address your room invitation went to, not
   an alias or forwarding address. Ignore the **Cloudflare** button; it is for the room's owner.
2. Choose **Send login code**, then type the code from your inbox.
3. On the next page, choose **Connect** (the button names your AI tool, for example **Connect claude.ai**).

Access is yours alone: nobody else can use your connection, and there are no shared passwords or keys.

Any message on the way: the setup page's **If something goes wrong** section
(`https://mcp.room.example.com/connect#help`) says what to do; the Claude guide has more detail.

### If the sign-in code doesn't arrive

- Use the exact email address your room invitation went to. For any other address no code is sent, even though
  the page says one was.
- The code comes from `noreply@notify.cloudflare.com` (Cloudflare, which runs the sign-in). Check your junk or
  quarantine folder.
- A code works once, for 10 minutes. If the page says it was already used or has expired, request a new code.
- Ask your IT team to allowlist `noreply@notify.cloudflare.com` (domain `notify.cloudflare.com`, sending IPs
  104.30.16.2 to 104.30.16.7) and to exempt it from link rewriting or scanning: a scanner that opens the message
  first can use up the code.

The setup page has the same list under the same heading: `https://mcp.room.example.com/connect#sign-in-code`.

## Good to know

- Read-only: your AI tool can search and read the room, including the visuals, the comment threads and, for apps
  that accept them, small original files. It cannot change, upload or delete anything.
- The connection lasts 30 days. Then your tool asks you to sign in again with a new code.
- Sign-in works from the United States only.
- Each member has 3,000 AI look-ups a day. The count resets at midnight UTC.
- The owner sees which documents were opened and through which AI tool, never what you asked.
- What your AI tool reads goes to your organization's AI provider under its agreement with them, the same as a
  document you paste in.

## What each AI keeps

A zero-retention room refuses the apps marked No and holds the rest until the owner confirms them. The Claude Code setup that keeps nothing: [claude-code.md](claude-code.md).

| AI | Provider keeps | Zero-retention room |
|---|---|---|
| Claude apps | 30 days to 5 years; Enterprise: indefinitely | No |
| Claude Code, zero retention | Nothing | Yes |
| Microsoft 365 Copilot | Your mailbox | No |
| Harvey | Your firm's policy | Partly |
| OpenCode, open weights | Nothing | Yes |

## Disconnect

Open `https://mcp.room.example.com/connections`, sign in with your room email, choose **Disconnect**.
Removing the connector inside your AI tool alone does not end it on our side.

When the owner removes you from the room, every connection you made stops at the same moment.

## Who to contact

The room's owner: reply to the email that invited you to the room. For security questions,
your IT team can write to email@example.com.

## Appendix: what your AI tool gets

Nine tools, all **read-only**. They can look, including at comment threads; they cannot change, upload, delete or
post anything. A room that turns proposals on adds one tool, `legallas_propose_draft`, for a connection its member
lets propose: it stores a draft that changes nothing until that member approves it in the room. The names stay fixed, because Harvey and others review each tool once and expect it not to change.

| Tool | What it does |
|---|---|
| `legallas_search` | Finds passages across every document and visual, by meaning and keywords |
| `legallas_case_overview` | The case picture the room publishes, in full: tracks and violations with their proof, key exhibits and drafts, then parties, people, chronology, claims and money facts, with citations |
| `legallas_list_documents` | Lists the documents, 100 at a time (25 in Microsoft 365 Copilot), or those new since a date |
| `legallas_get_document` | One document's details: control number, title, folder, pages, dates |
| `legallas_read_pages` | Reads the text of up to 20 pages of one document at a time |
| `legallas_view_visual` | One of the room's visuals (charts and diagrams) as text (and, for Claude, an image of the page); with no name, the visuals' table of contents |
| `legallas_get_comments` | The comment threads on a document, as you see them in the room |
| `legallas_get_file` | One original file: to Claude as the file itself when it is a PNG, JPEG or WebP file of up to about 75 KB (images also at most one megapixel); otherwise its details and where to read its text |
| `legallas_search_law` | Searches the room's library of public law (statutes, rules, jury instructions and cases), with official links |
| `legallas_template` | Lists the template library (formation, raise and investor templates), or returns one template's text, a part at a time |

The tools return text. When Claude asks for one document's original file, it can receive the file itself if it is
a PNG, JPEG or WebP file of up to about 75 KB (images also at most one megapixel), and an image of a
visual's page; other AI tools, and any other file (GIFs included), get the text instead. Each member can pull at most 200 files and visual images a day
(UTC) across all AI tools; past that, text only. No download link is ever handed out, and every file or image sent
is logged. If a document contains text that looks like a command, your AI tool is told to treat it as evidence,
not to act on it.

Sources, checked 2026-10-02; Harvey and Anthropic again on 2026-10-20:

- Harvey, Connecting MCP Servers to Harvey: https://help.harvey.ai/articles/joining-harvey-mcp-connector-library
- Microsoft, Copilot Studio, the Teams Developer Portal OAuth client registration and declarative agents: see
  [copilot.md](copilot.md)
- Anthropic, Directory connectors vs custom connectors (the install links):
  https://claude.com/docs/connectors/building/directory-vs-custom
- Anthropic, Add a connector that isn't in the directory: https://claude.com/docs/connectors/custom/add-unlisted
- Cloudflare, One-time PIN login (the sign-in code's sender, IPs, single use and 10 minutes; read 2026-10-20):
  https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- Anthropic, the Claude steps and messages (checked 2026-10-20): see [claude-ai.md](claude-ai.md), "Sources"
- claude.ai itself, in the live test as test counsel (2026-10-20): the prefilled dialog's external-link warning
  and **Continue** button (Anthropic's docs still say **Add**), and two messages the setup page quotes that
  Anthropic does not document, "A connector with this URL already exists in your organization." and "This
  connector has no tools available." (gone after a reload)
