# The live sample room

The fictional room on real Cloudflare, so the Data room page can measure real speed, real AI search, real Ask and real sign-in. Invented data only, on Colorado Startups' own account. `run.ts` deploys and syncs, and does nothing when nothing changed. The `live-room` job in `.github/workflows/quality-speed.yml` runs it on main's daily and manual runs; a person can too: `node quality-speed/pages/data-room/live/run.ts --out <dir>`.

**What turns the job on (#905).** A job's `if` can't read an environment's variables or secrets. So `live-room-ready` reads the three names below in a step, as true or false only, and `live-room` starts on its answer. The jobs against the room, `law-eval` and `live-journeys`, start the same way on `live-room`'s `up`, set when `live-room.json` holds the room's address. `live.test.ts` pins all three.

| Name, in the `quality-speed` environment | Kind |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Variable |
| `LIVE_ROOM_CLOUDFLARE_TOKEN` | Secret |
| `SAMPLE_ROOM_TEST_LOGIN_SECRET` | Secret |

| What happens | The job | The run |
|---|---|---|
| A name is missing | Skipped; a warning names what's missing | Green |
| `run.ts` stops on a person's step: R2 not on, no Zero Trust organization, no AI Search instance | A warning names the step (`PersonStep`) | Green |
| `run.ts` stops on anything else, a missing token permission included | Fails | Red |
| `run.ts` deploys, or finds the room current | Writes `live-room.json`; `up` starts `law-eval` and `live-journeys` | Green |

After the first deploy, a person proves the spend guard on the room (What it costs).

**`run.ts` has met Cloudflare twice (7 Nov).** Its pure parts and the whole test login are tested in `live.test.ts`.

| Run | Got through | Stopped at |
|---|---|---|
| 1 | The checks | The first R2 call: no R2 plan. Now a person's step |
| 2 | Buckets, D1, the test login, Access, the sync, the build | The connector's deploy: no AI Search instance. Its error kept only wrangler's footer, so it failed the job; it now keeps the `[ERROR]` lines |

**It stops rather than touch a real room.** D1 `legallas` and the buckets `legallas-files` and `legallas-index` are the names every room uses, so before it adopts them it reads the `members` table and stops on any address outside `@example.test`, or on room buckets with no database. It also stops if `web/` holds a room's settings.

## The Cloudflare token

Secret `LIVE_ROOM_CLOUDFLARE_TOKEN`, key `api-key-cloudflare-live-room`, an account-owned token on Colorado Startups' account, expiring in at most 90 days.

| Permission (Account) | Level | What `run.ts` uses it for |
|---|---|---|
| Workers Scripts | Edit | Create and deploy the three Workers, set their secrets, read or make the workers.dev subdomain |
| D1 | Edit | Create the database, apply migrations, add the invented members, sync |
| Workers R2 Storage | Edit | Create the two buckets, sync the documents and their text |
| Workers KV Storage | Edit | Create the connector's OAuth namespace |
| Account Analytics | Read | The sync's spend check reads this month's AI Search use |
| Access: Apps and Policies | Edit | The room's and the connector's sign-in apps |
| Access: Organizations, Identity Providers, and Groups | Edit | Read the team name, add the test login as a login method |
| Workers AI | Read | Not `run.ts`: the `law-eval` job in `quality-speed.yml` and the people eval (`people-eval.yml`, #785) answer on this account's free neurons. D1 Edit and Account Analytics Read above also serve their spend lease |
| AI Search | Read, Run | Not `run.ts`: the people eval searches the room's instance, `legallas`, through the REST API. Without it the gate reads `search_http_403` |

Cloudflare is renaming these. Where the token page offers **Workers: Admin**, pick that over Workers Scripts: Edit, because its docs say the newer `Editor` role can't create a Worker, and the first deploy creates three. After the first deploy, move the token to `Editor` on just those three Workers, because the same docs say only creating a Worker needs `Admin`.

**Not needed:** any zone permission, since the room is on workers.dev with no domain. AI Search Edit, because the sync tolerates a failed job and the instance re-reads its bucket by itself. AI Gateway, Account API Tokens, Access service tokens, and any user-level permission.

This link opens the token page with all of it filled in, apart from the expiry, Workers AI and AI Search: add **Workers AI: Read**, **AI Search: Read** and **AI Search: Run** on the page:

```text
https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22access%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22access_acct%22%2C%22type%22%3A%22edit%22%7D%5D&name=api-key-cloudflare-live-room
```

If a run says a permission is missing, edit the same token on that page and add it. Its value doesn't change, so nothing else needs doing.

## The test login

The room needs an email on every sign-in, and a service token has none. So `login.ts` is a very small OpenID Connect provider, which `run.ts` deploys as its own Worker and adds to Access as a login method.

- **It needs its own secret,** `SAMPLE_ROOM_TEST_LOGIN_SECRET`, in the `quality-speed` environment. It's a random value, not a Cloudflare object: nothing is made in Cloudflare by hand.
- **Replacing it:** within 90 days, the same way it was set. The next time a person runs `run.ts`, it sees the change and redeploys, including the login. That run also syncs the record again, which costs a little AI Search ingestion.
- **Who it signs in:** only `@example.test` addresses, a domain reserved for testing. `founder@example.test` is the room's owner and `counsel@example.test` its counsel. Whoever holds the secret can be either, and only in this room.
- **How a journey uses it:** open the room, Access sends it to the login page, fill `[data-test-email]` and `[data-test-secret]`, and submit.
- **Its reach:** the room's two Access apps name it as their only login method. An Access login method is account-wide, so any other Access app on the account that allows every login method, with a policy open to anyone, would accept it too. `run.ts` checks for such an app on every run, before it adds or keeps the login, and stops if it finds one or can't tell. Any allow policy counts as open unless every rule names a real address or domain, so a group or a reusable policy stops the run too. On the first real run, compare that with what Access returns for this account's other policies. 

## What it costs

**The room needs Workers Paid: $5 a month, or nothing more if the account already has it.** Check under **Workers & Pages > Plans**. The room's settings set a CPU limit, which only that plan supports, and the Free plan allows 10 ms of CPU a request, where Cloudflare's docs put Workers doing sign-in work at 10 to 20 ms. There's no separate charge for the Access apps, on the Zero Trust Free plan.

**The spend guard is the stop.** The owner agreed to about $5 a month on the basis that Cloudflare has no hard stop, so `run.ts` refuses to start unless the guard is on: Ask and the connector must reach Workers AI and AI Search through the meters (`worker/spend.ts`), and each Worker must have its database, its daily cap, a rate limit and a CPU limit. It then refuses to deploy without the `spend_counters` table.

To prove it on the room after the first deploy, ask one question as `founder@example.test` and make one connector search, and check that `SELECT meter, period, used FROM spend_counters` has counted both. `run.ts` can only see that the code calls the meters. Nothing in `live.test.ts` runs a real call through them, and no test covers metering through `mcp/server.ts`.

What that leaves, which the owner should know:

- **Workers AI** stays under the free daily neurons until the room's records show the month's earlier days. From then, `worker/budget.ts` lets it reach $9.00 past them in a month, on top of the plan. Only a signed-in member can spend it, and the test login's secret decides who that is here.
- **Worker requests, CPU, D1, R2 and KV** have no guard beyond the plan's allowances. The login Worker and `/mcp` answer anyone, so a flood would bill past those allowances, at a small rate per million requests, with no stop.

## What a person does, once

| Step | Why only a person can |
|---|---|
| If **Workers & Pages > Plans** says Free: **Upgrade** to Workers Paid | Billing is never automated |
| If **R2 Object Storage** shows its plan page: **Add R2 subscription to my account**, $0 and billed only past the free monthly amounts | Billing is never automated. `run.ts` says so if it's off |
| Create the token from the link | Cloudflare needs a person to approve a new key |
| Set the secret: GitHub **Settings > Environments > quality-speed > Add environment secret**, name `SAMPLE_ROOM_TEST_LOGIN_SECRET`, value any long random text | A new credential is the owner's step, and the Git Crafter guard blocks a session from setting one |
| If the account has no Zero Trust organization: **Zero Trust > Get started**, Free plan | Cloudflare asks for payment details, charging $0. `run.ts` says so if it's missing |
| After the first run stops and says so: **AI Search > Create > R2 > bucket `legallas-index` > name `legallas`**, with reranking and the similarity cache both off | An R2-backed instance needs a service token, and letting CI mint tokens would be far too wide. The first run makes the bucket and fills it first |

Nothing to set after that. The first run that writes `live-room.json` starts the `law-eval` job, whose spend lease needs the room's D1: the ten law pages' `questions`, `eval_usd` and `law_lookup_tokens_p95` read missing until then. `live-journeys` reads the room's address from that file, by artifact id, and masks it before running; it stays off until `key-job-input` has a `journeys.ts` to hand it. The file's `mcpUrl` waits for the AI connectors answer tests, a board card: nothing reads it until then.

## The people eval

`.github/workflows/people-eval.yml` runs the person guard's set (`web/scripts/ask-eval.people.json`) through Ask's replica on this room, by hand, one shard a run. It needs the room's D1 (its spend lease) and the indexed AI Search instance, not a finished deploy.

| Runs | For |
|---|---|
| `recommend` 0 and 1 | The guard holds with a recommendation off (the example's) and on |
| `shard` k/n, n up to 9 | 17 items at about 450 neurons each, plus the last answer's output ceiling (about 1,120), pass the scripts' 7,000 a day. `--preflight` refuses a shard the day can't finish |

Every item passing under both values is the evidence for launch readiness `people_guard`. Runs may span commits: the closing PR lists what changed in `web/worker/` between them.
