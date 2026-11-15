// SPDX-License-Identifier: Apache-2.0
// Card Q2. The room's voice (DESIGN.md section 9), enforced on the text people read: no fantasy, stage or game
// words (XP, level up, achievement), no "Legallas is...", no exclamation marks, no em dashes, and empty states of one
// sentence. Card 11.6: the same text, the setup guides and the READMEs also keep product notices A1's wording rules.
// Identifiers are not copy and stay (icon ids such as `scroll`, `ElfState`, the `I don't know` protocol
// token): copy-text.ts reads only text nodes, copy attributes and string literals shaped like prose.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { astroCopy, htmlCopy, looksLikeCopy, mdCopy, tsCopy } from './copy-text.ts';

const WEB = join(import.meta.dirname, '..');
const NOTICES = readFileSync(join(WEB, '..', 'docs', 'legal', 'product-notices.md'), 'utf8');
/** Product text: the room, both Workers (alert emails included), the setup guides, the Copilot package, the READMEs. */
const ROOTS = ['src', 'worker', 'mcp', 'connect', 'README.md', '../README.md'];
/** Tests, fixture data, generated files, configs and design notes beside the code. */
const EXEMPT = /\.test\.ts$|\.d\.ts$|\.test-data\.ts$|\.generated\.ts$|tsconfig\.json$|^(?:src|worker|mcp)\/.*\.md$/;
/**
 * Exact copy allowed to break one rule. The checklist's notice is the short line in docs/legal/product-notices.md (A2), and the full notice is A3, whose words are fixed for the same
 * reason.
 */
const ALLOWED: ReadonlySet<string> = new Set([
  'worker/checklist-baseline.ts "Legallas is...": Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.',
  // Word for word from docs/legal/product-notices.md, A3 (worker/full-notice.test.ts holds it to that file).
  'worker/full-notice.ts "Legallas is...": **What it is.** Legallas is an AI agent for legal work. It\'s software that runs in your own accounts. It researches, lays out every option, recommends one with its sources, and fills in the forms you choose with the answers you give. You review everything and you decide.',
  // Word for word from docs/legal/product-notices.md, A2 (worker/product-notices.test.ts holds it to that file).
  'worker/product-notices.ts "Legallas is...": Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.',
]);

const VOICE: ReadonlyArray<[string, RegExp]> = [
  ['a stage or fantasy word', /\b(?:scrolls?|shelves|elf|elves|elvish|quests?|magic(?:al)?)\b/i],
  ['"well met"', /\bwell met\b/i],
  ['"Legallas is..."', /\bLegallas is\b/],
  ['an exclamation mark', /[\p{L}\p{N})'"]!(?![=\w])/u],
  ['an em dash', /—/],
  ['game vocabulary', /\bXP\b|\b(?:level(?:s|ed|led)?[ -]up|achievements?)\b/i],
];

/** docs/legal/product-notices.md A1, "Don't say" and "Never", where a regex can't misfire. Each label says what to say. */
const WORDING: ReadonlyArray<[string, RegExp]> = [
  // Issue #19: copy never calls the product a lawyer or gives it a lawyer's title. "Legal agent" is the tagline's rule.
  [
    'a lawyer title',
    /\bgeneral counsel\b|\bsuperintelligen|\bagent counsel\b|\b(?:AI|robot|virtual|digital) (?:lawyer|attorney|counsel)\b|\blegal (?:advis[eo]r|consultant|advocate)s?\b|\bcounsell?ors?\b|\besquire\b|\bEsq\./i,
  ],
  ['the old tagline: say "AI agent for legal work"', /\blegal agent\b/i],
  [
    'say "You aren\'t receiving legal advice from a licensed lawyer"',
    /(?:\bnot|\bno|n't) (?:(?:give|provide|offer) )?legal advice\b(?! from a licensed)|\binformational purposes\b/i,
  ],
  ['say "Lists the documents startups commonly keep"', /\bknows what you need\b/i],
  ['say "Fills in the form you chose with the answers you give"', /\bfiles (?:it|them|this|everything) for you\b|\btakes care of (?:it|everything)\b|\bwe handle (?:it|everything)\b/i],
  ['a promise: show every option, then "Recommended"', /\bthe only choice\b|\bguarantee[sd]? (?:a |an |the |your )?(?:returns?|results?|outcomes?|success|wins?)\b/i],
  [
    'say "Checked against [source] on [date]"',
    /\bironclad\b|\bverified (?:sources?|citations?|cites?|quotes?|law)\b|\b(?:sources?|citations?|cites?|quotes?) (?:(?:is|are|was|were|been) )?verified\b/i,
  ],
  [
    'say "No matching, no introductions, no investor lists"',
    /\bAI (?:analyst|advis[eo]r)s?\b|(?<!(?:n't|not|never) )\bfind(?:s|ing)? investors\b|\bwarm intros?\b|\binvestor network\b|\bdeal ?flow\b|\bget funded\b|\braise faster\b|\bbest deals\b/i,
  ],
  [
    'say "Have your own lawyer review"',
    /\blike a lawyer\b|\blawyer-grade\b|\breplaces? (?:a |your )?lawyer\b|\bno need for a lawyer\b|\bpay less for (?:a )?lawyers?\b|\bsav(?:e|es|ing) (?:you )?(?:on )?legal fees\b/i,
  ],
  ['say "You aren\'t receiving tax advice from a licensed tax professional"', /(?<!receiving )\btax advice\b|\btax (?:advis[eo]rs?|planning)\b|\bsav(?:e|es|ing) you (?:on )?tax(?:es)?\b/i],
  ['a first-person feeling or opinion', /\bin my (?:opinion|view)\b|\bI(?:'m| am|'d be) (?:happy|glad|delighted|thrilled|excited|sorry)\b/i],
];

const BANNED = [...VOICE, ...WORDING];

/** A1 "Don't say" phrases no rule bans, and why: each also reads right where the product must say it. */
const LEFT_OUT: ReadonlyMap<string, string> = new Map([
  ['counsel', 'the lawyer in a room: "counsel room", counsel members'],
  ['attorney', '"attorney-client", A2'],
  ['lawyer', '"not a lawyer", "your own lawyer", A2'],
  ['you should have', 'everyday steps: "you should have an email"'],
  ['you need', 'everyday steps: "you need a code"'],
  ['You must', 'sign-in steps and the prompt'],
  ['Files for you', '"files" is a noun too; "files it for you" is banned'],
  ['takes over', '"the queue takes over"'],
  ['we handle', 'reads right outside a legal task; "we handle it" is banned'],
  ['guaranteed', '"a guaranteed loan"; "guaranteed return" and the like are banned'],
  ['a recommendation with no options shown', 'not a phrase: the prompt asks for every option first'],
  ['Privileged', 'as a status, src/scripts/mark-wording.test.ts bans it; the privilege log names it'],
  ['protected', 'a protective order, A7'],
  ['confidential as a status', 'not a phrase: "confidential documents", A7'],
  ['Verified', '"Verified domain", Ask\'s NOT VERIFIED line; banned as a source status'],
  ['accurate', 'law and checklist text: "must be accurate"'],
  ['reliable', 'law and checklist text'],
  ['Investment adviser', 'A3, A4 and the SEC source names'],
  ['Background check', 'A9: "This isn\'t a background check"; hiring law names them'],
  ['screen', '"Full screen"'],
  ['vet', '"your firm\'s own vetting"'],
  ['investigate', 'an internal investigation is a legal matter'],
]);

/** A1's table: each row's "Say" and its "Don't say" phrases. */
function a1Rows(): [string, string[]][] {
  const a1 = NOTICES.slice(NOTICES.indexOf('## A1.'), NOTICES.indexOf('**Assistant names.**'));
  return a1
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Say |'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map(([, say, dont]): [string, string[]] => [say!, dont!.split(/[;,]\s*/)]);
}

function* files(path: string): Generator<string> {
  if (!statSync(path).isDirectory()) {
    if (/\.(astro|ts|md|json)$/.test(path)) yield path;
    return;
  }
  for (const name of readdirSync(path)) {
    if (name !== 'node_modules' && !name.startsWith('.')) yield* files(join(path, name));
  }
}

function copyOf(rel: string, source: string) {
  if (rel.endsWith('.astro')) return astroCopy(source);
  if (rel.endsWith('.md')) return mdCopy(source);
  // A JSON file is an object literal: its keys are property names, so only its values are read.
  return tsCopy(rel.endsWith('.json') ? `(${source})` : source);
}

test('copy-text finds prose and skips identifiers, comments, imports and class lists', () => {
  const ts = [
    "import x from './scroll.ts';",
    '// A comment about an elf.',
    "const icon = 'scroll';",
    "el.className = 'c-button exhibit__scroll';",
    "window.addEventListener('scroll', go);",
    "type Pose = 'well met';",
    "const map = { 'Shelves here': 1 };",
    "say('No open discussions.');",
    'say(`Key: ${name}`);',
    "html('<p class=\"pdf-scroll\">Opening the PDF.</p>');",
  ].join('\n');
  assert.deepEqual(tsCopy(ts).map((c) => [c.line, c.text]), [
    [8, 'No open discussions.'],
    [9, 'Key: …'],
    [10, 'Opening the PDF.'],
  ]);
  assert.deepEqual(htmlCopy('<a class="vi-scroll" title="Previous page" href="/x">Prev</a>').map((c) => c.text), ['Previous page', 'Prev']);
  assert.deepEqual(astroCopy('---\nconst t = "The binder";\n---\n<h1>{t}</h1>\n<p aria-label="Hi there">Well</p>').map((c) => [c.line, c.text]), [
    [2, 'The binder'],
    [5, 'Hi there'],
    [5, 'Well'],
  ]);
  for (const code of ['scroll', 'pdf-scroll', 'c-chip c-chip--counsel', 'a span', 'ArrowLeft']) {
    assert.equal(looksLikeCopy(code), code === 'a span' || code === 'ArrowLeft', code);
  }
  const md = '# Set up\n\n```bash\nnpm ci\n```\n\nRun `npm test`, then [read it](https://x.test/a).\nIt wraps.\n\n<!-- A note. -->\n';
  assert.deepEqual(mdCopy(md).map((c) => [c.line, c.text]), [
    [1, '# Set up'],
    [7, 'Run , then [read it] . It wraps.'],
  ]);
  assert.deepEqual(copyOf('a.json', '{\n  "description": "Read-only search.",\n  "id": "abc"\n}').map((c) => [c.line, c.text]), [[2, 'Read-only search.']]);
});

test('the voice rules catch what DESIGN.md bans', () => {
  const hit = (text: string) => BANNED.filter(([, rule]) => rule.test(text)).map(([what]) => what);
  assert.deepEqual(hit('Well met. Ask about a person.'), ['"well met"']);
  assert.deepEqual(hit('The elf keeps the scrolls.'), ['a stage or fantasy word']);
  assert.deepEqual(hit('Legallas is reading the file.'), ['"Legallas is..."']);
  assert.deepEqual(hit('Saved!'), ['an exclamation mark']);
  assert.deepEqual(hit('Done — next.'), ['an em dash']);
  for (const game of ['You earned 40 XP.', 'Level up your proof.', 'Leveled up.', 'Achievement unlocked.', 'Three achievements.']) {
    assert.deepEqual(hit(game), ['game vocabulary'], game);
  }
  for (const fine of ['Not a lawyer or law firm.', 'Have your own lawyer review.', "Counsel's comment threads."]) {
    assert.deepEqual(hit(fine), [], fine);
  }
  for (const fine of ["I don't know", 'a != b', 'display:none!important', 'Elfin', 'Expert report', 'Sea level upon filing']) {
    assert.deepEqual(hit(fine), [], fine);
  }
});

test('the wording rules catch what A1 bans', () => {
  const hit = (text: string) => WORDING.filter(([, rule]) => rule.test(text)).map(([what]) => what);
  const caught: Record<string, string[]> = {
    'a lawyer title': ['Acts as your general counsel.', 'A superintelligent assistant.', 'Your AI lawyer.', 'Your legal adviser.', 'A legal consultant.', 'J. Doe, Esq.', 'Ask the counselor.'],
    'the old tagline: say "AI agent for legal work"': ['Your Legal Agent.'],
    'say "You aren\'t receiving legal advice from a licensed lawyer"': ['Research support, not legal advice.', 'It does not give legal advice.', "It doesn't provide legal advice.", 'For informational purposes only.'],
    'say "Lists the documents startups commonly keep"': ['It knows what you need.'],
    'say "Fills in the form you chose with the answers you give"': ['Legallas files it for you.', 'It takes care of it.', 'We handle everything.'],
    'a promise: show every option, then "Recommended"': ['This is the only choice.', 'Guaranteed results.'],
    'say "Checked against [source] on [date]"': ['Ironclad terms.', 'Verified sources.', 'Each citation is verified.'],
    'say "No matching, no introductions, no investor lists"': ['Find investors fast.', 'Warm intros to angels.', 'Our investor network.', 'Better deal flow.', 'Get funded.', 'Raise faster.', 'The best deals.', 'Your AI analyst.', 'An AI adviser.'],
    'say "Have your own lawyer review"': ['It works like a lawyer.', 'It replaces a lawyer.', 'Lawyer-grade drafts.', 'No need for a lawyer.', 'Saves you legal fees.', 'Pay less for lawyers.'],
    'say "You aren\'t receiving tax advice from a licensed tax professional"': ['This is not tax advice.', 'Your tax adviser.', 'Tax planning for founders.', 'It saves you tax.'],
    'a first-person feeling or opinion': ['In my opinion, sign it.', "I'm happy to help.", "I'm sorry, that failed."],
  };
  assert.deepEqual(Object.keys(caught), WORDING.map(([what]) => what), 'examples for every rule');
  for (const [what, texts] of Object.entries(caught)) for (const text of texts) assert.deepEqual(hit(text), [what], text);
  const fine = [
    "Counsel's comment threads.",
    'Attorney-client privilege',
    'Verified domain',
    'NOT VERIFIED: the date of the board vote.',
    "Legallas won't find investors.",
    'SEC Investment Adviser Public Disclosure',
    'Saving tax records.',
    'A guaranteed loan.',
  ];
  for (const text of fine) assert.deepEqual(hit(text), [], text);
});

test('every A1 "Say", and every notice the notices file quotes, passes the wording rules', () => {
  const lines = [...a1Rows().map(([say]) => say), ...NOTICES.split('\n').filter((line) => line.startsWith('> ')).map((line) => line.slice(2))];
  assert.deepEqual(lines.filter((line) => WORDING.some(([, rule]) => rule.test(line))), []);
});

test('every A1 "Don\'t say" phrase is banned, or left out with a reason', () => {
  const phrases = a1Rows().flatMap(([, dont]) => dont);
  const caught = (phrase: string) => WORDING.some(([, rule]) => rule.test(phrase));
  assert.deepEqual(phrases.filter((phrase) => !caught(phrase) && !LEFT_OUT.has(phrase)), [], 'ban these in WORDING, or say why in LEFT_OUT');
  assert.deepEqual([...LEFT_OUT.keys()].filter((phrase) => caught(phrase) || !phrases.includes(phrase)), [], 'drop these from LEFT_OUT');
});

test('no product text breaks the voice or wording rules', () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const path of files(join(WEB, root))) {
      const rel = relative(WEB, path);
      if (EXEMPT.test(rel)) continue;
      for (const { line, text } of copyOf(rel, readFileSync(path, 'utf8'))) {
        for (const [what, rule] of BANNED) {
          if (rule.test(text) && !ALLOWED.has(`${rel} ${what}: ${text}`)) offenders.push(`${rel}:${line} ${what}: ${text}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'DESIGN.md section 9 or product notices A1: reword these');
});

test('every empty state is one sentence ending in a period', () => {
  const offenders: string[] = [];
  for (const path of files(join(WEB, 'src'))) {
    if (!path.endsWith('.astro')) continue;
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/<LegallasEmpty\b[^>]*?\btitle="([^"]*)"/g)) {
      const title = match[1]!;
      if (!/^[^.!?]+\.$/.test(title)) offenders.push(`${relative(WEB, path)}: ${title}`);
    }
  }
  assert.deepEqual(offenders, [], 'an empty state is one plain sentence that ends in a period');
});

test('every allowance names a file that still exists, so a stale one cannot linger (#220)', () => {
  for (const entry of ALLOWED) {
    const rel = entry.slice(0, entry.indexOf(' '));
    assert.ok(existsSync(join(WEB, rel)), `${rel} no longer exists; drop its allowance`);
  }
});
