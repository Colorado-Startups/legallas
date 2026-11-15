// SPDX-License-Identifier: Apache-2.0
// A company room's checklist card (components/ChecklistCard.astro), drawn before the Overview leaves the Worker. The build
// ships the card hidden, and checklist-card.ts filled it from /api/checklist/summary seconds after the first paint on a
// phone: the card was the page's largest paint, and showing it pushed "Where your documents live" down the screen. The
// Worker reads the same summary and draws the same rows (src/scripts/checklist-rows.ts), so nothing waits or moves.
//
// The lookup gets SHAPE_WAIT_MS, as the AI panel's does (overview-ai.ts). Slower, or failing, the page goes out as built
// and the card's script fills it as before.
import { canPerform } from './auth.ts';
import { checklistEnabled, checklistSummary, type ChecklistSetting, type ChecklistSummary } from './checklist.ts';
import type { Member } from './env.ts';
import { SHAPE_WAIT_MS, withoutEtag } from './overview-ai.ts';
import { readChecklist } from './routes/checklist.ts';
import { companyLine, dateRowWith, formingLine, stageRowWith, type Make } from '../src/scripts/checklist-rows.ts';

export type ChecklistCardEnv = ChecklistSetting & { DB?: D1Database; TIME_ZONE?: string };

/** The card's summary as `member` would get it from /api/checklist/summary; null when the room serves none, or not in time. */
export async function checklistCard(env: ChecklistCardEnv, member: Pick<Member, 'role'>, waitMs = SHAPE_WAIT_MS): Promise<ChecklistSummary | null> {
  if (!checklistEnabled(env) || !env.DB || !canPerform(member.role, 'view')) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  try {
    const read = readChecklist(env.DB, member.role, env.TIME_ZONE).then(({ view }) => checklistSummary(view));
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Markup the Worker built: a child that is not a string is taken as it is. */
interface Html {
  readonly html: string;
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text: string) => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!); // safe: the class holds only ESCAPES' keys

/** checklist-rows.ts's maker for the Worker: tags and attribute names come from that code; every value and text is escaped. */
export const htmlEl: Make<Html> = (tag, attrs, ...children) => {
  const named = Object.entries(attrs).flatMap(([name, value]) => (value === undefined ? [] : [` ${name}="${escape(value)}"`]));
  const inner = children.map((child) => (!child ? '' : typeof child === 'string' ? escape(child) : child.html));
  return { html: `<${tag}${named.join('')}>${inner.join('')}</${tag}>` };
};

export interface CardParts {
  title: string;
  company: string;
  /** Markup, from htmlEl. */
  stages: string;
  /** Markup, from htmlEl. */
  dates: string;
  notice: string;
}

/** What checklist-card.ts writes into each part, as text or as markup. */
export function cardParts(summary: ChecklistSummary): CardParts {
  return {
    title: formingLine(summary.stages),
    company: companyLine(summary),
    stages: summary.stages.map((stage) => stageRowWith(htmlEl, stage).html).join(''),
    dates: summary.nextDates.map((date) => dateRowWith(htmlEl, date, { withTitle: true, withBasis: false }).html).join(''),
    notice: `${summary.notice} ${summary.status}`,
  };
}

/** The Overview with its checklist card drawn and shown. Marked data-shaped="server" so the card's script leaves it. */
export function shapeChecklistCard(page: Response, summary: ChecklistSummary): Response {
  const parts = cardParts(summary);
  const text = (value: string) => ({ element: (part: Element) => void part.setInnerContent(value) });
  const markup = (value: string) => ({ element: (part: Element) => void part.setInnerContent(value, { html: true }) });
  return new HTMLRewriter()
    .on('[data-checklist-card]', {
      element: (card) => {
        card.removeAttribute('hidden');
        card.setAttribute('data-shaped', 'server');
      },
    })
    .on('[data-checklist-card-title]', text(parts.title))
    .on('[data-checklist-card-company]', text(parts.company))
    .on('[data-checklist-card-stages]', markup(parts.stages))
    .on('[data-checklist-card-dates]', markup(parts.dates))
    .on('[data-checklist-card-notice]', text(parts.notice))
    .transform(withoutEtag(page));
}
