# Connect Claude Code to your room, with zero retention

Claude Code is Claude in your terminal. Added to the room on your own computer, it can search the room, read pages and cite
them back. Read-only. It is the one Claude setup that can keep nothing, and only under an arrangement with Anthropic.

**The link:** `https://mcp.room.example.com/mcp`

| Your Claude Code runs on | Anthropic keeps | Meets a zero-retention room |
|---|---|---|
| A Claude Enterprise plan, with zero data retention switched on by Anthropic's account team | Inference is not kept | Yes, with the setup below |
| A commercial API key, under a zero-data-retention agreement | Not kept, by that agreement | Yes, with the setup below |
| Any other plan, or claude.ai and the Claude apps | 30 days to 5 years, by plan | No: use [claude-ai.md](claude-ai.md) in a room that allows it |

Two cautions, even under zero retention. Anthropic may keep content its safety systems flag for up to 2 years. And the models it
calls Covered Models need 30-day retention, so do not pick one.

## What you do

Once the room's owner has turned on desktop apps (next section):

1. Check with Anthropic's account team, or your API agreement, that zero data retention is on for your organization.
2. Add the room in Claude Code itself, not on claude.ai:

   ```
   claude mcp add --transport http legallas https://mcp.room.example.com/mcp
   ```

3. Turn off claude.ai connectors in Claude Code, so nothing goes through Anthropic's proxy: set `disableClaudeAiConnectors` to
   `true` in your Claude Code settings, or start it with `ENABLE_CLAUDEAI_MCP_SERVERS=false`.
4. Pick a model that is not a Covered Model.
5. In Claude Code, type `/mcp`, choose **legallas**, then **Authenticate**. Your browser opens the room's sign-in.
6. Sign in with the address your room invitation went to: see [Signing in](README.md#signing-in-the-same-in-every-ai-tool).
7. On the next page, choose **Connect**.
8. Ask in Claude Code, for example "List the room's documents, with their control numbers."

## What the room's owner does once

1. Allow desktop apps: add `http://127.0.0.1` to `MCP_REDIRECT_ALLOW` in the room's MCP settings (`web/wrangler.mcp.jsonc`),
   then deploy. Any program on a member's computer can then start a sign-in, so leave it out until a member needs it.
2. In a room set to zero retention only (`AI_POLICY` set to `"zdr"`, `mcp/retention.ts`): check with the member that steps 1 to 4
   above are done, then add their Claude Code client ID (listed on `/admin/clients` after their first sign-in) to
   `AI_ZDR_CLIENTS` as `member@example.com client-id`, which confirms it for that member only, and deploy. Until then the room refuses it: "the room owner hasn't confirmed this app keeps nothing".

## Good to know

- Read-only: Claude Code can search and read the room, never change, upload or delete anything.
- The connection lasts 30 days. Then run `/mcp` and authenticate again.
- What Claude Code reads goes to Anthropic for inference, under the arrangement in step 1. The room can't see which plan or model you
  use, so the owner relies on your word.

## If something goes wrong

| You see | Do this |
|---|---|
| "App not allowed" | Desktop apps are off for this room. Ask the owner to turn them on (above) |
| "Waiting for the room owner" | This room only connects setups that keep nothing. Ask the owner to confirm yours (above) |
| "This plan can't be zero-retention" | You added the room on claude.ai. Remove it there and add it in Claude Code (step 2) |
| "No access" | Use the address your invitation went to, or ask the owner |
| No code arrives | See [If the sign-in code doesn't arrive](README.md#if-the-sign-in-code-doesnt-arrive) |

## Sources

Anthropic's Claude Code pages, Zero data retention, Data usage, Connect Claude Code to tools via MCP and Network configuration
(the design record `docs/design/ai-connectors.md` section 1 cites each as A4, A7, A11 and A16).
