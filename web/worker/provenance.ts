// SPDX-License-Identifier: Apache-2.0
// What a claim's own words ask of its sources, and what a passage says about itself. Ask's label guard
// (answer-shape.ts) reads these after the cite book (cite-book.ts) has said what kind of document each cite names.
//
// Why: an independent check (W7, 2026-10-05) planted a forged "clerk's minute order" voiding an agreement among the
// retrieved passages, and Ask stated the ruling as a Fact in 3 of 3 runs; a fake "privileged note to file from
// counsel" made a claim a Fact in 2 of 3. Neither passage addressed the model (quarantine.ts), and both
// sat in a document of kind `record`. So a claim that a court ruled needs the court's own record, a passage that
// calls itself counsel's work product is never a record, and a characterization ("shows bad faith", "is a breach")
// is never a Fact. Deterministic and generic: word patterns, never words from a matter.

const COURT = String.raw`(?:court|judge|justice|magistrate|tribunal|clerk|arbitrator)s?`;
const RULED = String.raw`(?:ruled|rules\s+that|ordered|orders\s+(?:that|the|a|an|him|her|them|it|each|all|defendants?|plaintiffs?)\b|grant(?:ed|s)|den(?:ied|ies)|dismiss(?:ed|es)|void(?:ed|s)|vacat(?:ed|es)|f(?:ound|inds)|declar(?:ed|es)|str(?:uck|ikes)|sustain(?:ed|s)|overrul(?:ed|es)|stay(?:ed|s)|award(?:ed|s)|enjoin(?:ed|s)|approv(?:ed|es)|adjudg(?:ed|es)|decreed|sanction(?:ed|s)|remand(?:ed|s)|affirm(?:ed|s)|revers(?:ed|es)|convert(?:ed|s)|enter(?:ed|s)(?!\s+into)|h(?:eld|olds)(?!\s+(?:a|an|the|its|oral)\s+(?:\w+\s+)?(?:hearing|conference|trial|call|session|meeting|argument)))`;
/** "The court found ...", "Judge Smith granted ...": a court as the subject of a ruling verb. */
const RULING_BY = new RegExp(String.raw`\b${COURT}\b[^;\n]{0,80}?\b${RULED}\b`, 'gi');
const PROCEEDING = String.raw`(?:motion|claims?|counts?|case|action|complaint|petition|appeal|objection|injunction|judgment|matter|suit|lawsuit|stay|extension|dismissal|agreement)`;
/** "The motion was granted", "the agreement was declared void": a proceeding as the subject of a passive ruling. */
const RULED_PASSIVE = new RegExp(
  String.raw`\b${PROCEEDING}\b[^;\n]{0,60}?\b(?:was|were|is|are|has been|have been|had been)\s+(?:\w+ly\s+)?(?:dismissed|granted|denied|vacated|voided|stricken|struck|enjoined|stayed|overruled|sustained|remanded|affirmed|reversed|converted|declared\s+(?:void|invalid|unenforceable|null))\b`,
  'gi',
);
/** The paper of a ruling named outright. */
const RULING_PAPER =
  /\b(?:minute order|(?:order|judgment|ruling|decree)\s+(?:granting|denying|dismissing|voiding|vacating|striking|converting|awarding|finding|declaring|holding)|dismiss(?:ed|al)\s+(?:with|without)\s+prejudice|so ordered|it is (?:so |hereby |further )?ordered|entered (?:judgment|an order|a judgment|default))\b/gi;
/**
 * "No" as a word, not the label of a number: "No. 12", "No.12", "No: 12", "No #12" and "No 12", and a number that opens
 * with letters, which Delaware Superior Court's do ("C.A. No N99C-01-001 ABC"; the format read on the court's opinion
 * list, 2026-11-01), as do many state courts'. "no order" and "no longer" have no digit, so they stay denials, and so
 * does a "No." and a space before a word with no digit, a sentence's end ("No. Order granting the motion", #51). Any
 * other "No:", "No #" or "No." stays a label, as before: a denial word only ever makes the fence trust less, so this
 * only gives up the label where `asserted` and every lead already end the clause at that period.
 */
export const NO_WORD = String.raw`no(?!\.(?=\S)|\.\s+[a-z-]*\d|\s*[#:]|\s+[a-z-]*\d)`;
/** Words that make a ruling's words a denial or a request: "no order granting", "the court has not ruled". */
const NOT_RULED = new RegExp(String.raw`\b(?:${NO_WORD}|not|never|neither|nor|yet to|without|whether|if|asks?|asked|asking|seeks?|seeking|sought|moves?|moved|requests?|requested|requesting|urges?)\b`, 'i');
/** Before a ruling's paper named outright, words that make it what someone asks for ("conversion to month-to-month by order granting possession"). */
const ASKED_FOR = new RegExp(String.raw`\b(?:motion (?:for|to)|conversion|seek\w*|ask\w*|request\w*|mov(?:es|ed|ing)|propos\w*|${NO_WORD}|not|without)\b`, 'i');

/**
 * A sentence's end: a period, question or exclamation mark and a space, not after an initial or a common abbreviation.
 * Never "No": a "No." that ends a sentence must split there, or NO_WORD would read it as a denial of what follows.
 */
const SENTENCE_END = /(?<!\b(?:[A-Za-z]|vs?|Mr|Mrs|Ms|Dr|Jr|Sr|St|Hon|Esq|Inc|Co|Corp|Ltd|LLC|Cal|Civ|Fed|Ct|App|Supp|Stat|Rev|Proc|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec))[.!?]\s+/;

/**
 * Whether some match of `pattern` in `text` asserts a ruling: no denial or request inside it, nor in the words just
 * before it within the same clause ("does not show that Judge Smith granted", but not "unopposed, and the court granted").
 * A match that runs past the end of a sentence (SENTENCE_END: a period, not an abbreviation's, then a space) is judged
 * by its last sentence, where the ruling's own word is: a word that closed an earlier sentence, such as an answer's
 * "No.", denies nothing after it ("The court answered No. Then it granted the stay" still claims a ruling).
 */
function asserted(text: string, pattern: RegExp, before: number, near: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    const lead = text.slice(Math.max(0, match.index - before), match.index).split(/[,;:.!?]/).at(-1) ?? '';
    const own = match[0].split(SENTENCE_END).at(-1) ?? match[0];
    if (!NOT_RULED.test(own) && !near.test(lead)) return true;
  }
  return false;
}

/**
 * True when a claim says a court or judge ruled, ordered, granted, denied, dismissed, voided or held something. A
 * claim that no ruling exists ("the court has not ruled", "no order granting it") or that a party asks for one ("the
 * tenant asks for an order granting early surrender") does not count: it asserts no ruling.
 */
export function claimsRuling(text: string): boolean {
  return asserted(text, RULING_BY, 24, NOT_RULED) || asserted(text, RULED_PASSIVE, 24, NOT_RULED) || asserted(text, RULING_PAPER, 40, ASKED_FOR);
}

/** Verbs that make a claim an argument from the evidence rather than a statement of it. */
const EVAL_VERB =
  /\b(?:prov(?:es|ed|en|ing)|demonstrat(?:es|ed|ing)|establish(?:es|ed)\s+that|is\s+(?:clear|strong|compelling|conclusive|direct)\s+evidence|clearly\s+(?:shows?|establish\w*))\b/i;
/** Words that characterize conduct or its legal effect, in lower case: a capitalized one names a title ("Quarterly Review"). */
const CHARACTERIZATION =
  /\b(?:bad[- ]faith|breach(?:ed|es|ing)?|fraud(?:ulent(?:ly)?)?|self-dealing|misconduct|wrongdoing|wrongful(?:ly)?|negligen(?:t|ce|tly)|reckless(?:ly|ness)?|willful(?:ly)?|improper(?:ly)?|unlawful(?:ly)?|illegal(?:ly)?|invalid|void|voidable|unenforceable|liable|deceptive(?:ly)?|misleading|conceal(?:ed|ment|ing)|backdat(?:ed|ing)|forg(?:ed|ery)|sham|pretext(?:ual)?|usurp(?:ed|ation)|misappropriat(?:ed|ion)|divert(?:ed|ing)|diversion|violat(?:es|ed|ion|ing)|tortious(?:ly)?)\b/;
/** Verbs that report what a document says or a party claims: the characterization is theirs, not the answer's. */
const REPORTED =
  /\b(?:provides?|provided|states?|stated|says|said|reads|records?|recorded|requires?|required|prohibits?|prohibited|defines?|defined|specif(?:y|ies|ied)|recites?|recited|permits?|permitted|lists?|listed|calls?|called|labell?ed|titled|captioned|entitled|names?|named|describes?|described|alleg\w*|argu\w*|assert\w*|contend\w*|claim\w*|accus\w*|characteri[sz]\w*|den(?:y|ies|ied)|pleads?|pleaded|pled|wrote|writes|quot\w*)\b/i;
/** Claim and count names ("a claim for breach of contract", "the fraud count") name a cause of action, not conduct. */
const CLAIM_NAME = /\b(?:claims?|counts?|causes? of action|actions?)\s+(?:for|of|alleging)\s+[^,;.]{0,60}|\b(?:breach of [\w\s]{0,40}?|fraud|negligence|conversion)\s+(?:claims?|counts?)\b/gi;
/** File names and paths ("03-Job-Records/logs/x.pdf", "Invoice_Void"): a name, not a characterization. */
const FILE_NAME = /\S*[/\\_]\S*/g;
/** Quoted spans: words inside quotation marks are the document's, not the answer's. */
const QUOTED = /["“][^"“”\n]{0,400}["”]/g;

/** True when a claim characterizes conduct or its legal effect in the answer's own voice ("shows bad faith"). */
export function isEvaluative(text: string): boolean {
  const own = text.replace(QUOTED, ' ').replace(FILE_NAME, ' ').replace(CLAIM_NAME, ' ');
  if (EVAL_VERB.test(own)) return true;
  return CHARACTERIZATION.test(own) && !REPORTED.test(own);
}

/** Nouns that name where a statement comes from. */
const SOURCE_NOUN = String.raw`(?:e-?mails?|letters?|messages?|threads?|repl(?:y|ies)|responses?|notes?|memos?|memorand(?:um|a)|notices?|demands?|filings?|motions?|complaints?|pleadings?|briefs?|petitions?|schedules?|posts?|articles?|reports?|passages?|case picture|texts?|minutes|transcripts?|files?|catalog|chronology|register|docket)`;
const REPORT_VERB = String.raw`(?:corroborat\w*|confirm\w*|show(?:s|ed|n)?|indicat\w*|reflect\w*|list(?:s|ed)?|not(?:es|ed)|record(?:s|ed)?|attach\w*|forward\w*|mention\w*|refer(?:s|red)?|cit(?:es|ed)|quot\w*|suggest\w*|summari[sz]\w*|recit\w*|recount\w*|states?|stated|says|said|reads|marks?|marked|provides?|sets? out|lays? out|address(?:es|ed)|(?:was|were|is|are)\s+(?:addressed|sent|copied|forwarded|written|signed|dated))`;
/** A word inside a subject's noun phrase ("A May 7, 2012 supplier email"): never a joining word that starts a new clause. */
const SUBJECT_WORD = String.raw`(?!(?:after|before|when|since|until|because|while|that|which|who|whom|was|were|is|are|had|has|have|did|does|and|or|but|to|by|with|from|of|on|at|for|in)\b)[\w,.'’-]+`;
/**
 * "Doe's June 15 email was addressed to ...", "The schedule lists ...": a claim whose subject is its source. Only at
 * the claim's start: a source named in a later clause ("...; the email was sent the next day") is content, not attribution.
 */
const NAMED_SOURCE = new RegExp(
  String.raw`^(?:the|a|an|this|that|these|those|his|her|their|its|our|one|another|same|(?:[a-z][\w.-]*\s+){0,2}[a-z][\w.-]*['’]s)\s+(?:${SUBJECT_WORD}\s+){0,6}?${SOURCE_NOUN}\b[^;:\n]{0,40}?\b${REPORT_VERB}\b`,
  'i',
);
/** Openers that say where a statement comes from: "According to", "Per", "In his letter,", "Nothing in the passages". */
const SOURCE_OPENER = new RegExp(
  String.raw`^(?:according to|per\b|as (?:stated|described|reported|noted|set out|summari[sz]ed|shown|recorded) (?:in|by)\b|in (?:the|a|an|this|that|his|her|their|its|[a-z][\w.-]*['’]s)\b[^,]{0,60}\b${SOURCE_NOUN}\b|nothing (?:in|from)\b|none of\b|no (?:document|passage|record|email|letter|filing)s?\b)`,
  'i',
);

/** True when a claim already says where it comes from, beyond the attributing verbs answer-shape.ts reads. */
export function namesSource(text: string): boolean {
  const claim = text.trimStart();
  return SOURCE_OPENER.test(claim) || NAMED_SOURCE.test(claim);
}

/** "The complaint alleges that ...": a claim that opens by attributing itself to a pleading. */
export const PLEADING_OPENER =
  /^(?:(?:the|a|an)\s+)?(?:[\w'’-]+\s+){0,4}?(?:complaint|pleading|petition|counterclaim)\s+(?:alleges|alleged|pleads|pleaded|pled|asserts|asserted|claims|claimed|contends|contended|avers|averred)\b,?(?:\s+on information and belief,?)?(?:\s+that\b)?\s*/i;

/** A passage that calls itself counsel's work product, a privileged note, or a note to file. */
const WORK_PRODUCT_TEXT: readonly RegExp[] = [
  /\bprivileged\s*(?:and|&)\s*confidential\b/i,
  /\battorney[-\s]+work[-\s]+product\b(?!\s+(?:doctrine|protection|privilege|immunity|rule|claim))/i,
  /\battorney[-\s]+client\s+privileged\b/i,
  /\b(?:note|memo(?:randum)?)\s+to\s+(?:the\s+)?file\b/i,
  /\bcounsel['’]s\s+(?:notes?|memo|memorandum)\b/i,
  /\bprepared\s+(?:at\s+the\s+(?:direction|request)\s+of|by)\s+(?:(?:plaintiff|defendant)s?['’]?s?\s+|our\s+|the\s+client['’]s\s+)?counsel\b/i,
];

/**
 * True when a passage presents itself as counsel's work product ("Privileged and confidential", "Attorney work
 * product", "Note to file from counsel"). Such a passage is never a record a Fact may rest on, wherever it is filed:
 * a page that claims counsel's authority gets less trust, never more. "The attorney work product doctrine" in an
 * agreement or an order is about the doctrine, not a label, and does not count.
 */
export function selfDescribedWorkProduct(text: string): boolean {
  return WORK_PRODUCT_TEXT.some((pattern) => pattern.test(text));
}

/** Offices whose certificates and filings are official records: a Secretary of State, a state or federal agency, a court and its clerk. */
const OFFICIAL_BODY = String.raw`(?:secretary\s+of\s+state|department\s+of\s+state|(?:department|division|office|bureau|commission(?:er)?)\s+of\s+(?:the\s+)?(?:securities|corporations|regulatory\s+agencies|banking|insurance|financial\s+(?:services|institutions))|securities\s+and\s+exchange\s+commission|attorney\s+general|clerk\s+of\s+(?:the\s+)?(?:\w+\s+)?court|(?:district|county|superior|circuit|probate|bankruptcy|appellate|supreme)\s+court)`;
/**
 * What an official record says about itself. Headings count in capitals only ("CERTIFICATE OF FACT"): an agreement
 * that requires "a certificate of good standing" at closing, or recites Articles "filed with the Secretary of State",
 * refers to a record and is not one. A court's e-filing stamp is left out: every filed exhibit carries one.
 */
const OFFICIAL_TEXT: readonly RegExp[] = [
  // "I, the Secretary of State of the State of Maine, hereby certify that ..."
  new RegExp(String.raw`\b${OFFICIAL_BODY}\b[^.;]{0,160}?\b(?:hereby\s+certif(?:y|ies)|do(?:es)?\s+certify)\b`, 'gi'),
  /\bCERTIFICATE\s+OF\s+(?:GOOD\s+STANDING|FACT|EXISTENCE|STATUS|AUTHORITY)\b/g,
  /\bfiling\s+receipt\b/gi,
  /\bFILED\b[^.;\n]{0,60}?\b(?:SECRETARY\s+OF\s+STATE|Secretary\s+of\s+State)\b/g,
  // An agency's letterhead: "STATE OF MAINE, DEPARTMENT OF STATE", "UNITED STATES SECURITIES AND EXCHANGE COMMISSION".
  /\b(?:STATE\s+OF\s+[A-Z]{3,}(?:\s+[A-Z]{3,})?|UNITED\s+STATES)\s*,?\s+(?:DEPARTMENT|DIVISION|OFFICE|BUREAU)\s+OF\b/g,
  // The SEC's letterhead names its address; a securities legend names the Commission alone ("NOT APPROVED BY THE ...").
  /\bUNITED\s+STATES\s+SECURITIES\s+AND\s+EXCHANGE\s+COMMISSION\s*,?\s+Washington\b/gi,
  // A court's order on its face.
  /\bMINUTE\s+ORDER\b/g,
  /\bit\s+is\s+(?:so\s+|hereby\s+|further\s+)?ordered\b|\bby\s+the\s+court\s*:/gi,
];
/** Words just before a heading that deny it: "There is no certificate of good standing", "not a minute order". */
const NOT_OFFICIAL = new RegExp(String.raw`\b(?:${NO_WORD}|not|never|neither|nor|without|whether|if|absent|lacks?|missing)\b`, 'i');

/**
 * True when a passage presents itself as an official record: a Secretary of State's or an agency's certificate, a
 * filing receipt or filed stamp, an agency's letterhead, or a court's order. Such a passage supports a Fact only where
 * the room files official records (source-kind.ts isOfficialHome); anywhere else it is a document's statement, because
 * a page that claims an office's authority gets less trust, never more. Words that deny the record ("no certificate
 * of good standing was issued") do not count.
 */
export function selfDescribedOfficialRecord(text: string): boolean {
  return OFFICIAL_TEXT.some((pattern) => {
    for (const match of text.matchAll(pattern)) {
      const lead = text.slice(Math.max(0, match.index - 60), match.index).split(/[,;:.!?\n]/).at(-1) ?? '';
      if (!NOT_OFFICIAL.test(lead)) return true;
    }
    return false;
  });
}

/** A court named as a caption, in capitals ("DISTRICT COURT, EXAMPLE COUNTY", "IN THE SUPERIOR COURT OF ..."). */
const COURT_CAPTION =
  /\b(?:(?:UNITED\s+STATES\s+)?(?:DISTRICT|COUNTY|SUPERIOR|CIRCUIT|PROBATE|BANKRUPTCY|APPELLATE|SUPREME|MUNICIPAL|JUVENILE|FAMILY|CHANCERY|STATE)\s+COURT|COURT\s+OF\s+(?:APPEALS?|CHANCERY|COMMON\s+PLEAS|CLAIMS))\b/g;
/**
 * A case number on a caption ("Case No. 2099CV00001", "Civil Action No. 1:99-cv-00012", "C.A. No. N99C-01-001"). It
 * may open with letters but holds a digit, so "case no longer" and "docket number pending" are not one.
 */
const CASE_NUMBER = /\b(?:case|civil\s+action|c\.\s?a\.|docket|cause)\s+(?:no\.?|number|#)\s*:?\s*(?=[\w:.-]*\d)[0-9a-z][\w:.-]{3,}/gi;
/** A court's disposition or the heading of its order, on the paper's face. */
const DISPOSITION: readonly RegExp[] = [
  /\b(?:it\s+is\s+)?(?:so|hereby|further)\s+ordered\b|\bit\s+is\s+ordered\b|\bby\s+the\s+court\s*:/gi,
  /\bMINUTE\s+ORDER\b|\b(?:ORDER|JUDGMENT|DECREE)\s*(?::|\b(?:RE|ON|GRANTING|DENYING|REGARDING|AFTER|AND|OF\s+DISMISSAL)\b)/g,
  // "The Court GRANTS the Motion", "The Court hereby denies ...": the court speaking in the present, as only its order does.
  /\bthe\s+court\s+hereby\s+(?:grants|denies|orders|finds|dismisses|vacates|converts|awards|enters)\b/gi,
  /\b(?:THE|[Tt]he)\s+(?:COURT|[Cc]ourt)\s+(?:GRANTS|DENIES|ORDERS|FINDS|DISMISSES|VACATES|CONVERTS|AWARDS|ENTERS)\b/g,
];

/**
 * Words that deny an order outright ("no order has entered", "without a ruling"). Narrower than NOT_OFFICIAL: this
 * check fences, so a forged order must not escape by putting "if" or "whether" before its words, and a case number's
 * "No" is not a denial (NO_WORD).
 */
const DENIED = new RegExp(String.raw`\b(?:${NO_WORD}|not|never|neither|nor|without|absent|lacks?|missing)\b`, 'i');

/** Whether some match of `pattern` stands on its own: no denial in the words just before it in the same clause. */
function stated(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    const lead = text.slice(Math.max(0, match.index - 60), match.index).split(/[,;:.!?\n]/).at(-1) ?? '';
    if (!DENIED.test(lead)) return true;
  }
  return false;
}

/**
 * True when a passage presents itself as a court's order or judgment on its face: a court caption or case number
 * together with the court's own disposition ("SO ORDERED", "IT IS ORDERED", "BY THE COURT:", "The Court GRANTS") or
 * an order's heading ("ORDER RE:", "MINUTE ORDER"). Only the court's record may carry that (quarantine.ts fences
 * such a passage anywhere else). Letters and memos that discuss an order, and denials ("no order has entered"), do
 * not count; a party's papers carry captions and proposed orders, so quarantine.ts leaves filings to the label guard.
 */
export function selfDescribedCourtRuling(text: string): boolean {
  const captioned = stated(text, COURT_CAPTION) || stated(text, CASE_NUMBER);
  return captioned && DISPOSITION.some((pattern) => stated(text, pattern));
}
