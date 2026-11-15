// SPDX-License-Identifier: Apache-2.0
// "Questions for your lawyer": the checklist's open points as a document a founder can hand over, each with its cites: the
// public source behind the item, and the control number and place of any document in the room. It asks; it never says what
// the answer is. Built from the same view as the page (worker/checklist.ts), so the two can't disagree. Pure.
//
// Parties, amounts and file names came from people, so they're escaped for Markdown: they read as text in any viewer, and
// can't add a link or an image to a document someone else will open.
import { MONTH_NAMES, type ChecklistView, type ServedDate, type ServedItem, type ServedMatch } from './checklist.ts';

/** What every copy says about how it was made (docs/legal/product-notices.md, A4 and A12). */
export const PREPARED_LINE = 'Prepared with AI from the Legallas checklist and the facts entered in this room. Not reviewed by a qualified person.';

/**
 * Text as literal Markdown, whatever a viewer does with it. Line breaks become spaces, so nothing starts a line of its
 * own, and brackets are escaped, so nothing makes a link or an image. Parentheses stay: "Section 83(b)" must read as itself.
 */
export function plainText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>|~]/g, '\\$&');
}

function formatControl(prefix: string | null, seq: number | null): string {
  return prefix === null || seq === null ? '' : `${prefix}-${String(seq).padStart(6, '0')}`;
}

/** The room's cite for a matched document: control number, then where it lives. */
function documentCite(match: ServedMatch, prefix: string | null): string {
  const control = formatControl(prefix, match.control);
  return `${control ? `${control}, ` : ''}${plainText(match.where)}`;
}

function sourceCites(item: ServedItem): string {
  return item.sources.map((source) => `[${plainText(source.title)}](${source.url})`).join('; ');
}

const SIGNED_WORDS = { yes: 'signed', no: 'not signed yet', not_needed: 'no signature needed' } as const;

/** A match's key facts in a line. */
function factsOf(match: ServedMatch, dateLabel: string): string {
  const facts = [
    match.signed ? SIGNED_WORDS[match.signed] : 'not known if signed',
    match.date ? `${dateLabel.toLowerCase()} ${match.date}` : null,
    match.parties ? `parties: ${plainText(match.parties)}` : null,
    match.amount ? `amount: ${plainText(match.amount)}` : null,
    match.nextDate ? `next date: ${match.nextDate}` : null,
  ];
  return facts.filter(Boolean).join('; ');
}

function roomDocuments(item: ServedItem, prefix: string | null): string[] {
  return item.matches.filter((match) => match.href !== null).map((match) => `   - In the room: ${documentCite(match, prefix)} (${factsOf(match, item.dateLabel)})`);
}

/** The lines every entry carries: why it comes up, the deadline if any, and its public sources. */
function guidance(item: ServedItem): string[] {
  return [
    `   - Why it comes up: ${plainText(item.why)}`,
    item.appliesWhen ? `   - When: ${plainText(item.appliesWhen)}` : null,
    item.deadline ? `   - Deadline, in general: ${plainText(item.deadline)}` : null,
    item.note ? `   - Also: ${plainText(item.note)}` : null,
    `   - Sources: ${sourceCites(item)}`,
  ].filter((line): line is string => line !== null);
}

function section(heading: string, intro: string, entries: readonly string[][]): string[] {
  if (entries.length === 0) return [];
  return [`## ${heading}`, '', intro, '', ...entries.flatMap((lines, i) => [`${i + 1}. ${lines[0]}`, ...lines.slice(1), '']) ];
}

function dateEntry(date: ServedDate, item: ServedItem, prefix: string | null): string[] {
  const window = date.opens ? `${date.opens} to ${date.date}` : date.date;
  const question =
    date.state === 'check' ? 'Has each person filed their own? The room cannot tell whose filing is whose.' : date.state === 'late' ? 'This was filed after the date. What follows from that?' : date.state === 'passed' ? 'This date has passed. What can be done now, if anything?' : 'Is this the right date for this company?';
  return [`**${plainText(date.title)}: ${window}.** ${question}`, `   - Worked out from: ${plainText(date.basis)}`, ...roomDocuments(item, prefix), ...guidance(item)];
}

/** A file name for the download: no names, so it can sit in a folder or an email without saying whose it is. */
export function questionsFileName(today: string): string {
  return `questions-for-your-lawyer-${today}.md`;
}

/** The whole pack, as Markdown. `prefix` is the room's control prefix; with none set, a document is cited by where it lives. */
export function questionsPack(view: ChecklistView, prefix: string | null): string {
  const byId = new Map(view.items.map((item) => [item.id, item]));
  const of = (status: ServedItem['status']) => view.items.filter((item) => item.status === status);
  const dates = view.dates.filter((date) => date.state !== 'done').flatMap((date) => {
    const item = byId.get(date.itemId);
    return item ? [dateEntry(date, item, prefix)] : [];
  });
  const notYet = of('not_yet').length;
  const lines: string[] = [
    '# Questions for your lawyer',
    '',
    `> ${view.notice}`,
    '',
    `${view.status} ${PREPARED_LINE}`,
    '',
    `- Company: ${view.entityLabel ?? 'entity type not set in the room'}${view.formationDate ? `, formed ${view.formationDate}` : ', formation date not set in the room'}${view.reportMonth ? `, Colorado report month ${MONTH_NAMES[view.reportMonth - 1]}` : ''}`,
    `- Stages reached: ${view.reachedStageLabels.join(', ')}, from the documents in the room`,
    `- Prepared: ${view.today}, from the checklist drafted ${view.drafted}`,
    `- Covers: ${view.scope}`,
    '',
    ...section(
      'Dates',
      'Each is arithmetic on a date in the room, in calendar days. A weekend or legal holiday may move a last day later.',
      dates,
    ),
    ...section(
      'Not in the room',
      'Companies commonly have these by this stage, and nothing in the room is matched to them.',
      of('missing').map((item) => [`**${plainText(item.title)}.** Does this company need it, and if so, what should it cover?`, `   - A complete copy commonly looks like: ${plainText(item.evidence)}`, ...guidance(item)]),
    ),
    ...section(
      'To check',
      'A document is matched to each of these, and nobody has said it is signed.',
      of('check').map((item) => [`**${plainText(item.title)}.** Is this copy complete, and does it need to be signed?`, ...roomDocuments(item, prefix), `   - A complete copy commonly looks like: ${plainText(item.evidence)}`, ...guidance(item)]),
    ),
    ...section(
      'If it applies',
      'Only some companies keep these.',
      of('if_applies').map((item) => [`**${plainText(item.title)}.** Does this apply to this company?`, ...guidance(item)]),
    ),
    ...section(
      'Said not to apply',
      'Someone in the room said these do not apply to this company.',
      of('not_applicable').map((item) => [`**${plainText(item.title)}.** Is that right?`, ...guidance(item)]),
    ),
    ...section(
      'In place',
      'For reference. A document is matched to each, and someone has said it is signed or needs no signature.',
      of('in_place').map((item) => [`**${plainText(item.title)}**`, ...roomDocuments(item, prefix)]),
    ),
    ...(notYet > 0 ? [`${notYet} items companies commonly reach at later stages are left out.`, ''] : []),
    '---',
    '',
    view.notice,
    '',
  ];
  return lines.join('\n');
}
