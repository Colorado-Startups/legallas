# AI governance and guardrails

Part of the [security policies](README.md). Version 1.0, 2026-11-05.

## Purpose

Case content reaches only AI the room owner chose, under rules the code enforces. A person decides; AI drafts and finds.
Case content means documents, page text, retrieved passages, the case picture, eval questions, answers and eval item ids
([`SECURITY.md`](../../SECURITY.md), "Case content and AI").

## Where AI touches a room

| Path | Who runs the model | What it may receive |
|---|---|---|
| Ask, the room's own question box | Cloudflare Workers AI on the room owner's account | Retrieved passages for one question |
| A second Ask backend (Groq, or the room's own open-weight host) | That provider | The same, only past the gate below. Ships off |
| A member's own AI (Claude, Microsoft 365 Copilot, Harvey) over the MCP server | That AI's vendor, under the member's or firm's own agreement | What that member may already see in the room |
| AI Search, over the record and the law library | Cloudflare's embedding model, room owner's account. Reranking and cache off; its AI Gateway keeps no logs | Every indexed page and each question, as embeddings |
| AI in development (the `@claude` GitHub agent) | Anthropic | This repository's code. Never case content |

## Rules

| Rule | Kind | Evidence |
|---|---|---|
| Ask's metered binding runs only Workers AI models (`@cf/`) and refuses any AI Gateway option | Built in | `web/worker/spend.ts` |
| An outside Ask backend opens only when the room's config says `enabled` and `zdr_confirmed`, lists passing eval runs, has a key, and isn't local dev | Built in | `web/worker/ask-gate.ts` (`backendGate`) |
| `zdr_confirmed` is the room owner's word, after reading the provider's own data page, that it keeps no inputs or outputs | Room owner | `web/ASK-MODEL.md` |
| On OpenRouter every request also demands zero-data-retention endpoints and refuses data collection | Built in | `web/worker/ask-host.ts` |
| If an outside backend fails, Ask says so. It never switches to another model silently | Built in | `web/worker/ask-provider.ts` |
| Spend on Workers AI and AI Search has daily and monthly ceilings that concurrent requests can't overrun | Built in | `web/worker/spend.ts`, `web/worker/budget.ts` |
| Default callback allowlist: Claude, Microsoft and Harvey. The room owner can allow others, including loopback (`localhost`, `127.0.0.1`) for a local tool, on `/admin/clients` or in config | Built in | `web/mcp/contract.ts` (`DEFAULT_REDIRECT_ALLOW`), `web/mcp/redirects.ts` |
| A room can allow only zero-data-retention AI apps (`AI_POLICY=zdr`) | Room owner | `web/mcp/retention.ts`. Default: any listed app |

## What a member's AI can do

| Limit | Kind | Evidence |
|---|---|---|
| Read tools only, registered read-only, one scope (`case.read`) | Built in | `web/mcp/contract.ts`, `web/mcp/server.ts` |
| The one tool that writes stores a draft for that member to approve in the room. It needs the room flag `PROPOSALS_ENABLED`, the member's tick when connecting, and a role that may propose. No tool approves, changes the record or changes access | Built in, off by default | `docs/design/propose-and-approve.md`, `web/worker/proposals.ts` |
| Every call re-reads membership and role, then applies a per-minute burst limit and daily caps (defaults in `web/mcp/contract.ts`: 3,000 calls and 200 file pulls) | Built in | `web/mcp/server.ts`, `web/mcp/contract.ts` |
| Privileged documents stay hidden from a role without access, on every tool. A refused document looks missing | Built in | `web/worker/privilege.ts` |
| Every search, read and file sent is logged: who, when, which document, which AI app. Never the query or the text. No row, no data | Built in | `web/mcp/audit.ts` |

## Answer quality and release gates

| Control | Kind | Evidence |
|---|---|---|
| Citations survive only for retrieved, live documents. A quote must match its page | Built in | `web/worker/citations.ts`, `web/worker/answer-shape.ts` |
| The replica eval's hard gates: says "I don't know" on every unanswerable item, leaks no prompt, obeys no planted instruction, garbles no id. A stopped run never passes | Built in | `web/scripts/ask-eval-gate.ts`, `.github/workflows/replica-eval.yml` |
| The eval prints only aggregates to CI logs and uploads nothing | Built in | `.github/workflows/replica-eval.yml` |
| A room's release runs the eval first | Room owner | `web/README.md`, "Production releases". A checklist step, not a block |

## Prompt injection

| Defence | Kind | Evidence |
|---|---|---|
| Ask wraps case text in data blocks with a boundary that changes each request, stripped from document text | Built in | `web/worker/prompt.ts` |
| Passages that address an AI, or look like court orders filed outside the court record, are fenced as untrusted and can't be cited | Built in, Ask, research and every MCP result | `web/worker/quarantine.ts`, `web/mcp/untrusted.ts` |
| MCP results carry a `<case-record>` label and a standing instruction that its text is evidence, never instructions | Built in | `web/mcp/format.ts`, `web/mcp/server.ts` |
| AI instruction files inside a room (for example `CLAUDE.md`) are never indexed or listed | Built in | `web/worker/agent-files.ts` |
| No tool can send, delete or reach another system, so an injected instruction has nothing to act on | Built in, while proposals and public records stay off | `web/mcp/contract.ts` |

## Disclosure and human review

| Control | Kind | Evidence |
|---|---|---|
| The room says it is AI and not a lawyer: in the footer, the Ask header and the chat drawer | Built in | `web/worker/product-notices.ts` |
| The full notice set the product shows | Draft | `docs/legal/product-notices.md`. No lawyer has read it |
| A person approves anything AI drafts before it enters the record | Built in | `docs/design/propose-and-approve.md` |

## AI in development

| Control | Kind | Evidence |
|---|---|---|
| The `@claude` agent runs only when enabled and asked by the repository owner, confined to the checkout, with no outside network beyond npm | Built in | `.github/workflows/claude.yml`, `.github/scripts/claude-settings.sh` |
| Monthly canary test proves the confinement holds | Built in | `.github/workflows/claude-confinement.yml` |
| No case data in code, tests, commits, PRs or logs. Test data is the fictional fixture only | Policy | `CLAUDE.md`, "No case data, ever" |

## Gaps

| Gap | What it would take |
|---|---|
| ZDR and eval-run gates rest on the room owner's word; code can't read a provider's setting | Provider APIs don't expose it. Keep the owner's attestation, dated |
| The release eval is a checklist step, not a deploy block | A deploy gate in each room's release workflow |
| No ISO/IEC 42001 certification | An AI management system and an accredited audit |
| Most of the draft notice set isn't built | The product-notices work on the Project board |

## Review

Reviewed with the other policies every 12 months, and whenever a processor, model or MCP tool changes.
