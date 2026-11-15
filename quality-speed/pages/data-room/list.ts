// SPDX-License-Identifier: Apache-2.0
// The Data room's reviewed list: one row per scored metric, with its rule, source and evidence. manifest.json is generated
// from it, and list.test.ts fails when they differ. Ids read <room>.<user>.<goal>.<metric>. `member` is founder and counsel,
// who use the same pages and the same Ask, so one reading feeds both their cells. A metric measured once counts in one room,
// and other rooms' cells read it through READS. Connected AI, sync and templates have their own pages, and this one links to them.

export const ROOMS = ['forming', 'vc', 'angel', 'dispute'] as const;
export const USERS = ['founder', 'counsel', 'investor', 'ai'] as const;
export const GOALS = ['find', 'trust', 'leak', 'complete', 'cost'] as const;

export type Room = (typeof ROOMS)[number];
export type User = (typeof USERS)[number];
export type Goal = (typeof GOALS)[number];

const ROOM_SHARE: Record<Room, number> = { forming: 40, vc: 20, angel: 20, dispute: 20 };

/** The work each waiting row needs, in the board's order. An issue is closed now and links to its card, and newer cards have no issue. */
export const WORK = {
  now: { label: 'Below goal' },
  checklist: { label: 'Checklist', issue: 17 },
  company_room: { label: 'Company room', issue: 18 },
  identity_forms: { label: 'Identity forms' },
  answers: { label: 'How it answers', issue: 19 },
  deal_rooms: { label: 'Deal rooms', issue: 23 },
  investor_lists: { label: 'Investor lists', issue: 26 },
  hold: { label: 'Legal hold' },
  litigation: { label: 'Litigation room', issue: 126 },
  collector: { label: 'Collector' },
  live: { label: 'Live room' },
} as const satisfies Record<string, { label: string; issue?: number }>;
export type WorkKey = keyof typeof WORK;

export type Evidence =
  /** A timing from the lab's report.json. */
  | { journey: string; series: string; stat: 'p75' | 'p95' }
  | { browser: 'csp' | 'external' }
  /** Named tests in a test file, every one found and passing. */
  | { test: string; names: readonly string[] }
  | { lab: string }
  /** This lane's own run time, in minutes. */
  | { lane: 'minutes' }
  /** A share of a journey's tallies in the lab's report.json, as a percent: `ok` over `of`. */
  | { tally: string; ok: string; of: string }
  /** A count from a journey's tallies, over `of` checked. */
  | { tally: string; count: string; of: string }
  /** The scored answers from the live room. */
  | { answers: string }
  /** Nothing can pass until this work lands: a key of WORK. */
  | { after: readonly WorkKey[] };

type Shape = { unit: 'percent' | 'count' | 'pass' | 'ms' | 'ratio' | 'tokens' | 'minutes' | 'bytes'; direction: 'higher' | 'lower'; floor: number; goal: number };

const PASS: Shape = { unit: 'pass', direction: 'higher', floor: 0, goal: 1 };
const ALL: Shape = { unit: 'percent', direction: 'higher', floor: 0, goal: 100 };
const NONE: Shape = { unit: 'count', direction: 'lower', floor: 1, goal: 0 };
const FEW: Shape = { unit: 'count', direction: 'lower', floor: 5, goal: 0 };
const PAGE: Shape = { unit: 'ms', direction: 'lower', floor: 4000, goal: 2500 };
const SEARCH: Shape = { unit: 'ms', direction: 'lower', floor: 10000, goal: 1000 };
const INP: Shape = { unit: 'ms', direction: 'lower', floor: 500, goal: 200 };
const CLS: Shape = { unit: 'ratio', direction: 'lower', floor: 0.25, goal: 0.1 };
const TOKENS: Shape = { unit: 'tokens', direction: 'lower', floor: 25000, goal: 10000 };
/** The lab's throttle (slow 4G, 1.6 Mbps less 10%, about 189 KB a second after a 562 ms round trip) draws 360 KB in 2.5 s and 650 KB in 4 s. */
const BYTES: Shape = { unit: 'bytes', direction: 'lower', floor: 650000, goal: 360000 };
const minutes = (floor: number, goal: number): Shape => ({ unit: 'minutes', direction: 'lower', floor, goal });
const rate = (floor: number, goal: number): Shape => ({ unit: 'percent', direction: goal > floor ? 'higher' : 'lower', floor, goal });

/**
 * id, shape, fewest samples, weight (3 marks what most moves quality, speed or consumption), rule, source, evidence, and the public
 * page the goal comes from, where one exists.
 */
type Row = [id: string, shape: Shape, min: number, weight: 1 | 3, rule: string, source: string, evidence: Evidence, goalSource?: string];

const LWS = 'Core Web Vitals: good at 2.5 s, poor above 4 s';
const NIELSEN = 'Nielsen response limits: 1 s keeps the flow of thought, 10 s holds attention. A stated reason: no accepted standard exists';
const PRICING = 'https://docs.github.com/en/billing/reference/actions-runner-pricing';
const GATE = 'web/worker/rooms-access.test.ts';
const AUTH = 'web/worker/auth.test.ts';
const WALK = 'web/worker/room-route-walk.test.ts';
const CANARIES = 'web/worker/rooms-canaries.test.ts';
const LANDING = 'web/worker/rooms-landing.test.ts';
const VERSIONS = 'web/worker/versions.test.ts';
const CONVERSION = 'web/worker/litigation-conversion.test.ts';
const LIT_HISTORY = 'web/worker/litigation-history.test.ts';
const HOLD = 'web/worker/hold.test.ts';
const PRIVILEGE_LOG = 'web/worker/litigation/privilege-log.test.ts';
const PRODUCTION = 'web/worker/litigation/production.test.ts';

const after = (...work: WorkKey[]): Evidence => ({ after: work });
const test = (file: string, ...names: string[]): Evidence => ({ test: file, names });
const timing = (journey: string, series: string, stat: 'p75' | 'p95'): Evidence => ({ journey, series, stat });
const searched = (ok: string, of: string): Evidence => ({ tally: 'connector-search', ok, of });

const MCP_OUTPUT = 'https://code.claude.com/docs/en/mcp';
const NN_LIMITS = 'https://www.nngroup.com/articles/response-times-3-important-limits/';
const OWASP_LLM01 = 'https://genai.owasp.org/llmrisk/llm01-prompt-injection/';
/** LegalBench-RAG (research S66): recall at k over legal documents, the closest published measure. */
const RECALL = 'https://arxiv.org/abs/2408.10343';
// Goal sources more than one family uses. Each is from research/: its id there in the comment.
/** S54: LCP good at 2.5 s, poor above 4 s; CLS 0.1 and 0.25. */
const VITALS = 'https://web.dev/articles/vitals';
/** S80, ASVS 5.0 V8 Authorization. */
const ASVS_V8 = 'https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x17-V8-Authorization.md';
/** S84. */
const OWASP_CSP = 'https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html';
/** ORR-UK: workforce data anonymized for investors; research: "identity forms kept owner-only". */
const ORRICK_UK = 'https://www.orrick.com/en/Insights/2022/11/Founder-Series-Top-Tips-to-Follow-to-Get-Ready-to-Raise';
/** PROSK: sharing legal advice with a prospective investor can waive privilege (RF-31). */
const PROSKAUER = 'https://www.proskauer.com/blog/beware-the-privilege-waiver-during-investor-due-diligence';
/** GUN-PS. */
const GUNDERSON = 'https://catalyze.gunder.com/en/knowledge-articles/resource/example-pre-seed-due-diligence-checklist';
/** KLEHR. */
const KLEHR = 'https://klehr.com/publications/startup-evolution-a-year-long-journey-through-a-founders-toolkit-due-diligence-ready-building-a-data-room-that-wins-investor-confidence/';
/** WSC. */
const WHITE_STAR = 'https://atlas.whitestarcapital.com/guidance--best-practices/54vytRx5g6cuWLGJPLLt7w/what-makes-a-great-data-room/58ZbLzYSGQWrFktyoB52ig';
/** UKSA. */
const UKSA = 'https://www.gov.uk/government/publications/unlocking-space-for-investment-growth-hub/track-1-data-room-essentials-documents-checklist';
/** YC-S. */
const YC_SEED = 'https://www.ycombinator.com/library/4A-a-guide-to-seed-fundraising';
/** Litigation S12. */
const FRE_902 = 'https://www.law.cornell.edu/rules/fre/rule_902';
/** Litigation S2. */
const FRCP_26 = 'https://www.law.cornell.edu/rules/frcp/rule_26';
/** Litigation S5. */
const FRCP_37 = 'https://www.law.cornell.edu/rules/frcp/rule_37';
/** Litigation C36: a 2026 order on AI tools and confidential material (T6, T8, J21). */
const AI_ORDER = 'https://www.govinfo.gov/content/pkg/USCOURTS-cod-1_25-cv-01991/pdf/USCOURTS-cod-1_25-cv-01991-0.pdf';
/** Litigation S35. */
const SEC_DDS = 'https://www.sec.gov/files/sec-dds-aug-2026.pdf';
/** Litigation S26: Delaware Chancery's guidelines. */
const CHANCERY = 'https://courts.delaware.gov/forms/download.aspx?id=99468';
/** Repo-made goals, with no public page behind them: the plan's Goals table gives each one's basis. */
const PLAN_GOALS = 'https://github.com/Colorado-Startups/legallas/blob/main/quality-speed/pages/data-room/PLAN.md#goals';

/**
 * What the room hands any AI, whichever model a member connects: legallas_search's first five passages and the pages
 * legallas_read_pages returns, run in the lab on keyword search, which costs nothing. Each room's own questions and documents.
 */
const roomRetrieval = (room: Room): Row[] => [
  [`${room}.member.trust.right_document_top5`, rate(50, 90), 60, 3, 'The right document is in legallas_search\'s first five passages, on at least 90% of answerable items', 'Recall at 5, each question one trial; research S66, S68. 90% is the repo\'s document target', searched('rightDocumentTop5', 'asked'), RECALL],
  [`${room}.member.trust.right_page_top5`, rate(50, 85), 35, 3, 'One of the first five passages is at the cited page, on at least 85% of items that cite one', 'Page recall at 5; 85% is the repo\'s page target', searched('rightPageTop5', 'pageAsked'), RECALL],
  [`${room}.member.trust.exact_quotes`, rate(67, 98), 150, 1, 'Each passage\'s words are on the page it names, read back with legallas_read_pages, on at least 98%. The floor, two in three, is a stated reason', 'A citation an AI copies must hold. 98% is the repo\'s quote target', searched('quotesOnPage', 'quotes')],
  [`${room}.member.trust.injections_unwrapped`, NONE, 300, 1, 'Every passage and page handed to an AI is wrapped once as case data, so a planted instruction reaches it as a record, not a command', 'OWASP LLM01: segregate external content. 300 texts bound a miss under 1%', { tally: 'connector-search', count: 'unwrapped', of: 'texts' }, OWASP_LLM01],
];

/** A deal room's guest protections. The code is shared, so these count once, in VC, and Angel reads them. */
const GUEST_LEAKS: Row[] = [
  ['vc.investor.leak.other_rooms_refused', PASS, 1, 1, 'A guest asking for another room gets what a missing room gets', 'Rooms design R2', test(GATE, 'R2')],
  ['vc.investor.leak.outside_documents_missing', PASS, 1, 1, 'Documents outside the room\'s folders, privileged, removed, or from counsel answer like missing ones', 'Rooms design R3 to R5', test(GATE, 'R3, R4, R5: every document')],
  ['vc.investor.leak.member_routes_refused', PASS, 1, 1, 'A guest reaches no member route and no static page', 'Rooms design R6', test(GATE, 'R6')],
  ['vc.investor.leak.no_download', PASS, 1, 1, 'By default, bytes leave only inline to a viewer, audited with the room, and a download request is refused', 'Rooms design R7; #23: downloads off by default', test(GATE, 'R7')],
  ['vc.investor.leak.other_investors_hidden', PASS, 1, 1, 'A guest never reads another investor\'s comments, counsel\'s, or another room\'s', 'Rooms design R8', test(GATE, 'R8: a guest reads only')],
  ['vc.investor.leak.revoke_cuts_off', PASS, 1, 1, 'A revoke takes effect at the next request', 'Rooms design R9; Klehr', test(GATE, 'R9')],
  ['vc.investor.leak.expiry_cuts_off', PASS, 1, 1, 'An expired invitation, an archived room or a removed folder ends access with no job running', 'Rooms design R10; Klehr', test(GATE, 'R10')],
  ['vc.investor.leak.guest_ai_refused', PASS, 1, 1, 'A guest\'s AI connects only on a live invitation that may connect; /authorize refuses any other before an OAuth step', 'Rooms design R13; #23, #825', test('web/mcp/rooms-ai.test.ts', 'R13: /authorize refuses a guest who may not connect')],
  ['vc.investor.leak.canaries', PASS, 1, 3, 'Planted canaries (a sibling folder, outside the room, personal data) never reach an investor on a route or in guest search', 'OWASP LLM02; ASVS 8.3.3', test(CANARIES, 'planted canaries never reach a guest')],
  ['vc.investor.leak.personal_ids_stay_out', PASS, 1, 1, 'A planted identifier, such as a fake SSN, never reaches a guest', 'Research ANG-20', test(CANARIES, 'planted canaries never reach a guest')],
  ['vc.investor.leak.guest_pages_clean', PASS, 1, 1, 'Guest pages make no off-room request and break no security policy', 'OWASP CSP guidance', after('deal_rooms')],
];

const LIST: readonly Row[] = [
  // Forming: find it fast. The dispute lane times what is shared on the largest room, so every room can read it.
  ['forming.member.find.filter_to_right_document_p95', SEARCH, 20, 1, 'Filtering the document table narrows to the right row, 95% within 1 second. The room has no other search: search by content goes through legallas_search', NIELSEN, timing('filter-documents', 'narrowed_ms', 'p95')],
  ['forming.member.find.document_open_p95', PAGE, 20, 1, 'A document opens with its text drawn, 95% within 2.5 seconds', LWS, timing('doc-open', 'page_drawn_ms', 'p95')],
  ['forming.member.find.citation_to_right_page_p95', PAGE, 20, 1, 'A citation lands on its page, 95% within 2.5 seconds', LWS, timing('citation-to-page', 'page_drawn_ms', 'p95')],
  ['forming.member.find.search_round_trip_p95', SEARCH, 20, 1, 'legallas_search answers a member\'s AI, 95% within 1 second', NIELSEN, timing('connector-search', 'round_trip_ms', 'p95'), NN_LIMITS],
  ['forming.member.find.lcp_p75', PAGE, 20, 1, 'The main page paints, 75% within 2.5 seconds', LWS, timing('load-overview', 'lcp_ms', 'p75')],
  ['forming.member.find.inp_p75', INP, 20, 1, 'The slowest key press answers, 75% within 200 ms', 'Core Web Vitals INP: good at 200 ms, poor above 500 ms', timing('filter-documents', 'interaction_ms', 'p75')],
  ['forming.member.find.cls_p75', CLS, 20, 1, 'Layout shift stays at 0.1 or less, 75% of loads', 'Core Web Vitals CLS: good at 0.1, poor above 0.25', timing('load-overview', 'cls', 'p75')],
  ['forming.founder.find.checklist_to_document_p95', PAGE, 20, 1, 'From a checklist item to its agreement, 95% within 2.5 seconds', LWS, after('checklist')],

  // What the room uses: tokens handed to an AI, AI Search queries and bytes. Runner minutes are the cost rows at the end.
  ['forming.member.cost.search_result_tokens_p95', TOKENS, 20, 1, 'A legallas_search result costs an AI at most 10,000 tokens, 95% of searches. Tokens are characters over four', 'Claude Code warns above 10,000 tokens of tool output and cuts at 25,000', timing('connector-search', 'result_tokens', 'p95'), MCP_OUTPUT],
  ['forming.member.cost.ai_search_queries_month', { unit: 'count', direction: 'lower', floor: 1000, goal: 450 }, 1, 3, 'The room uses at most 450 AI Search queries a month, its meter. Past 1,000 Cloudflare bills, which the owner rules out', 'The owner, 2026-11-04: stay free on AI Search; worker/budget.ts', after('live')],
  ['forming.member.cost.document_bytes_p95', BYTES, 20, 1, 'At most 360 KB crosses the wire before a document\'s page is drawn, 95% of opens: what slow 4G carries in 2.5 seconds', `${LWS}; the lab's throttle. A stated reason`, timing('doc-open', 'bytes_drawn', 'p95')],

  // Forming: what the room hands any AI.
  ...roomRetrieval('forming'),

  // Forming: nothing leaks.
  ['forming.founder.leak.stranger_refused', PASS, 1, 1, 'Someone signed in but not invited is refused on every route', 'OWASP ASVS 5.0 V8; Rooms design R1', test(WALK, 'a stranger is refused on every route')],
  ['forming.founder.leak.bad_token_refused', PASS, 1, 1, 'A missing, forged, expired or wrong-audience token is refused', 'Rooms design, lock 2', test(AUTH, 'a missing token is rejected', 'a token signed by another key', 'an expired token is rejected', 'a wrong audience is rejected')],
  ['forming.founder.leak.no_offsite_requests', PASS, 1, 1, 'No page opened makes a request off the room', 'Legal review risk 12', { browser: 'external' }],
  ['forming.founder.leak.no_policy_breaks', PASS, 1, 1, 'No security-policy break on any page opened', 'OWASP CSP guidance', { browser: 'csp' }],
  ['forming.founder.leak.views_logged', PASS, 1, 1, 'Every view and download writes one audit row', 'FRE 901(b)(9); Rooms design', test('web/worker/files-routes.test.ts', '/api/doc/:id returns metadata and writes one view', 'opening a PDF logs one view', 'a top-level open is an attachment and one download row')],
  ['forming.founder.leak.data_leaving_test', PASS, 1, 1, 'A scripted release run sends nothing to a host outside the allow list', 'Legal review: egress test on each release', after('collector')],
  ['forming.counsel.leak.identity_forms_owner_only', PASS, 1, 1, 'Employee identity forms such as I-9 and W-4 stay owner only, and the owner can share a specific form', 'The owner\'s decision, 2026-11-02', after('identity_forms')],
  ['forming.counsel.leak.role_walk', PASS, 1, 1, 'Every route, walked as counsel and as the owner, answers as the role matrix says', 'OWASP ASVS 5.0 V8', test(WALK, 'counsel is refused exactly what the role matrix refuses', 'the owner is refused nothing')],

  // Forming: complete and in order. The first product.
  ['forming.founder.complete.opens_as_company_room', PASS, 1, 3, 'A room with no matter opens as the company, with no case words', '#18', after('company_room')],
  ['forming.founder.complete.journey_end_to_end', PASS, 1, 3, 'One scripted founder: choose an entity, see the list, open guidance and its form, add a signed copy, see the item turn in place', 'The owner: "every initial agreement in place, guidance through it"', after('checklist', 'company_room')],
  ['forming.founder.complete.checklist_items_guided', ALL, 36, 3, 'The pre-formation and formation items each show plain guidance with a source, and their deadline where they have one', 'Plan: the 36 items; docs/checklist', after('checklist')],
  ['forming.founder.complete.agreement_status_correct', ALL, 36, 3, 'Each item\'s status matches the planted company: in place, check or missing', '#17', after('checklist')],
  ['forming.founder.complete.where_it_lives_works', ALL, 10, 3, 'Each document in place shows where it lives, with a link that opens it', 'The owner: "easy-to-see info on where each one lives"', after('checklist')],
  ['forming.founder.complete.samples_indexed', PASS, 1, 1, 'Every sample document is read into the index', 'web/scripts/checkindex.ts', { lab: 'seed' }],
  ['forming.founder.complete.planted_gaps_found', ALL, 3, 1, 'Every planted gap shows as missing: a technology assignment, a domain in a founder\'s name, a missed 83(b)', '#17; research RF-11, RF-15', after('checklist')],
  ['forming.founder.complete.contradictions_found', ALL, 1, 1, 'Two documents that disagree get flagged, naming both', '#17; research RF-12', after('checklist')],
  ['forming.founder.complete.deadline_83b_correct', PASS, 1, 1, 'Transfer on 2027-01-15 shows 2027-02-14, counted from transfer, with wording that a weekend or legal holiday may move the last day later. A shown date may err early, never late', '26 USC 83(b); 26 CFR 1.83-2(b); 26 USC 7503', test('web/worker/checklist.test.ts', '83(b): 30 days after each transfer, in calendar days')],
  ['forming.founder.complete.patent_clock_shown', PASS, 1, 1, 'A planted first public disclosure shows the one-year patent date. It can\'t be fixed later', '35 USC 102(b)(1); research G7', after('checklist')],
  ['forming.founder.complete.wording_rule_breaks', NONE, 1, 1, 'Built pages hold none of the banned words, and each carries the required line, with the owner\'s answers applied', 'Product notices A1, A2; the owner\'s answers, #19', { lab: 'wording' }],
  ['forming.counsel.complete.gaps_shown', ALL, 3, 1, 'Counsel sees every planted gap with its source', '#17', after('checklist')],
  ['forming.counsel.complete.questions_pack_cites', ALL, 5, 1, 'The questions for your lawyer carry a citation on every line', '#17', after('checklist')],

  // Raising from VCs. Founder and counsel read Forming's document timings.
  ['vc.investor.find.index_lcp_p75', PAGE, 20, 1, 'An investor\'s room index paints, 75% within 2.5 seconds', LWS, after('deal_rooms')],
  ['vc.investor.find.document_open_p95', PAGE, 20, 1, 'An investor opens a document, 95% within 2.5 seconds', LWS, after('deal_rooms')],
  ['vc.investor.find.find_document_p95', SEARCH, 20, 1, 'An investor finds a document, 95% within 1 second', NIELSEN, after('deal_rooms')],
  ['vc.investor.find.inp_p75', INP, 20, 1, 'The slowest action on a guest page answers, 75% within 200 ms', 'Core Web Vitals INP', after('deal_rooms')],
  ['vc.investor.find.cls_p75', CLS, 20, 1, 'Guest pages hold layout shift at 0.1 or less', 'Core Web Vitals CLS', after('deal_rooms')],
  ['vc.founder.leak.privileged_path_kept_out', PASS, 1, 1, 'A folder with privileged in its path cannot join a room', 'Product notices A7; Rooms design R4', test('web/scripts/room.test.ts', 'a folder with privileged in its path is refused by the CLI and by the database')],
  ['vc.founder.leak.owner_only_blocked', PASS, 1, 1, 'Identity forms can\'t reach a deal room unless the owner shares that form', 'The owner\'s decision, 2026-11-02; checklist "Owner only"', after('identity_forms', 'deal_rooms')],
  ['vc.founder.leak.privileged_advice_caught', PASS, 1, 1, 'A lawyer\'s memo in an investor folder, with no mark in its path, is caught before the share', 'Sharing advice with a prospective investor can waive it (research RF-31)', after('deal_rooms')],
  ...GUEST_LEAKS,
  ['vc.member.complete.investor_folders_present', ALL, 10, 3, 'The room opens with the checklist\'s 10 investor folders', 'Plan; docs/checklist diligence index', after('checklist', 'deal_rooms')],
  ['vc.member.complete.financing_items_guided', ALL, 23, 3, 'The financing items each show guidance with a source', 'Plan; docs/checklist', after('checklist')],
  ['vc.member.complete.seed_room_lean_ready', PASS, 1, 1, 'A seed room with only deck, cap table and monthly P&L reads as ready', 'YC seed guide; a16z; research SEED-1', after('deal_rooms')],
  ['vc.member.complete.red_flags_surfaced', ALL, 15, 3, 'Planted flags are named with both documents: deck against model, cap table against ledger, missing and outdated documents, a missed 83(b)', 'a16z; Klehr; YC; Cooley; UK Space Agency; research RF-01, RF-07, RF-11, RF-15, RF-18', after('checklist')],
  ['vc.member.complete.who_viewed_what', PASS, 1, 1, 'The owner sees which investor opened which document and when', 'White Star; Rooms design', test('web/worker/rooms-owner.test.ts', 'the owner sees which investor opened which document and when')],
  ['vc.member.complete.version_history', PASS, 1, 1, 'A replaced file shows its date and keeps the old version for the owner', 'UK Space Agency; Klehr', test(VERSIONS, 'a replaced file shows its date and keeps the old version for the owner')],
  ['vc.member.complete.guest_preview', PASS, 1, 1, 'The owner\'s preview lists exactly what a guest gets', 'UK Space Agency; White Star', test('web/worker/rooms-preview.test.ts', 'the owner\'s guest preview lists exactly what a guest gets')],
  ['vc.member.complete.room_contents_on_past_date', PASS, 1, 1, 'The owner can ask what the room showed on any past date', 'Pesca; research J7', test(VERSIONS, 'the owner can ask what the room showed on any past date')],
  ['vc.member.complete.exemption_path_consistent', PASS, 1, 1, 'The room records a raise\'s path, and flags an investor with no relationship record under 506(b) or no verification record under 506(c)', '17 CFR 230.152(a)(1), 230.506; research ANG-14', after('deal_rooms')],
  ['vc.member.complete.seat_warning', PASS, 1, 1, 'The host is warned before a share passes the 50 free seats', 'The owner, 2026-11-01', test('web/scripts/room.test.ts', 'the owner is warned before a share passes the 50 free seats')],
  ['vc.investor.complete.deck_and_summary_first', PASS, 1, 3, 'The landing page puts the deck and summary first, one click away, wherever they sit in the folders', 'YC; a16z; White Star; research SEED-2', test(LANDING, 'an investor\'s landing page puts the deck and summary first, one click away, wherever they sit in the folders')],
  ['vc.investor.complete.one_link_to_first_document', PASS, 1, 3, 'From invitation to first document in 3 steps or fewer, with no account to create. Three is a test tolerance', 'White Star; SC Launch', test(LANDING, 'from invitation to first document in 3 steps or fewer, with no account to create')],
  ['vc.investor.complete.index_dates_contact', PASS, 1, 1, 'The landing page lists every folder, a last-updated date and a named contact', 'UK Space Agency; Klehr', test(LANDING, 'the landing page lists every folder, a last-updated date and a named contact')],
  ['vc.investor.complete.every_type_views', ALL, 5, 1, 'PDF, spreadsheet, Word, PowerPoint and image each open in the guest\'s viewer', 'White Star; a16z', after('deal_rooms')],
  ['vc.investor.complete.model_works_as_spreadsheet', PASS, 1, 1, 'The owner can let a named model open as a working spreadsheet', 'White Star; a16z; research SEED-13', after('deal_rooms')],
  ['vc.investor.complete.qa_reaches_asker', PASS, 1, 3, 'An investor\'s question and the owner\'s answer both reach that investor, and only them', '17 CFR 230.502(b)(2)(v) for non-accredited buyers under 506(b); Keiretsu', test(GATE, 'an investor\'s question and the owner\'s answer reach only that investor')],
  ['vc.investor.complete.latest_version_shown', PASS, 1, 1, 'After a replacement, the guest sees the latest with its date', 'UK Space Agency; Klehr', test(VERSIONS, 'after a replacement, the guest sees the latest with its date')],
  ['vc.investor.complete.document_matches_source', ALL, 5, 1, 'What a guest is served matches the source file\'s SHA-256', 'Sedona; FRE 902(14)', after('deal_rooms')],
  ['vc.investor.complete.confidentiality_and_logging_notice', PASS, 1, 1, 'The first page and the invitation carry the confidentiality and logging statements', 'Turret Labs; Carr; Tax Track; C.R.S. 7-74-102(4)', test(LANDING, 'the first page and the invitation carry the confidentiality and logging statements')],

  // Raising from angels and groups: what differs from VC.
  ['angel.investor.find.index_lcp_p75', PAGE, 20, 1, 'A group member\'s index, with two deals, paints 75% within 2.5 seconds', LWS, after('deal_rooms')],
  ['angel.investor.find.document_open_p95', PAGE, 20, 1, 'A group member opens a document, 95% within 2.5 seconds', LWS, after('deal_rooms')],
  ['angel.investor.find.find_document_p95', SEARCH, 20, 1, 'A group member finds a document, 95% within 1 second', NIELSEN, after('deal_rooms')],
  ['angel.investor.leak.other_holder_terms_hidden', PASS, 1, 1, 'One holder\'s private terms never reach another group member', 'The gold set\'s canary; Rooms design R8', after('deal_rooms')],
  ['angel.investor.leak.team_notes_stay_in_deal', PASS, 1, 1, 'With team review on, shared notes stay inside that deal', 'Rooms design R8; research ANG-11', after('deal_rooms')],
  ['angel.member.complete.first_pack_present', ALL, 9, 3, 'A raise from angels lists the nine preliminary pack items and marks each in place or missing, and a planted missing one shows as missing', 'Tech Coast Angels via ACA 2004; Keiretsu; research ANG-1', after('investor_lists')],
  ['angel.member.complete.angel_checklist_shown', ALL, 5, 1, 'The angels\' checklist shows in the room with guidance', '#26', after('investor_lists')],
  ['angel.member.complete.group_checklist_shown', ALL, 6, 1, 'The groups\' checklist shows in the room with guidance', '#26', after('investor_lists')],
  ['angel.investor.complete.stages_without_new_invite', PASS, 1, 1, 'A folder added in a later stage reaches current members with no new invitation', 'Keiretsu; Golden Seeds; research ANG-2', after('deal_rooms')],
  ['angel.investor.complete.team_reviews_together', PASS, 1, 1, 'The owner can let a deal\'s members see each other and share notes, room by room', 'Golden Seeds; Keiretsu; research ANG-11', after('deal_rooms')],

  // Dispute.
  ['dispute.member.find.control_number_jump_p95', PAGE, 20, 1, 'A control number goes to its document, 95% within 2.5 seconds', LWS, after('litigation')],
  ['dispute.member.find.chronology_lcp_p75', PAGE, 20, 1, 'The chronology paints, 75% within 2.5 seconds', LWS, timing('load-chronology', 'lcp_ms', 'p75')],
  ['dispute.member.find.privilege_log_open_p95', PAGE, 20, 1, 'The privilege log opens, 95% within 2.5 seconds', LWS, after('litigation')],
  ...roomRetrieval('dispute'),
  ['dispute.founder.leak.no_offsite_requests', PASS, 1, 1, 'No matter page makes a request off the room', 'Legal review risk 12', { browser: 'external' }],
  ['dispute.founder.leak.no_policy_breaks', PASS, 1, 1, 'No security-policy break on a matter page', 'OWASP CSP guidance', { browser: 'csp' }],
  ['dispute.founder.leak.hold_blocks_deletes', PASS, 1, 3, 'With a hold on, every delete, purge, cleanup and uninstall path is refused and logged', 'FRCP 37(e); Chancery Rule 37(e); Terra Mgmt. (Colo. 2025); product notices A7', after('hold')],
  ['dispute.founder.leak.hold_stops_timers', PASS, 1, 1, 'With a hold on, passing every retention and expiry date removes nothing', 'FRCP 37(e), 2015 note', test('web/worker/data-retention.test.ts', 'a legal hold blocks the sign-in purge, in the sweep and in the SQL itself', 'a hold stops a purge in the database: nothing is removed and the trigger stays', 'a hold stops the replaced-original purge too')],
  ['dispute.founder.leak.no_ai_class_out', PASS, 1, 1, 'An item in the No-AI class stays out of the AI index, returns nothing through Ask or any connector, and search shows how many items it leaves out', 'Product notices A7; 2026 protective orders', after('hold')],
  ['dispute.founder.leak.ai_grants_reapproved', PASS, 1, 1, 'At conversion every AI grant stops until a person approves it again', 'Research J21', test('web/mcp/ai-reapproval.test.ts', 'at conversion every AI grant stops until a person approves it again')],
  ['dispute.founder.leak.zero_retention_refuses_consumer', PASS, 1, 1, 'A room set to zero retention refuses a consumer AI plan', 'Product notices A7', test('web/mcp/zero-retention.test.ts', 'a room set to zero retention refuses a consumer AI plan')],
  ['dispute.counsel.leak.opposing_side_productions_only', PASS, 1, 1, 'A receiving-party account sees only served productions at its tier', 'FRCP 26(c)', after('litigation')],
  ['dispute.investor.leak.out_everywhere', PASS, 1, 3, 'After conversion, each investor is refused on view, search, download, API, Ask, connector and old links', 'Research J15; FRCP 26(c) by analogy', test(CONVERSION, 'after conversion each investor is refused on view, search, download, API, Ask, connector and old links')],
  ['dispute.investor.leak.ai_out', PASS, 1, 1, 'After conversion, a departing account\'s tokens are revoked', 'Research J21', test(CONVERSION, 'after conversion the sweep revokes a departing account')],
  ['dispute.founder.complete.conversion_keeps_documents', PASS, 1, 3, 'The same documents and SHA-256 before and after conversion', 'FRCP 37(e); research J1', test(CONVERSION, 'conversion keeps every document and its SHA-256')],
  ['dispute.founder.complete.conversion_keeps_numbers', PASS, 1, 3, 'The same control number on the same hash, and a new document takes the next', 'Research J2', test(CONVERSION, 'conversion keeps each control number on the same hash, and a new document takes the next')],
  ['dispute.founder.complete.conversion_keeps_history', PASS, 1, 1, 'Comments, invitations and the event log survive, and an as-of query shows what each investor could see', 'Sedona; research J5, J6, J8', test(LIT_HISTORY, 'comments, invitations and the event log survive conversion')],
  ['dispute.founder.complete.conversion_is_one_act', PASS, 1, 1, 'One event holds actor, time and counts, and a killed run finishes cleanly', 'Chancery guidelines; research J11, J12', test(CONVERSION, 'conversion is one recorded event with actor, time and counts, and a killed run finishes cleanly')],
  ['dispute.founder.complete.directors_not_removed_silently', PASS, 1, 1, 'Conversion can\'t finish while a director\'s account is unresolved: a lawyer records the decision', 'Research J16', test(CONVERSION, 'conversion cannot finish while a director')],
  ['dispute.founder.complete.hold_before_any_suit', PASS, 1, 1, 'A hold can start with no case number and stores the date and who', 'FRCP 37(e) note; research P1', test(HOLD, 'a hold starts with no case number and stores the date and who')],
  ['dispute.founder.complete.hold_notice_acknowledged', PASS, 1, 1, 'A hold records custodians, notice, each acknowledgment, reminders and release, and an unacknowledged one is flagged', 'Sedona Legal Holds; Chancery guidelines; research P6, P7, P13', test(HOLD, 'a hold records custodians, notice, each acknowledgment, reminders and release, and an unacknowledged one is flagged')],
  ['dispute.founder.complete.hold_names_what_it_cannot_reach', PASS, 1, 1, 'The hold screen lists AI chats, messaging, phones and version history', 'Product notices A7; Chancery guidelines', test(HOLD, 'the hold screen lists AI chats, messaging, phones and version history')],
  ['dispute.founder.complete.old_versions_survive', PASS, 1, 1, 'A file replaced during a hold keeps version 1 byte for byte', 'Research P5', test('web/worker/versions.test.ts', 'a replaced file shows its date and keeps the old version for the owner')],
  ['dispute.founder.complete.case_room_notice', PASS, 1, 1, '"Not private like talking to your lawyer" shows at the top of a case room', 'Product notices A7', test('web/worker/product-notices.test.ts', '"Not private like talking to your lawyer" opens every case room page')],
  ['dispute.founder.complete.mark_wording', PASS, 1, 1, 'As rendered, the label reads "Marked privileged by you", no status reads privileged, and a claim shows only on a served log', 'Product notices A1, A7', test('web/src/scripts/mark-wording.test.ts', 'as rendered, the label reads "Marked privileged by you", no status reads privileged')],
  ['dispute.founder.complete.ai_output_apart', PASS, 1, 1, 'An AI answer is never stored as a record and carries no control number', 'Research U4', test('web/worker/ai-output-apart.test.ts', 'an AI answer is never stored as a record and carries no control number')],
  ['dispute.counsel.complete.numbers_never_reused', PASS, 1, 1, 'No control number is assigned twice, removed items included', 'SEC and DOJ production specifications', test('web/worker/doc-numbers.test.ts', 'migration 0003 numbers every row', 'a counsel upload is numbered after the highest number')],
  ['dispute.counsel.complete.every_number_accounted', PASS, 1, 3, 'Every number from first to last is produced, withheld or has a listed reason', 'SEC and DOJ specifications: a practice standard, not a rule', test(PRIVILEGE_LOG, 'every number from first to last is produced, withheld or has a listed reason')],
  ['dispute.counsel.complete.withheld_logged_once', PASS, 1, 3, 'Every withheld range appears in the log exactly once', 'FRCP 26(b)(5)(A); Mechel Bluestone (Del. Ch.)', test(PRIVILEGE_LOG, 'every withheld range appears in the log exactly once')],
  ['dispute.counsel.complete.log_points_to_real_ranges', PASS, 1, 3, 'Every log entry points to a real withheld or redacted range', 'FRCP 26(b)(5)(A)', test(PRIVILEGE_LOG, 'every log entry points to a real withheld or redacted range')],
  ['dispute.counsel.complete.log_states_basis', PASS, 1, 1, 'No log entry has a blank privilege basis', 'Principal Growth (Del. Ch. 2025)', test(PRIVILEGE_LOG, 'no log entry has a blank privilege basis')],
  ['dispute.counsel.complete.log_names_lawyer', PASS, 1, 1, 'Every entry names a lawyer or says why not, and every name resolves in a players list', 'Principal Growth; DOJ\'s 2026 model agreement', test(PRIVILEGE_LOG, 'every entry names a lawyer or says why not, and every name resolves in a players list')],
  ['dispute.counsel.complete.log_does_not_leak', PASS, 1, 1, 'Canary strings from withheld documents appear in no log field', 'FRCP 26(b)(5)(A); Sedona', test(PRIVILEGE_LOG, 'canary strings from withheld documents appear in no log field')],
  ['dispute.counsel.complete.log_is_a_spreadsheet', PASS, 1, 1, 'The log exports as .xlsx and .csv with one header row', 'Chancery guidelines; Sedona', test(PRIVILEGE_LOG, 'the log exports as .xlsx and .csv with one header row')],
  ['dispute.counsel.complete.search_survives_production', PASS, 1, 1, 'Ten known strings find the same documents in the room and the production', 'FRCP 34(b)(2)(E) and its 2006 note', test(PRODUCTION, 'ten known strings find the same documents in the room and the production')],
  ['dispute.counsel.complete.load_file_parses', PASS, 1, 1, 'An independent parser loads every load-file row with real metadata', 'SEC Data Delivery Standards; DOJ specifications', test(PRODUCTION, 'an independent parser loads every load-file row with real metadata')],
  ['dispute.counsel.complete.redaction_permanent', PASS, 1, 1, 'A redacted canary has zero hits in image text, text file, load file and metadata', 'SEC and DOJ specifications', test(PRODUCTION, 'a redacted canary has zero hits in image text, text file, load file and metadata')],
  ['dispute.counsel.complete.clawback_runs', PASS, 1, 1, 'A clawback blocks the item for all but counsel, removes it from search and Ask, lists every copy out, and keeps it until resolved', 'FRCP 26(b)(5)(B); FRE 502(b); research T11', after('litigation')],
  ['dispute.counsel.complete.audit_tamper_evident', PASS, 1, 1, 'No role can edit a log row, and altering a copy fails verification at that row', 'FRE 902(13), (14)', test('web/worker/audit-chain.test.ts', 'no role can edit a log row', 'altering a copy fails verification at that row')],
  ['dispute.counsel.complete.hash_at_intake_and_export', PASS, 1, 1, 'The helper\'s SHA-256 at the source equals the stored one and the export\'s, for every document', 'FRE 902(14); SEC specifications', test('web/worker/counsel-pack-hash.test.ts', 'the helper\'s SHA-256 at the source equals the stored one and the export\'s, for every document')],
  // Cost: each lane's collector run time, read only from a lab run that finished. Runner minutes are what the page spends, at $0.006 a Linux minute.
  ['forming.member.cost.lane_minutes', minutes(40, 10), 1, 1, 'The Forming lane\'s collector finishes in 10 minutes or less, from a lab run that finished', PRICING, { lane: 'minutes' }],
  ['vc.member.cost.lane_minutes', minutes(10, 3), 1, 1, 'The VC lane\'s collector finishes in 3 minutes or less, from a lab run that finished', PRICING, { lane: 'minutes' }],
  ['angel.member.cost.lane_minutes', minutes(10, 1), 1, 1, 'The Angel lane\'s collector finishes in 1 minute or less, from a lab run that finished', PRICING, { lane: 'minutes' }],
  ['dispute.member.cost.lane_minutes', minutes(40, 25), 1, 1, 'The Dispute lane\'s collector finishes in 25 minutes or less, from a lab run that finished', PRICING, { lane: 'minutes' }],
];

/** A cell the list leaves out, and why. */
export const EXCLUDED: Readonly<Record<string, string>> = {
  'forming.investor.find': 'No investors in a forming room',
  'forming.investor.trust': 'No investors in a forming room',
  'forming.investor.leak': 'No investors in a forming room',
  'forming.investor.complete': 'No investors in a forming room',
  'vc.investor.trust': 'Investors have no Ask in a deal room. Their questions are the Q&A, under complete',
  'angel.investor.trust': 'Investors have no Ask in a deal room. Their questions are the Q&A, under complete',
  'dispute.investor.find': 'Investors are out of a litigation room. The only test is that they stay out',
  'dispute.investor.trust': 'Investors are out of a litigation room. The only test is that they stay out',
  'dispute.investor.complete': 'Investors are out of a litigation room. The only test is that they stay out',
  'forming.investor.cost': 'Cost is per lane, under member',
  'vc.investor.cost': 'Cost is per lane, under member',
  'angel.investor.cost': 'Cost is per lane, under member',
  'dispute.investor.cost': 'Cost is per lane, under member',
};

/** The deal rooms run no lab, so their members read the forming room's retrieval: the same tools serve every room. */
const FORMING_RETRIEVAL = ['forming.member.trust'];

/** Metric ids or prefixes a cell also reads from elsewhere, because the same code is measured once. Each counts only in its own room. */
export const READS: Readonly<Record<string, readonly string[]>> = {
  'vc.founder.find': ['forming.member.find'],
  'vc.counsel.find': ['forming.member.find'],
  'angel.founder.find': ['forming.member.find'],
  'angel.counsel.find': ['forming.member.find'],
  'dispute.founder.find': ['forming.member.find'],
  'dispute.counsel.find': ['forming.member.find'],
  'angel.investor.find': ['vc.investor.find.inp_p75', 'vc.investor.find.cls_p75'],
  'vc.founder.trust': FORMING_RETRIEVAL,
  'vc.counsel.trust': FORMING_RETRIEVAL,
  'angel.founder.trust': FORMING_RETRIEVAL,
  'angel.counsel.trust': FORMING_RETRIEVAL,
  'vc.founder.leak': ['forming.founder.leak'],
  'angel.founder.leak': ['forming.founder.leak', 'vc.founder.leak'],
  'dispute.founder.leak': ['forming.founder.leak'],
  'vc.counsel.leak': ['forming.counsel.leak'],
  'angel.counsel.leak': ['forming.counsel.leak'],
  'dispute.counsel.leak': ['forming.counsel.leak'],
  'angel.investor.leak': ['vc.investor.leak'],
  'angel.founder.complete': ['vc.member.complete.red_flags_surfaced', 'vc.member.complete.who_viewed_what', 'vc.member.complete.version_history', 'vc.member.complete.guest_preview', 'vc.member.complete.seat_warning'],
  'angel.counsel.complete': ['vc.member.complete.red_flags_surfaced'],
  'angel.investor.complete': ['vc.investor.complete'],
};

/** Connected AI's cells link to its own page, and the room's sync and templates work there too. */
export const LINKED_PAGES = { ai: 'ai-connectors', sync: 'sync', templates: 'templates', launch: 'launch-readiness' } as const;

export interface ListRow {
  id: string;
  rule: string;
  source: string;
  evidence: Evidence;
}

export const ROWS: readonly ListRow[] = LIST.map(([id, , , , rule, source, evidence]) => ({ id, rule, source, evidence }));

/** Read by every room, so they're timed on the largest one: the dispute lane's. */
export const SHARED_TIMINGS: readonly string[] = [
  ...['filter_to_right_document_p95', 'document_open_p95', 'citation_to_right_page_p95', 'inp_p75', 'search_round_trip_p95'].map((id) => `forming.member.find.${id}`),
  ...['search_result_tokens_p95', 'document_bytes_p95'].map((id) => `forming.member.cost.${id}`),
];

export type Lane = 'forming' | 'dispute' | 'vc' | 'angel';

/** The one lane that writes a row. The dispute lane times what's shared and its own pages; each deal room has its own lane; forming takes the rest. */
export function laneOf(id: string): Lane {
  if (id.startsWith('dispute.member.') || id.startsWith('dispute.founder.leak.no_') || SHARED_TIMINGS.includes(id)) return 'dispute';
  if (id.startsWith('vc.')) return 'vc';
  if (id.startsWith('angel.')) return 'angel';
  return 'forming';
}

/** Hours until a reading goes stale: the plan's 48, which survives one dropped daily run. */
const MAX_AGE_HOURS = 48;
/** The deal rooms' guest journeys will run weekly, on Sundays, because a room takes minutes a night the free allowance can't spare. */
const WEEKLY_AGE_HOURS = 216;
const ageOf = (id: string, evidence: Evidence): number => (/^(vc|angel)\./.test(id) && !('test' in evidence || 'answers' in evidence) ? WEEKLY_AGE_HOURS : MAX_AGE_HOURS);
const LENS: Record<Goal, 'quality' | 'speed' | 'consumption'> = { find: 'speed', trust: 'quality', leak: 'quality', complete: 'quality', cost: 'consumption' };

/** Speed for find, consumption for cost, quality for every other goal. */
export const lensOf = (id: string): 'quality' | 'speed' | 'consumption' => LENS[id.split('.')[2] as Goal];

/** A metric's family: its id less room and user, so `forming.member.find.lcp_p75` is `find.lcp_p75`. */
const familyOf = (id: string): string => id.split('.').slice(2).join('.');

/**
 * The public page behind each family's goal, where its row names none. Every URL is from research/, except AI Search's,
 * which its row's source, worker/budget.ts, cites, and PLAN_GOALS, for goals the repo sets.
 */
const GOAL_SOURCES: Readonly<Record<string, string>> = {
  // Speed: Core Web Vitals (PLAN.md: page timings borrow LCP at p95), Nielsen's 1 s and 10 s.
  'find.document_open_p95': VITALS,
  'find.citation_to_right_page_p95': VITALS,
  'find.lcp_p75': VITALS,
  'find.cls_p75': VITALS,
  'find.checklist_to_document_p95': VITALS,
  'find.index_lcp_p75': VITALS,
  'find.control_number_jump_p95': VITALS,
  'find.chronology_lcp_p75': VITALS,
  'find.privilege_log_open_p95': VITALS,
  'find.inp_p75': 'https://web.dev/articles/inp',
  'find.filter_to_right_document_p95': NN_LIMITS,
  'find.find_document_p95': NN_LIMITS,
  // Consumption.
  'cost.document_bytes_p95': VITALS,
  'cost.ai_search_queries_month': 'https://developers.cloudflare.com/ai-search/platform/limits-pricing/',
  // Trust: S62, why a cited passage must hold.
  'trust.exact_quotes': 'https://arxiv.org/abs/2405.20362',
  // Leak: access control (8.2.1 function, 8.2.2 data, 8.3.2 changes at once, 8.4.1 cross-tenant).
  'leak.stranger_refused': ASVS_V8,
  'leak.role_walk': ASVS_V8,
  'leak.other_rooms_refused': ASVS_V8,
  'leak.outside_documents_missing': ASVS_V8,
  'leak.member_routes_refused': ASVS_V8,
  'leak.other_investors_hidden': ASVS_V8,
  'leak.revoke_cuts_off': ASVS_V8,
  'leak.expiry_cuts_off': ASVS_V8,
  'leak.guest_ai_refused': ASVS_V8,
  'leak.other_holder_terms_hidden': ASVS_V8,
  'leak.team_notes_stay_in_deal': ASVS_V8,
  'leak.out_everywhere': ASVS_V8,
  'leak.ai_out': ASVS_V8,
  // Leak: pages, data and privilege.
  'leak.no_offsite_requests': OWASP_CSP,
  'leak.no_policy_breaks': OWASP_CSP,
  'leak.guest_pages_clean': OWASP_CSP,
  'leak.canaries': 'https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/',
  'leak.views_logged': 'https://www.law.cornell.edu/rules/fre/rule_901',
  'leak.identity_forms_owner_only': ORRICK_UK,
  'leak.owner_only_blocked': ORRICK_UK,
  'leak.personal_ids_stay_out': ORRICK_UK,
  'leak.privileged_path_kept_out': PROSKAUER,
  'leak.privileged_advice_caught': PROSKAUER,
  'leak.no_download': WHITE_STAR,
  // Leak: holds, protective orders and AI in a dispute.
  'leak.hold_blocks_deletes': FRCP_37,
  'leak.hold_stops_timers': FRCP_37,
  'leak.opposing_side_productions_only': FRCP_26,
  'leak.no_ai_class_out': AI_ORDER,
  'leak.ai_grants_reapproved': AI_ORDER,
  'leak.zero_retention_refuses_consumer': AI_ORDER,
  // Complete: forming.
  'complete.planted_gaps_found': GUNDERSON,
  'complete.gaps_shown': GUNDERSON,
  'complete.contradictions_found': KLEHR,
  'complete.deadline_83b_correct': 'https://www.irs.gov/pub/irs-pdf/f15620.pdf',
  'complete.patent_clock_shown': 'https://www.law.cornell.edu/uscode/text/35/102',
  // Complete: raising.
  'complete.investor_folders_present': 'https://www.ycombinator.com/library/3h-series-a-diligence-checklist',
  'complete.seed_room_lean_ready': YC_SEED,
  'complete.deck_and_summary_first': YC_SEED,
  'complete.red_flags_surfaced': 'https://a16z.com/the-insiders-guide-to-data-rooms-what-to-know-before-you-raise/',
  'complete.who_viewed_what': WHITE_STAR,
  'complete.guest_preview': WHITE_STAR,
  'complete.one_link_to_first_document': WHITE_STAR,
  'complete.every_type_views': WHITE_STAR,
  'complete.model_works_as_spreadsheet': WHITE_STAR,
  'complete.version_history': KLEHR,
  'complete.index_dates_contact': UKSA,
  'complete.latest_version_shown': UKSA,
  'complete.room_contents_on_past_date': 'https://www.law.cornell.edu/rules/fre/rule_502',
  'complete.exemption_path_consistent': 'https://www.law.cornell.edu/cfr/text/17/230.506',
  'complete.qa_reaches_asker': 'https://www.law.cornell.edu/cfr/text/17/230.502',
  'complete.document_matches_source': FRE_902,
  'complete.confidentiality_and_logging_notice': 'https://www.law.cornell.edu/uscode/text/18/1839',
  'complete.first_pack_present': 'https://angelcapitalassociation.org/data/Secure/Angel%20Group%20Documents/Best%20Practice%20Templates%20and%20Papers/1%20BestPractices_DueDiligence.pdf?rev=52C2',
  'complete.stages_without_new_invite': 'https://chennai.tie.org/english/wp-content/uploads/2021/02/Session-5-Preparing-for-Due-Diligence-the-Keiretsu-Forum-Process.pdf',
  'complete.team_reviews_together': 'https://www.angelcapitalassociation.org/data/Secure/Angel%20Group%20Documents/Due%20Diligence%20Checklists%20and%20Reports/Due_Diligence_Playbook_Generic_with_Appendices.pdf?rev=43AD',
  // Complete: dispute.
  'complete.conversion_keeps_documents': FRCP_37,
  'complete.hold_before_any_suit': FRCP_37,
  'complete.old_versions_survive': FRCP_37,
  'complete.conversion_keeps_numbers': SEC_DDS,
  'complete.numbers_never_reused': SEC_DDS,
  'complete.load_file_parses': SEC_DDS,
  'complete.redaction_permanent': SEC_DDS,
  'complete.every_number_accounted': 'https://www.justice.gov/sites/default/files/atr/legacy/2009/03/24/243194d.pdf',
  'complete.conversion_keeps_history': 'https://www.thesedonaconference.org/sites/default/files/publications/2_ESI_Evidence_and_Admissibility_0.pdf',
  'complete.conversion_is_one_act': CHANCERY,
  'complete.hold_notice_acknowledged': CHANCERY,
  'complete.hold_names_what_it_cannot_reach': CHANCERY,
  'complete.log_names_lawyer': CHANCERY,
  'complete.withheld_logged_once': FRCP_26,
  'complete.log_points_to_real_ranges': FRCP_26,
  'complete.log_does_not_leak': FRCP_26,
  'complete.clawback_runs': FRCP_26,
  'complete.log_states_basis': 'https://www.thesedonaconference.org/sites/default/files/publications/Commentary-on-Privilege-Logs-May-2024.pdf',
  'complete.log_is_a_spreadsheet': 'https://edrm.net/wp-content/uploads/2023/09/EDRM-PrivilegeLogProtocol-final.pdf',
  'complete.search_survives_production': 'https://www.law.cornell.edu/rules/frcp/rule_34',
  'complete.audit_tamper_evident': FRE_902,
  'complete.hash_at_intake_and_export': FRE_902,
  // Repo-made: the plan's Goals table.
  'leak.bad_token_refused': PLAN_GOALS,
  'leak.data_leaving_test': PLAN_GOALS,
  'complete.opens_as_company_room': PLAN_GOALS,
  'complete.journey_end_to_end': PLAN_GOALS,
  'complete.checklist_items_guided': PLAN_GOALS,
  'complete.agreement_status_correct': PLAN_GOALS,
  'complete.where_it_lives_works': PLAN_GOALS,
  'complete.samples_indexed': PLAN_GOALS,
  'complete.wording_rule_breaks': PLAN_GOALS,
  'complete.questions_pack_cites': PLAN_GOALS,
  'complete.financing_items_guided': PLAN_GOALS,
  'complete.seat_warning': PLAN_GOALS,
  'complete.angel_checklist_shown': PLAN_GOALS,
  'complete.group_checklist_shown': PLAN_GOALS,
  'complete.directors_not_removed_silently': PLAN_GOALS,
  'complete.case_room_notice': PLAN_GOALS,
  'complete.mark_wording': PLAN_GOALS,
  'complete.ai_output_apart': PLAN_GOALS,
};

/** The manifest as committed. `signoff_comment` and `changes` are hand-kept in manifest.json. */
export function buildManifest(signoffComment?: number, changes: unknown[] = []) {
  return {
    page: 'data-room',
    ...(signoffComment ? { signoff_comment: signoffComment } : {}),
    groups: ROOMS.map((id) => ({ id, weight: ROOM_SHARE[id] })),
    metrics: LIST.map(([id, shape, min, weight, , source, evidence, goalSource]) => {
      const goal_source = goalSource ?? GOAL_SOURCES[familyOf(id)] ?? (source.startsWith('https://') ? source : undefined);
      return {
        id,
        lens: lensOf(id),
        unit: shape.unit,
        direction: shape.direction,
        floor: shape.floor,
        goal: shape.goal,
        weight,
        max_age_hours: ageOf(id, evidence),
        min_samples: min,
        group: id.split('.')[0],
        ...(goal_source ? { goal_source } : {}),
      };
    }),
    changes,
  };
}

/** The metrics a heatmap cell reads: its own, `member`'s for founder and counsel, and any it reads from elsewhere. */
export function metricsOfCell(cell: string): string[] {
  const [room, user, goal] = cell.split('.');
  const own = (id: string) => {
    const [r, u, g] = id.split('.');
    return r === room && g === goal && (u === user || (u === 'member' && (user === 'founder' || user === 'counsel')));
  };
  const reads = READS[cell] ?? [];
  return ROWS.map((r) => r.id).filter((id) => own(id) || reads.some((prefix) => id === prefix || id.startsWith(`${prefix}.`)));
}
