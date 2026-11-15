// SPDX-License-Identifier: Apache-2.0
// The lines the product shows about what it is, word for word from docs/legal/product-notices.md (A2).

/** Wherever the agent speaks: the room's footer, the top of Ask and the connector's first reply in a session. */
export const SHORT_LINE =
  'Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.';

/** Above Ask's options and recommendation, the room's own model (A4). */
export const RECOMMENDATION_STAMP = 'Draft for your review. Prepared with AI. Not reviewed by a qualified person.';
/** Under the stamp, always (A4). */
export const RECOMMENDATION_NOTE =
  "This is an AI's reading of the law and of the facts you gave it, not a lawyer's advice. All the options are shown above. You decide.";

/** Under a recommendation on an investor question (A4). */
export const INVESTOR_LINE =
  "This is an AI's recommendation, not advice from a registered investment adviser. Check the terms, what's missing and what public records show before you decide.";

/** Under a recommendation on a tax question (A4). */
export const TAX_LINE =
  "This shows the tax law with its source, read by AI. You aren't receiving tax advice from a licensed tax professional. Have your own tax professional review before you file, elect or pay.";

/** A4's guard, when a question is whether to hire, fire, discipline, promote, pay, lend to, rent to or deny credit to a named person. */
export const PERSON_GUARD =
  "I can explain the documents, the law and the process. I won't score or recommend anything about this person. The decision and an independent review are yours.";
/** Ask's whole A4 line: the guard, then the Colorado duties. The connector has room for the guard only (mcp/server.ts). */
export const PERSON_DECISION_LINE = `${PERSON_GUARD} If you do business in Colorado, using AI in a decision like this may bring duties of your own from January 1, 2027: notice, a statement after an adverse decision, correction, human review and three years of records.`;

/** Under every dispute answer (A8). */
export const DISPUTE_LINES = [
  "Keep everything. Don't delete documents, chats or messages. Some clocks are short, and rights can be lost by what you sign, say or delay.",
  "Legallas won't draft anything to the other side or for a court unless your lawyer is in the room.",
] as const;

/** A source the room checked (A1), never "verified": fill in [source] and [date]. */
export const CHECKED_AGAINST = 'Checked against [source] on [date]';
/** A source it didn't check (A4). */
export const NOT_CHECKED = 'not checked';

/** Before an 83(b) election (A6): the bold line, then the rest. */
export const ELECTION_83B = {
  title: "This can't be fixed later.",
  body: 'It must be filed no later than 30 days after [transfer date]: by [date]. You sign under penalties of perjury and mail it yourself. Mail it early, keep proof of mailing, and give the company a copy.',
} as const;

/** Form D (A6): the bold line and the sentence after it, which need no facts of the matter. */
export const FORM_D = {
  title: 'Must be filed within 15 days of first sale.',
  body: 'First sale is when the first investor is irrevocably committed, which can be when a SAFE is signed, even before the money arrives.',
} as const;

/** Any other deadline an answer names (A6): the bold line, then the rest. */
export const ANY_DEADLINE = {
  title: 'AI can miss or misread a deadline.',
  body: "Check the date and how it's counted yourself, and have your own lawyer review before you rely on it.",
} as const;

/** For narrow spaces, always visible during a conversation. */
export const COMPACT_LABEL = 'AI, not a person, not a lawyer. It can be wrong. Check with your lawyer.';

/** At the top of any case room (A7): the bold line, the paragraph after it, then the three cautions. */
export const CASE_ROOM_NOTICE = {
  title: 'Not private like talking to your lawyer.',
  body:
    "Legallas isn't a lawyer, and what you tell it, or tell an AI connected to it, isn't privileged just because it's about legal matters. Courts disagree on how far AI work is protected. One held that a person's chats with a public AI weren't protected at all, even after he gave them to his lawyer. Others protected some AI work done to prepare for a case.",
  cautions: [
    "Don't paste your lawyer's advice into an AI unless your lawyer has told you to. It can lose protection.",
    "Don't put the other side's confidential documents into an AI until you've checked the court's protective order.",
    ["If a dispute is possible, ask your lawyer how to use AI ", 'before', " you start, and don't delete anything."],
  ] as const,
} as const;
