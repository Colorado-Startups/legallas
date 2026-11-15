# AI risk assessment and model card

Part of the [security policies](README.md). Version 1.0, 2026-11-05. Supports [AI governance](ai-governance.md).

## AI systems in the product

| System | What it does | Model | Default |
|---|---|---|---|
| Ask | Answers a member's question from the room's documents, with citations | Workers AI, `LEGALLAS_MODEL` | On |
| AI Search, record and law | Embeds every indexed page and each question; retrieves passages | Cloudflare's embedding model, room owner's account. Reranking and cache off; AI Gateway logs off | On (`LAW_LIBRARY` for law) |
| Research chat | Multi-step research with tools, under the member's role | Workers AI | Off (`RESEARCH_ENABLED`) |
| MCP connector | Lets a member's own AI read the room | None. The member's AI runs elsewhere | On |
| Proposals | A member's AI drafts; the member approves in the room | The member's own AI | Off (`PROPOSALS_ENABLED`) |
| Replica eval | Tests Ask's answers before a release | Same as Ask | Run by hand |

## Model card: Ask

| | |
|---|---|
| Default model | `@cf/zai-org/glm-5.3-flash` on Cloudflare Workers AI. Open weights from Z.ai. Cloudflare lists it for deprecation on 2026-11-15 ([its page](https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/), read 2026-11-05), so the default moves before then |
| Fallback | `@cf/openai/gpt-oss-120b`, open weights from OpenAI, kept for rollback. No deprecation date listed |
| Why this model | The replica eval of 2026-10-04 scored it 20 to 21 of 22, against 18 to 19 for the fallback, at under half the cost (`web/worker/ask.ts`) |
| Where it runs | Cloudflare Workers AI in the room owner's account. No AI Gateway for generation; AI Search attaches one with logs off |
| Inputs | The member's question and retrieved passages, in data blocks |
| Outputs | An answer with citations to document and page, or "I don't know" |
| Not for | Legal advice, filings without review, decisions about a named person |
| Training and retention | Cloudflare doesn't train on Workers AI inputs or outputs, and keeps none after the request ([Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/), read 2026-11-05) |
| Known limits | Can misread a document or miss a rule. Citations are checked against retrieved pages, but meaning isn't |
| Change rule | A model change needs a passing replica eval and an entry in `REASONING_EFFORT` (`web/worker/ask.ts`) |

A room owner who limits models to particular vendors sets `LEGALLAS_MODEL` to the fallback.

## Risks

Likelihood and impact on a three-step scale: low, medium, high. Residual is after the controls.

| Risk | Likelihood | Impact | Controls | Residual |
|---|---|---|---|---|
| An answer invents a citation or misstates a document | Medium | High | Only retrieved, live citations survive; quote matching; "I don't know" gate in the eval; the AI notice | Medium |
| A document carries instructions that steer the AI | Medium | High | Data blocks with a per-request boundary; untrusted-passage quarantine in Ask and MCP results; no tool can act outside the room | Low |
| Case content reaches a processor that keeps it | Low | High | Workers AI only by default; outside backends need ZDR, evals and a key; spend binding refuses other models | Low |
| A member's AI vendor keeps what it read | Medium | Medium | Outside the product: the member's or firm's own agreement. Audit log shows what was read | Medium |
| Privileged material reaches the wrong role | Low | High | Privileged paths hidden on every route and tool; refused documents look missing | Low |
| A user relies on an answer as legal advice | Medium | High | "AI, not a lawyer" notice; answers cite sources to check; the full notice set is still a draft | Medium |
| The model decides whether to hire, fire, discipline, promote, pay, lend to, rent to or deny credit to a named person | Low | High | Out of intended use; A4's guard in Ask, the connector and the Copilot agent, scored by `web/scripts/ask-eval.people.json` | Medium |
| A model change lowers quality | Medium | Medium | Replica eval hard gates before release; rollback model kept | Low |
| The provider retires the model | High | High | Watch each model's Workers AI page for a deprecation date; keep a tested fallback with its own settings | Medium |
| AI spend runs past the free allowance | Low | Low | Daily and monthly ceilings in the metered binding | Low |

## Frameworks this answers

| Framework | Where |
|---|---|
| NIST AI RMF 1.0: Govern, Map, Measure, Manage | Govern: [AI governance](ai-governance.md). Map: the systems table. Measure: the replica eval. Manage: the risks table |
| ISO/IEC 42001 Annex A: impact assessment, life cycle, data, information for users | This file and [the control map](control-map.md). Not certified |
| ABA Formal Opinion 512 | The connector's security brief, `web/connect/security-brief.md` |

## Review

Every 12 months, and before any change of model, processor or AI feature default.
