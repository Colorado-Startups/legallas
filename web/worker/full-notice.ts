// SPDX-License-Identifier: Apache-2.0
// A3 and its tick, in docs/legal/product-notices.md's own Markdown. full-notice.test.ts pins them to it both ways.

export const FULL_NOTICE = [
  '**Before you use Legallas**',
  "**What it is.** Legallas is an AI agent for legal work. It's software that runs in your own accounts. It researches, lays out every option, recommends one with its sources, and fills in the forms you choose with the answers you give. You review everything and you decide.",
  "**What it isn't.** It isn't a lawyer or a law firm, a licensed legal paraprofessional, a tax professional or a registered investment adviser. Nobody at Colorado Startups acts as your lawyer. No lawyer has reviewed Legallas, its templates or how it answers. Using it doesn't create an attorney-client relationship with anyone.",
  "**AI can be wrong.** It can misread a document, miss a rule or a deadline, or invent a case or a citation that doesn't exist. Check every source yourself. If you file something with a made-up citation, the court can sanction you.",
  "**Have your own lawyer review before you sign, file or rely on anything.** Some mistakes can't be fixed later. The cost of a review is often small next to the cost of a mistake. Your state bar's referral service can help you find a lawyer.",
  "**What you say isn't privileged just because it's about legal matters.** Legallas isn't a lawyer. Neither is the AI you connect to it. [Read more](#a7-privilege-and-confidentiality).",
  "**Who can see what.** Your documents stay in your own accounts, and our software doesn't send us a copy. Passages go to whichever AI you or your invited lawyers connect, under that AI's own terms. Your hosting and storage providers hold your files under theirs. [Privacy notice].",
  "**What it won't do.** It won't represent you, contact anyone for you, or appear in court for you. It won't find or suggest investors, or handle money or securities. It isn't for criminal, custody or child-safety matters, and it isn't for deciding whether to hire, fire, lend to or rent to a person. In court, a company generally needs a lawyer.",
  "**Colorado Startups** doesn't provide law firm, broker, dealer, funding portal or investment adviser services, and isn't registered as any of these.",
] as const;

export const NOTICE_TICK =
  "I understand that by using Legallas I'm not receiving legal advice from a licensed lawyer or licensed legal paraprofessional, and I'm not engaging one. I've read the privacy notice and agree to it.";

/** A7's first-use block, where A3's "Read more" points. */
export const FIRST_USE_PRIVILEGE = [
  "**Not private like talking to your lawyer.** Legallas isn't a lawyer, and what you tell it, or tell an AI connected to it, isn't privileged just because it's about legal matters. Courts disagree on how far AI work is protected. One held that a person's chats with a public AI weren't protected at all, even after he gave them to his lawyer. Others protected some AI work done to prepare for a case.",
  "- Don't paste your lawyer's advice into an AI unless your lawyer has told you to. It can lose protection.",
  "- Don't put the other side's confidential documents into an AI until you've checked the court's protective order.",
  "- If a dispute is possible, ask your lawyer how to use AI **before** you start, and don't delete anything.",
] as const;

/** 32-bit FNV-1a: a label, not a secret. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

export function noticeVersion(notice: readonly string[], tick: string): string {
  return `A3-${fnv1a([...notice, tick].join('\n'))}`;
}

/** New words, new version: every member ticks again. */
export const NOTICE_VERSION = noticeVersion(FULL_NOTICE, NOTICE_TICK);

/** A member who ticked NOTICE_VERSION. The room (notice-gate.ts) and the MCP Worker both check it. D1, typed by shape. */
export async function tickedCurrent(db: { prepare(sql: string): { bind(...values: string[]): { first(): Promise<unknown> } } }, email: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT n.ticked_at FROM members m JOIN notice_acks n ON n.email = m.email WHERE m.email = ?1 AND n.version = ?2')
    .bind(email, NOTICE_VERSION)
    .first();
  return row !== null;
}
