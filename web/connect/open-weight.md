# Connect an open-weight model to your room

An open-weight model reaches the room through **OpenCode**, a free AI app for your computer. The model can run on your own
computer, or on a host such as OpenRouter. OpenCode signs in to the room as you, then the model can search the room, read
pages and cite them back. Read-only.

**The setup page:** `https://mcp.room.example.com/connect` (its OpenCode card has the config and the skill folder)

**The link:** `https://mcp.room.example.com/mcp`

| Your model runs | What leaves your computer | Good for |
|---|---|---|
| On your computer (LM Studio) | Only OpenCode's calls to the room | The most private; needs 16 GB of memory |
| On OpenRouter | Your questions and what the room returns, to OpenRouter and the model's host. Zero retention there has one exception, below | Any computer |

Only open-weight models, such as NVIDIA's Nemotron, OpenAI's gpt-oss, Google's Gemma or Meta's Llama. The only closed models
allowed are Claude, Copilot and Harvey, so never GPT, Gemini or Grok. The room can't check this for you: once desktop apps are
on, it can't see which model a desktop app runs, and an app's name proves nothing. You choose the model, as below.

## Before you start

- **OpenCode**, from <https://opencode.ai>, the desktop app or the terminal app.
- **An open-weight model in it.** On OpenRouter, in privacy settings (<https://openrouter.ai/settings/privacy>): turn on
  every **Zero Data Retention** toggle, one per model group, and set **Allowed providers** to BaseTen only. Then in
  OpenCode type `/connect`, pick **OpenRouter** and paste your OpenRouter key. With LM Studio instead, install it,
  download a model, and add it as OpenCode's providers page says (<https://opencode.ai/docs/providers/>).

## What you do

Once the room's owner has turned on desktop apps (below). The setup page's OpenCode card has the config with your
room's link:

1. Save this as `~/.config/opencode/opencode.json`, never in a project folder, whose config would override it. It pins
   the model and its host before anything reaches the room:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "share": "disabled",
     "enabled_providers": ["openrouter"],
     "model": "openrouter/nvidia/nemotron-3-ultra-550b-a55b",
     "small_model": "openrouter/nvidia/nemotron-3-ultra-550b-a55b",
     "provider": {
       "openrouter": {
         "whitelist": ["nvidia/nemotron-3-ultra-550b-a55b"],
         "models": {
           "nvidia/nemotron-3-ultra-550b-a55b": {
             "options": {
               "provider": { "order": ["baseten/fp4/us"], "allow_fallbacks": false, "zdr": true, "data_collection": "deny" }
             }
           }
         }
       }
     },
     "mcp": {
       "legallas": { "type": "remote", "url": "https://mcp.room.example.com/mcp", "oauth": {} }
     }
   }
   ```

   Then, before the room is connected, ask OpenCode one test question, such as "Say hello", and open OpenRouter's
   **Activity** page. Only BaseTen should appear. If any other host does, stop and check "Before you start" and this
   block.
2. In a terminal, run `opencode mcp auth legallas`. On the sign-in page your browser opens, under **Email**, type the
   exact address your room invitation went to. Choose **Send login code**, then type the code from your inbox.
3. On the next page, choose **Connect**.

Then ask in OpenCode, for example "List the room's documents, with their control numbers."

The block above runs NVIDIA's open-weight Nemotron 3 Ultra on BaseTen's US endpoint, and nothing else. `enabled_providers` and
`whitelist` leave OpenCode that one model. `small_model` makes OpenCode's chat titles use it too: otherwise OpenCode picks a small
model of its own, such as Gemini Flash, and the title request carries your first question. `order` with `allow_fallbacks: false`
keeps OpenRouter on that endpoint, and `zdr` and `data_collection` refuse any host that keeps or trains on what it reads. One
exception, zero retention included: OpenRouter screens every request for child sexual abuse material, and may keep flagged
content for review, reporting and what the law requires (its [Data collection](https://openrouter.ai/docs/guides/privacy/data-collection)
page, read 2026-11-06). The
Allowed providers setting holds even if the config changes. OpenRouter's zero-retention list includes hosts run by Chinese
companies or hosted in China, so for another model keep all of these and pin a host that isn't. With LM Studio, put `lmstudio` in
`enabled_providers`, set `model` and `small_model` to your local model, and leave out the `provider` block. `"share": "disabled"`
stops OpenCode's `/share`, which would put a whole chat, room text included, on a public link.

## The room's kits

Six kits run over the room: matter board, review grid, cite check, chronology, entity-choice matrix and deviation board.
OpenCode picks them up as one skill folder, `legallas`. Download it from the setup page's OpenCode card
(`https://mcp.room.example.com/connect/legallas-skill.zip`) and unzip it into `~/.agents/skills/` (every project) or
`.agents/skills/` in one project; `~/.claude/skills/` works too. Then ask for a kit by name, for example "Build a
matter board from the room." The same folder is in the Legallas repository at `web/connect/skill/legallas/`.

## What the room's owner does once

1. Allow desktop apps: add `http://127.0.0.1` to `MCP_REDIRECT_ALLOW` in the room's MCP settings (`web/wrangler.mcp.jsonc`),
   then deploy. Any program on a member's computer can then start a sign-in, so leave it out until a member needs it.

In a room set to zero retention only (`AI_POLICY` set to `"zdr"`, `mcp/retention.ts`), also confirm each member: check with
them that their setup matches "Before you start" and step 1 above, then add their OpenCode client ID (listed on
`/admin/clients` after their first sign-in) to `AI_ZDR_CLIENTS`, and deploy. Until then the room refuses it: "the room owner
hasn't confirmed this app keeps nothing".

## Good to know

- Read-only: the model can search and read the room, never change, upload or delete anything.
- The connection lasts 30 days. Then run `opencode mcp auth legallas` again.
- What your model reads goes where the model runs, under that host's terms. With LM Studio it stays on your computer.

## If something goes wrong

| You see | Do this |
|---|---|
| "App not allowed" | Desktop apps are off for this room. Ask the owner to turn them on (above) |
| "Waiting for the room owner" | This room only connects setups that keep nothing. Ask the owner to confirm yours (above) |
| "No access" | Use the address your invitation went to, or ask the owner |
| "This page has expired" | Run `opencode mcp auth legallas` again and finish within 10 minutes |
| No code arrives | See [If the sign-in code doesn't arrive](README.md#if-the-sign-in-code-doesnt-arrive) |

## Sources

Read 2026-11-02: OpenCode, MCP servers (the remote server block, OAuth on a 401, `opencode mcp auth`):
<https://opencode.ai/docs/mcp-servers/>; OpenCode, providers (`/connect`, `/models`, LM Studio):
<https://opencode.ai/docs/providers/>. The callback (`127.0.0.1:19876`) and `share`: OpenCode's config schema,
<https://opencode.ai/config.json>, read 2026-10-31 for `docs/design/ai-connectors.md`; `small_model`, `enabled_providers` and
`whitelist`: <https://opencode.ai/docs/config/>, read 2026-11-02. OpenRouter, read 2026-11-02: zero data retention, one toggle
per model group, <https://openrouter.ai/docs/guides/features/zdr>; provider selection (`order`, `allow_fallbacks`, `zdr`,
`data_collection`, endpoint slugs such as `baseten/fp4/us`, and the account-wide allowed providers as a ceiling),
<https://openrouter.ai/docs/guides/routing/provider-selection>. OpenCode, Agent Skills (the six folders it searches, a
folder per skill with its `SKILL.md`), read 2026-11-06: <https://opencode.ai/docs/skills/>.
