# Ask's model

Ask (the room's built-in question box) answers with an AI model. This page is for the room's owner: what runs out of
the box, and what changes if you point Ask at an open-weight model on a host you choose.

## Out of the box: gpt-oss-120b in your own Cloudflare account

A new room runs Ask on gpt-oss-120b (`@cf/openai/gpt-oss-120b`, OpenAI's open-weight model) on Workers AI, in the same
Cloudflare account that already holds your documents. You need no other account and no key.

| Model | Ask's default | Its Workers AI page, read 2026-11-05 |
|---|---|---|
| `@cf/openai/gpt-oss-120b` | Since 2026-11-05 | Zero data retention: Yes. No deprecation date. $0.35 and $0.75 per million tokens in and out |
| `@cf/zai-org/glm-5.3-flash` | 2026-10-04 to 2026-11-05 | Planned deprecation 11/15/2026 |

A room still set to `@cf/zai-org/glm-5.3-flash`: set `LEGALLAS_MODEL` to `"@cf/openai/gpt-oss-120b"` in `wrangler.jsonc`
and deploy. Until you do, the room's tests refuse the old model (`worker/ask-config.test.ts`), and once Workers AI retires
it, Ask answers on gpt-oss-120b as its fallback (`worker/ask-model.ts`).

- What leaves the room: nothing new. Each question's passages go to Workers AI inside your own account. Cloudflare
  does not train on Workers AI content and keeps no inputs or outputs after processing, for standard inference
  ([Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)). Ask calls the model
  with no AI Gateway, so no gateway log holds prompts.
- What it costs: nothing by default. Ask uses Workers AI's free daily allowance and stops there, saying so. To let it
  run past the free allowance, set `paidMonthlyUsd` in the room config (and as `ROOM_PAID_MONTHLY_USD` in the Workers'
  `define`) to a monthly amount, such as `"10"`. The spend guard stops at 90% of it (`worker/budget.ts`).
- Setting it up: nothing. `wrangler.example.jsonc` already names the model, and `ASK_GROQ` and `ASK_HOST` ship off.

## Your own choice: an open-weight model on another host

`ASK_HOST` points Ask at any host that serves an open-weight model behind an OpenAI-compatible API
(`POST <url>/chat/completions`). OpenRouter is one example, not a recommendation: check it as below before you use it. When it is on, it answers every Ask question instead of Workers AI.

### What you are choosing

**Your documents go to that host.** For every question, Ask sends the host the passages it found in your documents
(page text), the case picture when there is one, and the question. The host's own rules then decide what happens to
that text: whether it is stored, for how long, who can read it, and whether it trains models. Legallas cannot see or
change those rules. Only you can check them, so the room stays closed until you have.

The room's rules for a host:

- **Open-weight models only.** Closed models reach the room through members' own AI tools (Claude, Microsoft 365
  Copilot, Harvey), never through Ask.
- **Zero data retention (ZDR).** The host, and anyone it passes the text to, may not keep inputs or outputs: not for 30
  days, not for abuse monitoring, not for training.
- **No provider run by a Chinese company or hosted in China.** Chinese open-weight models are fine on other hosts.

### How to check a host's data retention

Read the host's own privacy or data page (not a summary of it) and write down, with the date you read it:

1. Whether it stores prompts and answers at all, and for how long.
2. Whether zero data retention is a setting you must turn on. If it is, turn it on before anything else.
3. Whether it keeps anything for abuse monitoring or safety review, and for how long.
4. Whether it trains models on your data, or lets a provider do so.
5. Who actually runs the model (the host itself, or a provider it routes to), and where.

If any answer is "it keeps it", "it trains on it" or "we could not tell", that host does not meet the bar. Set
`zdr_confirmed` to `true` only when all five say it keeps nothing.

### OpenRouter: one account, many providers

OpenRouter routes each request to one of many providers that serve the model, and each provider has its own data
policy. So checking OpenRouter means checking OpenRouter itself and limiting which providers it may use.

- **OpenRouter itself.** Its docs say it keeps no prompts unless you opt in: input and output logging is off by default
  (in its Observability settings), and so is the separate option to let it use your prompts to improve the product.
  Leave both off.
- **Its one exception.** OpenRouter screens every request, zero-retention ones included, for child sexual abuse
  material in flight. Content flagged as potential CSAM may be kept for human review, reporting and preservation the
  law requires; OpenRouter says this permits no general retention or training. Its pages date this as a planned update
  of 2026-10-27. So question 3 above is not "nothing" on OpenRouter: weigh this before you set `zdr_confirmed`.
- **Zero-retention providers only.** OpenRouter can enforce ZDR for the whole account in its privacy settings; turn that
  on. Legallas also asks for it on every request: on `openrouter.ai`, Ask always sends `provider.zdr: true` (only
  endpoints with a zero data retention policy) and `provider.data_collection: "deny"` (no provider that keeps or trains
  on data), whatever `ASK_HOST.body` says. When no allowed provider serves the model, OpenRouter refuses the request and
  Ask says the model is unavailable. It never falls back to a provider that keeps data.
- **Pin the providers you checked.** On the model's page on OpenRouter, look at each provider's data policy and where it
  runs. Its Zero Data Retention page lists each ZDR endpoint's "Safety Retention"; pin only those that say "No". Then list the ones you accept in `ASK_HOST.body.provider.only` (OpenRouter's provider names) and set
  `allow_fallbacks` to `false`, so OpenRouter never reaches a provider you did not check. Leave out any provider run by
  a Chinese company or hosted in China.
- **A spending limit.** Give the key a credit limit in OpenRouter. Legallas's spend guard covers Workers AI only; the
  daily question cap per member still applies.

Sources: OpenRouter's [Zero Data Retention](https://openrouter.ai/docs/features/zdr),
[Privacy and logging](https://openrouter.ai/docs/features/privacy-and-logging) and
[provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) pages, and its post
[Zero Data Retention: what it means for AI APIs](https://openrouter.ai/blog/insights/zero-data-retention/), read through
a web search on 2026-11-01; its [Data collection](https://openrouter.ai/docs/guides/privacy/data-collection) and Zero
Data Retention pages, read again through OpenRouter's documentation search on 2026-11-06. The pages themselves did not load from the machine this was written on, so read them
yourself before you rely on this section.

### Turning it on

Each step that writes to Cloudflare needs your OK for that exact change (`README.md`, "Cloudflare and Claude").

1. Choose the host and the model, and check them as above. For OpenRouter, turn on its account-wide ZDR setting.
2. Set the key as a Worker secret, never in a file: `npx wrangler secret put LEGALLAS_ASK_HOST_API_KEY`.
3. In `wrangler.jsonc`, describe the host and keep it off:

   ```jsonc
   "ASK_HOST": {
     "enabled": false,
     "zdr_confirmed": true,
     "eval_runs": [],
     "url": "https://openrouter.ai/api/v1",
     "model": "<the host's name for the model>",
     "body": { "provider": { "only": ["<a provider you checked>"], "allow_fallbacks": false } }
   }
   ```

   `url` is the host's https base URL. `body` is optional: extra request fields the host takes. It may not set the
   model, the messages, streaming or the answer length.
4. Run the replica eval on the host (`npm run eval:ask-replica -- --provider host`, reading its key from
   `REPLICA_EVAL_HOST_API_KEY`). It must pass the release gate (`.github/workflows/replica-eval.yml`). A run on another
   model or host does not count.
5. Put the passing run ids in `eval_runs`, set `enabled` to `true`, and deploy.

The room stays on Workers AI until every one of these holds: `enabled`, `zdr_confirmed`, at least one run id in
`eval_runs`, an https `url`, a `model`, the key, and a request that is not local development. When one is missing, the
Worker logs `ask_host_closed` with the reason and answers on Workers AI. Changing `url` or `model` needs a new passing
run.

The Worker checks only that each entry in `eval_runs` looks like a GitHub run id. It cannot see which host or model
that run evaluated, or whether the run passed. So `eval_runs`, like `zdr_confirmed`, rests on your word: list only runs
that passed on this exact `url` and `model`, and clear the list when either changes.

### When it is on

- Every question goes to the host. Groq is never used while the host is on.
- When the host fails or refuses (a 429 included), Ask says the model is unavailable and gives the question back. It
  never answers on another model instead.
- Logs carry `host_http_<status>` and similar words only: never the host's address, its error text, a question or an
  answer.

**To turn it off:** set `enabled` to `false` and deploy. Ask is back on Workers AI at once.
