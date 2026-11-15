# Research chat spike (PR 5a, 2026-10-20)

What the D11 spike found before the research agent (PR 5b) is built. Every run was local: no Workers AI call, no
Legallas data, no remote binding. Versions: `agents` 0.28.1, `@cloudflare/ai-chat` 0.12.1, `ai` 7.0.143,
`workers-ai-provider` 4.0.0; workerd 1.20261019.1 through Miniflare 5.20261019.0-beta (compatibility date 2026-09-30);
the Claude desktop browser pane (Chromium 152); macOS 27.0.1's system WebKit (Safari 27.0.1's engine) in a headless
`WKWebView`.

## 1. A WebSocket under the room's page CSP (`connect-src 'self'`)

A page served with the exact `page` policy from `worker/headers.ts` opened WebSockets to its own origin and, as a
control, to another port.

| Browser | Same origin `ws:` | Other port |
|---|---|---|
| Chromium 152 | opens, echoes | blocked, `securitypolicyviolation` for `connect-src` |
| WebKit (Safari 27.0.1 engine) | opens, echoes | blocked, `new WebSocket` throws `SecurityError` |

So `'self'` covers the room's own WebSocket in both engines (CSP Level 3), and the page CSP needs no change. The test
ran on `http:`/`ws:`; production is `https:`/`wss:`, which `'self'` matches the same way. Safari itself could not be
driven without a screen-access prompt, so WebKit was tested through `WKWebView`.

## 2. A 101 through `withSecurityHeaders`

In workerd the copy `new Response(response.body, response)` keeps status 101 and the `webSocket` (a Response passed as
the init is special-cased), and the echo worked through it. The passthrough in `headers.ts` (a 101 carrying a
`webSocket` is returned untouched; any other response gets the headers) is kept anyway: it no longer depends on that
special case, and a handshake response has no document for the security headers to protect. Proved end to end on the
bundled entry, `worker/entry-pro.ts` (named entry.ts at the time; below).

## 3. glm-5.3-flash function calling through `workers-ai-provider`

A fake `AI` binding replayed GLM-shaped streams through `createWorkersAI({ binding })` and `streamText` with one tool:
the tool ran once with the right input and the second step streamed the answer. `generateText` with the GLM
non-streaming shape (`choices[0].message.tool_calls`) also ran the tool. The stream frames follow the recorded GLM shape
in `worker/ask-stream.test.ts` (OpenAI deltas, `reasoning` and `reasoning_content`, then a Workers AI usage frame with
`response: ""`); the tool-call fragments sit only in `choices[0].delta.tool_calls`. A recorded live tool-call stream
needs one metered call under the orchestrator's eval grant; it is not yet captured.

Since 2026-11-05 the tool steps run on gpt-oss-120b (`LEGALLAS_MODEL`): Workers AI retires glm-5.3-flash on 2026-11-15.
The issue's probe in section 5 lists gpt-oss-120b as unaffected by agents#2482. Its own tool-call stream is not recorded
either; the research replica's first run on it records one.

## 4. Which parameters the provider passes

What reached `AI.run(model, inputs, options)`:

| Asked for | Reaches the binding |
|---|---|
| `maxOutputTokens` | `inputs.max_tokens` (what `worstCaseNeurons` in `budget.ts` reads) |
| `reasoning_effort` in the model settings, `providerOptions['workers-ai'].reasoning_effort`, or the AI SDK's `reasoning` option | `inputs.reasoning_effort` (per call wins over settings) |
| `max_completion_tokens` (any route) | **dropped**: the provider builds `inputs` from a fixed list |

`inputs` always carries the keys `max_tokens, messages, stream, temperature, tool_choice, tools, top_p` (some
undefined). `options` is always `{ gateway: undefined, signal }`, plus any unknown model setting spread in. So 5b's
`meteredAi` must accept a `gateway` key whose value is undefined, refuse any defined value, and forward only `signal`.
Per-step limits therefore go through `maxOutputTokens`; `max_completion_tokens` would need the wrapper to rename it.

## 5. agents#2482 (duplicated streamed tool-call arguments)

Open, still in 4.0.0. The harness reproduces it with the both-fields shape from the issue (Llama 4 Scout): the input
came out as the fragment twice, marked invalid, and the tool never ran. It does **not** hit the GLM shape, which puts
fragments only in the delta; the issue's own probe of 2026-10-04 lists glm-5.3-flash, glm-5.3 and gpt-oss-120b (Ask's
fallback) as unaffected. Recommendation for 5b: tool steps with `generateText` anyway (their text is never shown, the
step's progress is counted by our code, and it stays safe if `LEGALLAS_MODEL` ever moves to an affected model), and
`streamText` only for the final answer. A 5b test should replay the both-fields shape so a provider upgrade is checked.

## 6. The browser client without React

- `AgentClient` from `agents/client` with `basePath` connects to our own path (`threadPath('socket', id)` without the
  leading slash) instead of `/agents/<class>/<name>`; the server routes it itself.
- `WebSocketChatTransport` from `agents/chat/transport` wraps that connection as the AI SDK `ChatTransport`;
  `sendMessages()` returns a `ReadableStream<UIMessageChunk>`. `agents/ai-chat-agent` is a stub that throws: the
  server class lives in `@cloudflare/ai-chat`.
- HTTP fallback: a `fetch` of `RESEARCH_PATHS.turn` returns the UI message stream (SSE of JSON chunks), read with
  `readUIMessageStream` from `ai`.
- Size (esbuild, minified, browser): the WebSocket set (`agents/client` + `agents/chat/transport` + `readUIMessageStream`)
  is about 257 KiB (71 KiB gzip); `ai`'s stream reader alone about 176 KiB (48 KiB gzip). Both must load with a dynamic
  import, after the member turns Research on; or the page reads the chunks itself (they are plain JSON objects).

## 7. Does `agents` need `nodejs_compat`?

The server packages import `node:async_hooks` (agents, `@cloudflare/ai-chat`), `node:crypto` (`agents/sessions`, which
`@cloudflare/ai-chat` imports) and `node:diagnostics_channel` (agents observability), and the email module pulls a bare
`require('path')`. At our compatibility date workerd serves all of them **with or without** the flag: Node
compatibility is on by default from compatibility date 2026-08-04 (`NODEJS_COMPAT_DEFAULT_ON_DATE` in wrangler), so
production legallas-web already runs with it. A real `AIChatAgent` Durable Object constructed and answered in both modes.

The same default copies every var and secret into `process.env` (seen: one text binding appeared there).
`nodejs_compat_do_not_populate_process_env` empties it, with or without `nodejs_compat`. So `wrangler.jsonc` adds:

- `nodejs_compat_do_not_populate_process_env`, the change that matters: Wave 1 adds the `CONTROL_PREFIX` secret, and
  the AI SDK reads `process.env` for its own gateway keys;
- `nodejs_compat`, explicit as in legallas-mcp, so a compatibility-date rollback cannot remove what the SDK needs.

`config.test.ts` pins the list and fails, telling us to drop both Node flags, once the packages stop importing
`node:crypto` and `node:diagnostics_channel`. legallas-mcp has the same date and secrets, so its `process.env` holds them
today; adding the same flag to `wrangler.mcp.jsonc` is the orchestrator's call.

## End to end on the bundled entry

`worker/entry-pro.ts` (then named entry.ts) bundled with esbuild (234 KiB, no agents code yet) ran in workerd with a
SQLite Durable Object, an in-memory D1 holding one owner row and the localhost dev identity:

- `/api/research/probe`: hello from the Worker, 8 pongs, closed 1000.
- `/api/research/probe?via=do`: hello from the Durable Object, 8 pongs, closed 1000.
- a cross-origin upgrade: refused (403, no socket); no upgrade: 426 with the `api` headers.

It found two bugs, both fixed and tested:

- A message still in flight after the last pong made the Worker send on a closing socket, which workerd treats as an
  exception that aborts the socket.
- Left idle, the Worker echo closed at 60 s, but the Durable Object's probe, then on the hibernation API
  (`ctx.acceptWebSocket`), was still open at 70 s: a pending `setTimeout` does not keep a Durable Object with only
  hibernatable sockets awake, so the timer never fired. The Durable Object now answers with the Worker's own echo (a
  plain accepted socket), which closed on time in the rerun.

## For 5b

- **Routing without `agents` in `index.ts`:** `getAgentByName` is `idFromName`, `get`, then the RPC
  `__unsafe_ensureInitialized(props)`. `index.ts` can make that call on the native namespace, and `props` can carry
  the verified identity server-side, so no identity header is needed.
- **Deadlines need alarms:** `AIChatAgent`'s sockets hibernate, and a `setTimeout` does not survive that (above). Close
  the socket at the Access JWT's `exp` with an alarm (`this.schedule`), not a timer.
- **One conversation per `AIChatAgent` instance.** Several threads in the member's Durable Object need sub-agents
  (`subAgent`, facets, addressed under the parent) or threads kept in the agent's own SQLite.
- **Client history:** the WebSocket request frame carries the page's whole message list, and `AIChatAgent` persists
  what it is sent. Read only `questionOf(messages)` and rebuild history from the server's store.
- **Quiet by default, never with text:** set `observability` to undefined (it publishes to `diagnostics_channel`);
  set `static options = { sendIdentityOnConnect: false }` (otherwise the instance name goes to the client and a
  warning is logged); override `onError`, whose default logs the whole error object. `workers-ai-provider`
  `console.warn`s the raw SSE line when a frame does not parse, so the metered stream should drop unparseable frames
  before the provider sees them. (`createAI`, its replacement since #868, has no `console` call in agents 0.31.0.)
- **No gateway by accident:** `ai` resolves a string model id through Vercel's AI Gateway (`@ai-sdk/gateway`,
  installed with `ai`). Always pass a provider's model object, since #868 `createAI`'s from `model.ts` (section 8),
  and pin that with a test.
- **Dependencies:** `agents` declares `@modelcontextprotocol/sdk` 1.32.1 and `@modelcontextprotocol/client` 2.3.1 as
  required peers, so npm installed them (with express and hono). Nothing bundles them unless it imports them.

## 8. The swap to `createAI` (#868, 2026-11-06)

`workers-ai-provider` 4.0.1 is deprecated on npm in favour of `createAI` from `agents/models/ai-sdk`, which `agents`
0.31.0 already ships. The tool steps now call `stepModel` (`model.ts`). Read from the published 0.31.0 source, not run
live:

| Asked for | Reaches `AI.run(model, inputs, options)` below `model.ts` |
|---|---|
| `maxOutputTokens` | `inputs.max_tokens` (kept for `@cf/` models) |
| `providerOptions.cloudflare.reasoningEffort` | `inputs.reasoning_effort` (`'low'` stays `'low'`) |
| createAI's own options, `{ gateway: { id: 'default' }, returnRawResponse: true, signal }` | `{ signal }`, or a two-argument call when there is none (`directOptions`) |
| Any other gateway setting (`id`, `gateway`, `cacheTtl`, `collectLog`, `metadata`) | Refused with `ModelRefused` before anything is held |
| The binding's answer | Wrapped in the `Response` createAI reads (`rawAnswer`); the bindings below still see usage |

createAI names AI Gateway `default` on every call, and AI Gateway would log prompts. `directBinding` drops exactly
that default instead of loosening `forwardedOptions` in `spend.ts`, so quick Ask's metered binding stays as strict.
`providerMetadata.cloudflare.gateway` still says `default`; no gateway handled the call. Tests:
`metered.test.ts`, `tools/images.test.ts`, `steps.test.ts`.
