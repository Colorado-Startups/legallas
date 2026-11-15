# Investor templates

> Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.
>
> No lawyer has reviewed these documents.

This folder holds the investor side of Legallas's document set: angels investing, angels creating a group, and venture
funds investing, plus what investors should know when founders and investors fight. The founder side is in
[`templates/README.md`](../README.md). The map these documents are built from is `docs/design/document-set-and-law.md` (paths 3, 4 and 5, and
"When founders and investors fight").

## Index

Level means which law the document leans on: federal, Colorado or Delaware. Colorado comes first wherever state law
matters, then Delaware, then federal law that applies everywhere.

### Angels invest

| Document | File | Kind | Level |
|---|---|---|---|
| Checklist before investing | [angels/before-you-invest.md](angels/before-you-invest.md) | Checklist | Federal, Colorado, Delaware |
| Accredited investor rules, with a self-certification and a verification request | [angels/accredited-investor.md](angels/accredited-investor.md) | Explainer and fill-in forms | Federal |
| SAFE and convertible note explained, with forms linked | [angels/safe-and-convertible-note.md](angels/safe-and-convertible-note.md) | Explainer | Federal, Colorado, Delaware |
| Side letter basics, with a short-form side letter | [angels/side-letter.md](angels/side-letter.md) | Explainer and fill-in form | Federal, Colorado, Delaware |
| What a founder and an investor should each check | [angels/what-each-side-checks.md](angels/what-each-side-checks.md) | Two-sided checklist | Federal, Colorado, Delaware |

### Angels create groups

| Document | File | Kind | Level |
|---|---|---|---|
| Group charter and membership agreement | [groups/charter-and-membership.md](groups/charter-and-membership.md) | Outline and fill-in clauses | Colorado, Delaware, federal |
| Deal screening process | [groups/deal-screening.md](groups/deal-screening.md) | Process and checklist | Federal |
| How members invest: directly, through a syndicate, or through a special purpose vehicle; the broker-dealer and investment adviser traps; Colorado's lack of a series LLC | [groups/how-members-invest.md](groups/how-members-invest.md) | Explainer | Colorado, Delaware, federal |
| Carried interest and who can take it | [groups/carried-interest.md](groups/carried-interest.md) | Explainer and fill-in clause | Federal, Colorado |
| Conflicts of interest policy | [groups/conflicts-policy.md](groups/conflicts-policy.md) | Fill-in policy | Colorado, federal |
| What a group's manager must do each year | [groups/manager-annual-duties.md](groups/manager-annual-duties.md) | Calendar and checklist | Colorado, Delaware, federal |

### VCs invest

| Document | File | Kind | Level |
|---|---|---|---|
| Fund formation checklist | [funds/fund-formation.md](funds/fund-formation.md) | Checklist | Colorado, Delaware, federal |
| Limited partnership agreement outline | [funds/partnership-agreement-outline.md](funds/partnership-agreement-outline.md) | Outline | Delaware, Colorado, federal |
| Investment Company Act exemptions | [funds/investment-company-act.md](funds/investment-company-act.md) | Explainer | Federal |
| Advisers Act exempt reporting | [funds/exempt-reporting-adviser.md](funds/exempt-reporting-adviser.md) | Explainer and checklist | Federal, Colorado, Delaware |
| Regulation D for the fund's own offering | [funds/regulation-d.md](funds/regulation-d.md) | Explainer | Federal, Colorado |
| Form D and the Colorado notice filing | [funds/form-d-and-colorado-notice.md](funds/form-d-and-colorado-notice.md) | Step sheet | Federal, Colorado, Delaware |
| The fund's own compliance calendar | [funds/compliance-calendar.md](funds/compliance-calendar.md) | Calendar | Federal, Colorado, Delaware |
| Board seat duties | [funds/board-seat-duties.md](funds/board-seat-duties.md) | Explainer | Colorado, Delaware |

### When founders and investors fight, from the investor's side

| Document | File | Kind | Level |
|---|---|---|---|
| What your documents should say beforehand | [fights/before-the-fight.md](fights/before-the-fight.md) | Clause guide | Colorado, Delaware, federal |
| What you owe the company and other investors when it happens | [fights/when-it-happens.md](fights/when-it-happens.md) | Explainer and checklist | Colorado, Delaware, federal |

## How each file is built

Every file follows the same shape, so the product can read it and a person can check it.

1. **Front matter** (the block between `---` lines at the top), in the shared format in [`templates/README.md`](../README.md):
   `id`, `title`, `kind`, `path`, `level`, `entity`, `statutes`, `source`, `licence`, `date_checked` and `fields`. `fields`
   maps every blank the product fills, written `{{like_this}}` in the text, to what it means. Everything here is original
   drafting for Legallas under CC0 1.0; forms owned by others are linked, never copied.
2. **A notice:** the short line from `docs/legal/product-notices.md`, section A2, and that no lawyer has reviewed it.
3. **In one screen**: what the document is for and the plain answer.
4. **The body**: the checklist, explainer, outline or fill-in text.
5. **Drafting notes**: each choice the user makes, with the options, a recommendation, and where a lawyer should look.
   This follows the owner's rule: research, analyze what the user asked, then give options with a recommendation,
   showing sources, saying Legallas is not a lawyer, and flagging where a lawyer should look.
6. **Sources**: primary sources first (statutes, rules, official forms and agency pages), then practice sources, each
   marked as such.
7. **What couldn't be verified**: anything a source didn't settle, or that the tools couldn't reach on the date checked.

## Rules these documents follow

- **Public law and invented facts only.** Every document comes from public statutes, rules, official forms and general
  practice. No real group's or fund's agreements were read, sought or adapted. Worked examples use invented facts and
  the repository's fictional names (Doe, Harbor Labs).
- **Forms are linked, not copied, unless their licence allows it.** The National Venture Capital Association's (NVCA) model documents state no licence, and
  Cooley GO's terms bar redistribution, so both are link only. The Institutional Limited Partners Association's (ILPA) model documents and VC Lab's forms are link only
  under their terms. The design map records the Y Combinator SAFE as shareable only unmodified, so it is linked here
  rather than copied, which also keeps the reader on the current version. Nothing here is copied from an AGPL-licensed legal skill.
- **Numbers are dated facts.** Thresholds, fees and deadlines are as of the `date_checked` date. A document older than a
  year should be rechecked before use.
- **Citation marks.** A citation with no mark was read in a primary source on the `date_checked` date. **Unverified** means
  it couldn't be read in a primary source. **Practice** means it is a secondary source describing what is usual, not
  law. **Staff view** means an SEC staff statement, which has no legal force.
- **Plain words.** Full words, no unexplained shorthand. The first use of a term like "special purpose vehicle" says
  what it is.

## What's left

These are not drafted in this folder yet, or need a decision or a lawyer before they can be.

| Item | Why it isn't here | Next step |
|---|---|---|
| Full-text agreements: special purpose vehicle operating agreement, sidecar fund agreement, general partner agreement, management company agreement, investment management agreement, subscription agreement and investor questionnaire | No public form may be redistributed, so each needs original drafting, and each carries real money terms | Draft one at a time from the outlines here, each in its own pull request, with the legal review in `docs/legal/` |
| Private placement memorandum, compliance manual, code of ethics, insider trading policy, pay-to-play log, bad actor questionnaire | Same: original drafting needed | The fund documents list what each must cover; draft after the vehicle choices are settled |
| Investor-side checklists in the baseline format (`docs/checklist/baseline.toml`) | The map outlines four (angel investor; group investing individually; group with a pooled vehicle; venture fund), with new entity types | Turn these documents into checklist items once the format for investor items is agreed |
| Whether a Delaware fund manager must register as an adviser in Delaware | Delaware's private fund adviser rule excludes 3(c)(1) funds and has no venture carve-out; whether a fund counts as a client is unsettled | A lawyer, or a question to the Delaware Investor Protection Unit |
| How Colorado treats a Delaware series | Colorado sends a foreign entity's internal affairs and owner liability to its home state's law (C.R.S. 7-90-805(4)), and two Colorado definitions (the Uniform Commercial Code's and the special deposits article's) count a foreign protected series as a person, but no Colorado text or case found addresses the liability shield between series | A lawyer |
| Whether a group's dues, management fees or carried interest are "compensation" under the federal platform exemption (15 U.S.C. 77d(c)) | No SEC or Colorado statement written for angel groups was found | A lawyer; possibly a request to SEC staff |
| Regulation Crowdfunding, Regulation A and secondary purchases from the investor's side | Outside the three paths as scoped | Add if customers ask |
| The legal review | No lawyer reviews Legallas; the review in `docs/legal/` works through the map's list | Each document here joins that list |
