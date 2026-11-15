# Connect Harvey to the room

Harvey reaches the room through its MCP connectors (**Bring Your Own MCP**). Two steps: a workspace admin enables
the room's server for the workspace once; then each member signs in once with their own room email. Harvey makes
no requests for a member who has not signed in personally.

**The setup page:** `https://mcp.room.example.com/connect` (its Harvey card has the three values below)

**The link:** `https://mcp.room.example.com/mcp`

## What you do

Once your admin has turned it on (next section):

1. In Harvey, go to **Settings > User Settings > Connectors**, find the Legallas connector and choose **Connect**.
2. On the sign-in page that opens, under **Email**, type the exact address your room invitation went to, not an
   alias or forwarding address. Choose **Send login code**, then type the code from your inbox. Ignore the
   **Cloudflare** button; it is for the room's owner.
3. On the next page, choose **Connect** (the button names your AI tool, for example **Connect Harvey**).

Then in **Assistant**, turn the Legallas source on, and ask.

Use Legallas from Harvey on the web or in the Harvey mobile app. Harvey does not document connectors in its Word
or Outlook add-ins.

No code? See [If the sign-in code doesn't arrive](README.md#if-the-sign-in-code-doesnt-arrive) (also on the setup
page, under Signing in).

Harvey shows the control number and page for each passage, with a link that opens that page in the room.

Don't see the Legallas connector under Connectors? Your admin has not added it yet. Send them this page, or the
setup page above.

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

### Disconnect

Open `https://mcp.room.example.com/connections`, sign in with your room email, choose **Disconnect**.
Removing the connector inside your AI tool alone does not end it on our side.

### If something goes wrong

If your connection fails, the owner is alerted and fixes it the same day. Text in quotation marks is exactly what the
sign-in page, the room's page or a tool's answer shows. A company room's own messages say "company room" where these say "counsel room".

| You see | Why | Do this |
|---|---|---|
| "A code has been emailed to you", but no code arrives, or "This One-Time PIN has already been used" | The address is not the one the owner invited, or a mail scanner used the code first | See [If the sign-in code doesn't arrive](README.md#if-the-sign-in-code-doesnt-arrive) |
| "That account does not have access." | The code was mistyped, older than 10 minutes, or replaced by a newer one | Choose **Request new code** and type the newest code |
| "Sign-in works only from the United States." | You are outside the United States, or a VPN or firm network makes it look that way | Turn the VPN off or use a United States network, then start again from **Connect** in Harvey |
| "This room is private." | You signed in another way, for example with the **Cloudflare** button | Choose **Sign out**, start again from Harvey and use **Email** |
| "Sign in first" | The sign-in page was opened directly, not from Harvey | Start again from **Connect** in Harvey |
| "No access": "... which is not a member of the counsel room." | You signed in with an address the owner has not added | Sign in with your room address, or ask the owner to add this one |
| "App not allowed" | Harvey sent a sign-in callback the room does not know yet | The owner fixes it (above); then choose **Connect** again. You can also tell them: email@example.com |
| "This link cannot be used" or "This page has expired" | The sign-in took too long, or was opened twice | Start again from **Connect** in Harvey |
| "App details unavailable", "Connection not made" or "Something went wrong" | A passing fault on the room's side | Wait a minute and start again from **Connect**. If it repeats, tell the owner the time |
| Harvey asks you to connect again | Your 30 days are up, or you disconnected | Choose **Connect** and sign in again |
| "rate_limited: Too many tool calls in one minute." | More than 60 look-ups in a minute | Wait a minute, then ask again |
| "daily_limit: The daily limit for AI tool calls is reached." | 3,000 look-ups today | Wait until midnight UTC, or ask the owner if you need more |
| "not_a_member: This connection no longer has access to the counsel room." | Your room access was removed | Ask the owner |
| Harvey answers without citing the room | The Legallas source is off for this question | In **Assistant**, turn the Legallas source on and ask again |

## What your Harvey admin does once

A Harvey workspace admin, about five minutes:

1. Go to **Settings > Org Settings > Connectors** and add a custom MCP server (**Bring Your Own MCP**) with these
   values:
   - Name: the one on the setup page's Harvey card. It names the room: `Legallas counsel room` for a case room,
     `Legallas company room` for a company room.
   - URL: exactly `https://mcp.room.example.com/mcp`, with no slash at the end (a trailing slash fails Harvey's
     discovery check).
   - Authentication: **OAuth**. Harvey registers itself, so there is nothing to type: no client ID, secret or API
     key.
2. Enable the connector for the room's members (or the whole workspace, if your workspace has no team setting), and
   allow every tool. All are read-only, so allowing them all is safe.

Then each member signs in once, as in "What you do" above.

If Harvey opens the room's sign-in page while you add the server, close it. The room sends a code only to the
people the owner invited, so no code reaches you, and that is expected. Never have a member type their code into your
session: the connection would then belong to your Harvey account. If Harvey will not save the server without that
sign-in, tell the owner; the simplest fix is for a room member who is also a Harvey admin to add it.

### Checklist

- [ ] Your workspace has MCP connectors (**Settings > Org Settings > Connectors** shows an option to add a custom
  MCP server). If not, ask your Harvey account team to switch on custom MCP (Bring Your Own MCP) for the
  workspace, or use the counsel pack (appendix) meanwhile.
- [ ] The URL is exactly `https://mcp.room.example.com/mcp`, ending in `/mcp`, with nothing after it.
- [ ] Authentication is **OAuth**, with the client ID and secret left blank.
- [ ] Nobody but the member themself typed a room code into their Harvey session.
- [ ] The connector is enabled for every room member.
- [ ] Every tool is allowed: `legallas_search`, `legallas_case_overview`, `legallas_list_documents`,
  `legallas_get_document`, `legallas_read_pages`, `legallas_view_visual`, `legallas_get_comments`,
  `legallas_get_file`, `legallas_template` and, when listed, `legallas_search_law`.
- [ ] The addresses below are let through by your web and email filters.
- [ ] One member has connected and asked a question that came back with a control number and page.

Harvey says it does not review a server a firm adds itself (Bring Your Own MCP), and may not ask a user before a
tool changes something. Neither matters here: every tool is read-only, and the owner can send the security brief that
covers this server.

### Let these through

| What | Value | Used for |
|---|---|---|
| Web | `mcp.room.example.com` | The connector (Harvey's servers call it) and the sign-in pages (members' browsers open them) |
| Web | `room.cloudflareaccess.com` | The email-code sign-in page |
| Web | `room.example.com` | The room itself: every cite links here |

For the sign-in code's sender, its sending IPs and the scanner exemption, see
[If the sign-in code doesn't arrive](README.md#if-the-sign-in-code-doesnt-arrive).

### If something goes wrong

Harvey does not publish its connector error messages, so the first column says what to look for.

| Harvey shows | Why | Do this |
|---|---|---|
| A callback or redirect error, or `invalid_redirect_uri`: "This redirect URI is not on the server's list." | Harvey used a sign-in callback outside `harvey.ai` | Nothing to change in Harvey. The server has kept that callback for the owner and emailed them. Tell the owner too (email@example.com); once they allow it, add the connector again |
| `invalid_client_metadata`: "Client metadata is too large." | Harvey sent a client name over 80 characters | Use the name on the setup page's Harvey card and add the connector again |
| `access_denied`: "Dynamic client registration is not open on this server." | The owner has closed self-registration | Ask the owner |
| A "too many requests" error (HTTP 429) | More than 10 registrations a minute from Harvey's address | Wait a minute and add it again |
| The room's sign-in page, and no code arrives | You are adding the server, and only invited members get a code | Close it (see above). Each member signs in from their own account |
| Harvey asks for a client ID and secret | Your workspace offers only a pre-registered client | Email the owner (email@example.com) the callback or redirect URL Harvey shows; they send back a client ID and secret |
| The connector is added but no tools appear | The URL is wrong, or Harvey has not listed the tools yet | Check the URL ends in `/mcp`, with no slash after it. Still nothing: send the owner a screenshot and the time |
| A tool shows as changed or needing review | The owner added or updated a tool | Review and allow it. All are read-only; existing names never change |
| Members do not see the Legallas connector | The connector is not enabled for them | Enable it for the room's members or their group |
| Any other error | Not one this page knows | Send the owner a screenshot and the time; the server logs a code for every refusal |

Turning the connector on does not give anyone access to the room. Each member still signs in with their own room
email, and only people the owner has invited get through.

Harvey's labels may read slightly differently in your workspace; if a step has moved, tell the owner and they will update
this page.

## Appendix: technical details

**What Harvey checks** (Harvey's connector requirements, updated 2026-09-18, which follow the MCP Authorization
Specification of 2025-11-25): OAuth 2.1 with PKCE (S256), HTTPS,
authorization server metadata (RFC 8414) at `/.well-known/oauth-authorization-server` and protected resource
metadata (RFC 9728) at `/.well-known/oauth-protected-resource/mcp`. Dynamic client registration (RFC 7591) is
optional for Harvey; the server offers it at `/register` and also accepts Client ID Metadata Documents, so Harvey
can use either. Harvey's engineering blog names a third way, a client Harvey pre-registers; for that, the owner creates
the client (below). The server takes the `resource` parameter when Harvey sends it and works without it, grants
the one read scope whatever Harvey asks for, rotates refresh tokens, speaks Streamable HTTP (Harvey's partner
standards allow nothing else), and answers Harvey's browser origins with CORS headers.

**Regions.** Harvey's US, EU and Australian workspaces sign in on `app.harvey.ai`, `eu.app.harvey.ai` and
`au.app.harvey.ai`. Harvey's sign-in callback is expected at `https://app.harvey.ai/mcp/oauth/callback`, and at the
same path on the EU and Australian hosts. All three are under `harvey.ai`, so all are already allowed. The
member's own location still matters: the room's sign-in works from the United States only.

**Callbacks.** The server accepts sign-in callbacks only for approved apps. Callbacks on Harvey's own domains
(`harvey.ai` and its subdomains, `https` only) are accepted by default. Any other callback is refused, kept on
the owner's `/admin/clients` page for 14 days and emailed to them (once per new host). That happens whether Harvey
registers itself (`/register`) or identifies itself another way and the callback first shows up at sign-in.
They allow it there with one click; it takes effect at once, with no redeploy and no change on the firm's side.

**What Harvey receives.** Text only, in each tool's standard size: up to 20 pages or 60,000 characters of page
text per read, and up to 100 rows per list, each with a cursor for the rest. Harvey passes tool results to its
model as plain text, which is what the server sends first; the same fields also go as structured content, so a
result is about 130 KB for ordinary text and under 200 KB at most. `legallas_get_file` returns a file's facts and
points to `legallas_read_pages` for its text; Harvey is never sent file bytes or a download link.

**Tool names are stable.** For connectors it reviews, Harvey pins each tool's description and input schema and
flags any change when it lists the tools; it does not say whether it does the same for a server a firm adds
itself. Either way, the names stay fixed: `legallas_search`, `legallas_case_overview`, `legallas_list_documents`,
`legallas_get_document`, `legallas_read_pages`, `legallas_view_visual`, `legallas_get_comments`, `legallas_get_file`,
`legallas_template` and `legallas_search_law`. A tool the owner adds later may need the admin's approval in Harvey before members can use
it; an existing name never changes.

**Turning it off.** A member disconnects under **Settings > User Settings > Connectors**, and on the connections
page above: Harvey deletes its own copy of the connection but does not tell the server. An admin turns the
connector off for everyone under **Settings > Org Settings > Connectors**, or turns off a single tool.

**Data.** Harvey says its own controls end where a request leaves Harvey, treats what a connector returns as the
firm's customer data, does not train on it, and requires zero data retention from its model providers, with
processing in the US, the EU and Switzerland, or Australia as the workspace is set up. Disconnecting does not
delete what the server already returned to Harvey.

**What Harvey does not publish, and how this setup copes.**

| Not published | How it is covered |
|---|---|
| The exact sign-in callback, per region | Expected at `/mcp/oauth/callback` on each region's host (Regions, above). Every `https` callback on `harvey.ai` is allowed; any other is kept for the owner to allow |
| Whether custom MCP is on for every workspace | If the option is missing, the Harvey account team switches it on (Checklist) |
| Connectors in Harvey's Word and Outlook add-ins | Not documented; members use Harvey on the web or the mobile app |
| Whether a firm can use Harvey's own registration, a metadata document or a pre-registered client | The server accepts the first two with nothing to type; the owner issues the third on request |
| Result size, time and tool-count limits | Results stay under 200 KB, with cursors for more, and there are ten tools. If a long read times out, ask for fewer pages at a time |
| Connector error messages | The tables above go by what to look for; the server logs a code for every refusal, so the owner can match a screenshot and a time |
| Whether the admin must sign in while adding the server | Covered under "What your Harvey admin does once" |

### For the owner: allowing a Harvey callback that is not on the list

1. You get an email, "Legallas: an AI app sign-in callback was refused", naming the callback (one email per new
   host), or the firm tells you Harvey reported a callback or redirect error.
2. Open `https://mcp.room.example.com/admin/clients` and sign in.
3. Under **Sign-in callbacks waiting for approval**, find the callback. Allow it only if the firm's Harvey admin
   confirms it is Harvey's (in writing, from the firm's own address); otherwise choose **Dismiss** and ask.
4. Choose **Allow**. It takes effect at once.
5. Tell the firm to try again: the admin adds the connector again, or the member chooses **Connect** again.
6. Not on the list? Waiting callbacks are kept for 14 days, at most 20 at a time. Ask the firm to try once more,
   so it is kept again, then reload the page.
7. To undo it later, choose **Remove** under **Allowed callbacks**. New sign-ins through it stop.

A connection through an allowed callback outside `harvey.ai` works the same, with smaller results (25 items and
about 9,000 characters each, with cursors), because the server cannot tell it is Harvey.

**If Harvey asks the firm for a client ID and secret** (a pre-registered client instead of registering itself):

1. Ask the firm's Harvey admin for the callback (redirect) URL Harvey shows for it.
2. If it is on `harvey.ai`: on `/admin/clients`, under **Add a client**, name it `Harvey, <firm>` and paste the
   callback. Copy the secret it shows once, and send the ID and secret to that admin only, the secret by a
   different route than the email (a call, say).
3. If it is not on `harvey.ai`: this page cannot take it, because it accepts only callbacks already allowed and a
   client that does not exist yet leaves nothing to keep. Adding it to `MCP_REDIRECT_ALLOW` in
   `wrangler.mcp.jsonc` takes a pull request and a release.

### The fallback: the counsel pack in Vault

If your firm does not use MCP connectors, the owner can send the **counsel pack**: a copy of the room's documents (the
original files) with an index (`INDEX.csv`) and a `README.txt`.

- **Loading it.** Upload the whole folder to a Vault project, keeping its structure and including `INDEX.csv` so
  answers match control numbers. Or, if the owner delivered it to a SharePoint, Box, Google Drive or iManage folder
  your firm owns, let the Vault project sync from that folder (one way, from the folder into Vault). Either works.
- **Size.** A Vault project holds up to 100,000 files or 100 GB; the counsel pack fits well within that.
- **It is a snapshot.** New documents in the room do not appear in Vault until the owner sends an updated pack. When
  the two disagree, the room is right.
- **It is your copy.** Once loaded, the pack falls under your firm's retention and Harvey agreements, not the
  room's. The owner's activity log does not see what happens to it.

### Sources

Harvey's pages were read signed out on 2026-10-20. Harvey's customer article on MCP connectors, its release note
details and its trust-center "MCP Client Security" document need a Harvey sign-in or an access request, so what
they say is not reflected here; a firm's Harvey admin can read them. The expected callback path, the trailing-slash
check and the account-team step come from research on 2026-10-21, not from Harvey's public pages (checked the
same day); a firm's Harvey admin can confirm them.

- Harvey, Connecting MCP Servers to Harvey (Bring Your Own MCP; requirements; per-user sign-in; disconnecting),
  updated 2026-09-18, accessed 2026-10-20 and 2026-10-21: https://help.harvey.ai/articles/joining-harvey-mcp-connector-library
  (EU copy, the same text: https://eu.help.harvey.ai/articles/joining-harvey-mcp-connector-library)
- Harvey, How we built Harvey's connector library (registration paths, plain-text results, tool pinning),
  2026-10-01, accessed 2026-10-20: https://www.harvey.ai/blog/how-we-built-harvey-connector-library
- Harvey, Building Harvey's MCP policy engine, 2026-10-07, accessed 2026-10-20:
  https://www.harvey.ai/blog/building-harveys-mcp-policy-engine
- Harvey, MCP Security and Technical Standards for partners (Streamable HTTP only), updated 2026-09-23, accessed
  2026-10-20: https://trust.harvey.ai/?itemUid=ae19b8e8-cd83-43e6-95ee-3f703da34532
- Harvey, Security (no training, zero data retention, regions), accessed 2026-10-20: https://www.harvey.ai/security
- Harvey, region menu (app.harvey.ai, eu.app.harvey.ai, au.app.harvey.ai), accessed 2026-10-20:
  https://www.harvey.ai/platform/ecosystem
- Harvey, MCP Connectors in Harvey (needs a Harvey sign-in): https://help.harvey.ai/articles/mcp-connectors
- Harvey release notes, Connectors on Mobile (connectors in the Harvey mobile app), 2026-09-30; the listing is
  public, the note needs a Harvey sign-in; accessed 2026-10-21: https://help.harvey.ai/release-notes/connectors-on-ios
- Harvey, Vault, checked 2026-10-02: https://help.harvey.ai/articles/vault
- Harvey release notes, Increased Vault project limits, checked 2026-10-02:
  https://help.harvey.ai/release-notes/increased-vault-project-limits
- Cloudflare, One-time PIN login (the messages above), accessed 2026-10-20:
  https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
