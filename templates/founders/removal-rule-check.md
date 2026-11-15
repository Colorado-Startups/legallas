---
id: founders/removal-rule-check
title: Founder Removal Rule Check
kind: record
path: startup-forms
level: [colorado, delaware]
entity: [colorado-llc, colorado-corporation, delaware-llc, delaware-corporation]
statutes:
  - C.R.S. 7-108-108, 7-108-109, 7-108-303(4), 7-107-104(1)
  - C.R.S. 7-80-108(1)(a), 7-80-401(1), 7-80-402, 7-80-403(1)
  - 8 Del. C. 141(k), 142(b), 228(a)
  - 6 Del. C. 18-402
source: Original drafting for Legallas from the statutes listed and first principles. No law firm's or company's form was read or adapted.
licence: CC0-1.0
date_checked: 2026-11-13
fields:
  - COMPANY_NAME
  - AS_OF_DATE
---

# Founder Removal Rule Check

> Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.
>
> No lawyer has reviewed this template.

## Before you use this

A record of who can remove each founder from each seat, by what vote and after what process. Fill it in when the formation documents are signed, and again when they change.
Losing a seat and losing equity are separate: the [founder stock purchase agreement](founder-stock-purchase.md) or the operating agreement decides unvested equity.

**Corporations: the law's default, read 2026-11-13**

| Seat | Colorado corporation | Delaware corporation |
|---|---|---|
| Director | "The shareholders may remove one or more directors with or without cause unless the articles of incorporation provide that directors may be removed only for cause." ([C.R.S. 7-108-108(1)][crs7]) | "Any director or the entire board of directors may be removed, with or without cause, by the holders of a majority of the shares then entitled to vote at an election of directors, except as follows" ([8 Del. C. 141(k)][del8sc4]) |
| Director: vote | "the number of votes cast in favor of removal exceeds the number of votes cast against removal" ([7-108-108(3)][crs7]) | "the holders of a majority of the shares then entitled to vote at an election of directors" ([141(k)][del8sc4]) |
| Director: process | "only at a meeting called for the purpose of removing the director" ([7-108-108(4)][crs7]) | Written consent without a meeting "Unless otherwise provided in the certificate of incorporation" ([8 Del. C. 228(a)][del8sc7]) |
| Director: exceptions | Voting groups and cumulative voting ([7-108-108(2), (3)][crs7]). A court may remove one for "fraudulent or dishonest conduct or gross abuse of authority or discretion" ([7-108-109(1)][crs7]) | Classified boards, cumulative voting, and directors a class elects ([141(k)(1), (2)][del8sc4]) |
| Officer | "Unless otherwise provided in the bylaws, the board of directors may remove any officer at any time with or without cause." ([7-108-303(4)][crs7]) | Officers hold office "until such officer's successor is elected and qualified or until such officer's earlier resignation or removal", chosen as "prescribed by the bylaws or determined by the board" ([142(b)][del8sc4]) |

**LLCs: the law's default, read 2026-11-13**

| Seat | Colorado LLC | Delaware LLC |
|---|---|---|
| Manager | "Managers may be designated and removed by the consent of a majority of the members." ([C.R.S. 7-80-402][crs7]) | "a manager shall cease to be a manager as provided in a limited liability company agreement" ([6 Del. C. 18-402][del6sc4]) |
| Officer | Removed "by the consent of a majority of the members or, if the limited liability company has one or more managers, by a majority of the managers" ([7-80-403(1)][crs7]) | Not set in 18-402; the agreement decides |
| Which governs | The operating agreement's provisions "shall control over any provision of this article to the contrary", with listed exceptions ([7-80-108(1)(a)][crs7]) | Most of 18-402 applies "Unless otherwise provided in a limited liability company agreement" ([18-402][del6sc4]) |

## The document

<!-- TEMPLATE START -->

**FOUNDER REMOVAL RULE CHECK FOR {{COMPANY_NAME}}**

As of {{AS_OF_DATE}}. One row per founder per seat.

[OPTION A: Corporation.]

| Founder | Seat | Who can remove | Vote needed | Cause needed | Notice, meeting or consent | Where it is written |
|---|---|---|---|---|---|---|
| | Director | | | | | [Colorado articles](colorado-corporation-articles.md) section 8, or the Delaware certificate; [Colorado](colorado-corporation-bylaws.md) or [Delaware](delaware-corporation-bylaws.md) bylaws section 3.6 |
| | Officer (title: ______) | | | | | Bylaws section 4.5 |
| | Employee or other service | | | | | [Founders' agreement](founders-agreement.md) section 5; offer letter |
| | Unvested shares on removal | | | | | Founder stock purchase agreement |

[END OPTION A]

[OPTION B: LLC.]

| Founder | Seat | Who can remove | Vote needed | Cause needed | Notice, meeting or consent | Where it is written |
|---|---|---|---|---|---|---|
| | Manager | | | | | [Operating agreement](colorado-llc-operating-agreement.md) sections 5.2 and 5.3; Delaware LLC agreement section 3.1 |
| | Officer (title: ______) | | | | | Operating agreement section 5.2; Delaware LLC agreement section 3.2 |
| | Job or other service | | | | | Operating agreement section 5.2; founders' agreement section 5 |
| | Unvested units on removal | | | | | Operating agreement sections 5.1 and 6 |

[END OPTION B]

**Checks**

| Question | Answer | Note |
|---|---|---|
| Can one founder's votes alone remove another founder from any seat? | Yes / No | |
| Do the founders' agreement and the bylaws or operating agreement give the same rule for each seat? | Yes / No | |
| Can removal from a seat cost the founder unvested equity, and at what price? | Yes / No | |
| Does a removal need notice and a chance to respond before the vote? | Yes / No | |
| Did each founder sign or receive a copy of this record? | Yes / No | |

Legallas template founders/removal-rule-check version 1. Law checked 2026-11-13. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

<!-- TEMPLATE END -->

**Example, invented.** Harbor Labs, Inc. is a Delaware corporation. Doe holds 60% of the common stock and a cofounder 40%. The first check is "Yes": Doe's shares alone are a majority under 141(k), and 228(a) allows a written consent. The note points to the founders' agreement's board seat terms. The record is filed as DOE-0046.

## Drafting notes

| Choice | Options | Recommendation and why | Where a lawyer should look |
|---|---|---|---|
| When to fill it in | At signing; only in a dispute | **At signing, and after each change.** A founder sees the rule before anyone needs it | |
| One founder with a majority | Accept it; add protection | **Write the answer down either way.** The founders' agreement and the bylaws can add notice, a meeting or a seat promise | Whether a voting agreement among the founders suits |
| Colorado director removal by consent | Meeting only; unanimous written consent | **Plan on a meeting.** 7-108-108(4) names one; 7-107-104(1)(a) allows action without a meeting when all shareholders entitled to vote consent | Whether a consent of fewer than all can remove a director |
| Seat and equity | Treated together; treated apart | **Apart.** Both founder templates keep a seat and equity separate | Whether removal "without Cause" is used to trigger a repurchase |

## What couldn't be checked

- **8 Del. C. 225(c)**, court removal of a Delaware director, wasn't read.
- **Employment law** on ending a founder's job (notice, final pay) wasn't read here.
- **Colorado 7-80-108(1.5), (2) and (3)**, the exceptions to an operating agreement's control, weren't read in full.

## Sources

Read 2026-11-13: [C.R.S. title 7][crs7] (2026 edition), articles 80, 107 and 108; 8 Del. C. chapter 1, [subchapter IV][del8sc4] and [subchapter VII][del8sc7]; [6 Del. C. chapter 18, subchapter IV][del6sc4].

[crs7]: https://olls.info/crs/crs2026-title-07.docx
[del8sc4]: https://delcode.delaware.gov/title8/c001/sc04/index.html
[del8sc7]: https://delcode.delaware.gov/title8/c001/sc07/index.html
[del6sc4]: https://delcode.delaware.gov/title6/c018/sc04/index.html
