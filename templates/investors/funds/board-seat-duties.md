---
id: investors/funds/board-seat-duties
title: Board seat duties for a fund's director in a portfolio company
path: vcs-invest
kind: explainer
level: [colorado, delaware]
entity: [fund-lp, fund-llc]
statutes:
  - C.R.S. 7-108-401, 7-108-402, 7-108-501, 7-102-102(2)(d), (e), 7-109-104 (Colorado Business Corporation Act)
  - 8 Del. C. 102(b)(7), 122(17), 141(a), 144, 145, 220(d) (Delaware General Corporation Law)
  - 15 U.S.C. 78j(b); 17 CFR 240.10b-5; C.R.S. 11-51-501
  - In re Trados Inc. Shareholder Litigation, 73 A.3d 17 (Del. Ch. 2013)
source: Original drafting for Legallas from the statutes and the case listed. Delaware duty law is mostly judge-made; only one case is cited, and a lawyer must cover the rest.
licence: CC0-1.0
date_checked: 2026-11-01
fields:
  seat_type: Director or observer
---

# Board seat duties

**Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything. No lawyer has reviewed this.** Most of this area is judge-made law, and a
lawyer must cover it.

## In one screen

A fund partner who joins a portfolio company's board as a director owes duties to **the company and all its
stockholders**, not to the fund that appointed them. The fund's interests and the company's usually line up, but not
always: in a down round led by insiders, a sale where preferred stock is paid first, or a decision to cut off funding.
In those moments the director must act for the company. An **observer**, by contrast, has no vote and generally no
fiduciary duty, but is bound by whatever observer agreement and confidentiality terms the observer signed.

## What the law asks of a director

### Colorado corporation

A director must act in good faith, with care, and in a manner the director reasonably believes to be in the
corporation's best interests ([C.R.S. 7-108-401][t7]). Money liability is set separately: a claimant must show, among the
listed grounds, conduct not in good faith, not rationally believed to be in the corporation's best interests, at least
grossly negligent (unless the articles change the standard), a failure to inquire after red flags, a sustained failure of
oversight, or a breach of loyalty ([7-108-402][t7]). A director's conflicting interest transaction can't be set aside for
the conflict alone if disinterested directors approve it after disclosure, disinterested shareholders approve it, or it
is fair to the corporation ([7-108-501][t7]). The articles may limit a director's money liability, but not for a
financial benefit the director wasn't entitled to, intentional harm, an unlawful distribution or an intentional crime;
this covers directors only, not officers ([7-102-102(2)(d)][t7]). The articles may also limit the duty to offer business
opportunities to the corporation ([7-102-102(2)(e)][t7]). Advancing a director's legal costs is permitted on a written
affirmation of good faith and an undertaking to repay; it is mandatory only if the articles, bylaws or a contract make it
so ([7-109-104][t7]).

### Delaware corporation

The business and affairs of the corporation are managed by or under the direction of the board ([8 Del. C. 141(a)][d8s4]).
The duties themselves (care, loyalty, good faith) are judge-made. The Court of Chancery has put the core point this way:
directors "owe fiduciary duties to the corporation and its stockholders which require that they strive prudently and in
good faith to maximize the value of the corporation for the benefit of its residual claimants" ([In re Trados][trados]).
In that case, the court treated preferred stockholders' rights as mainly contractual, and the common stockholders as the
residual claimants whose interests directors serve when the two diverge.

Statutes shape the edges:

- **Exculpation.** The charter may eliminate a director's or officer's personal money liability for breach of fiduciary
  duty, but not for breaches of loyalty, acts not in good faith, or improper personal benefits, and not for an officer
  in a claim brought by or for the corporation ([8 Del. C. 102(b)(7)][d8s1]).
- **Interested transactions.** Section 144, rewritten in 2025, gives safe harbours for transactions in which directors,
  officers or a controlling stockholder have an interest, if approved in the ways it sets out ([8 Del. C. 144][d8s4]).
  Under it, a "controlling stockholder" includes anyone with a contractual right to elect a majority of the board, and a
  holder of at least a third of the voting power with managerial authority, not only a majority holder. An investor whose
  documents let it name a board majority should assume it is a controller.
- **Corporate opportunities.** The charter or the board may renounce the corporation's interest in specified business
  opportunities ([122(17)][d8s2]). Funds usually ask for this so their other investments aren't challenged.
- **Indemnification and advancement.** Mandatory indemnification for a director who succeeds; advancement only if the
  bylaws or an agreement make it mandatory ([145][d8s4]).
- **Records.** A director may inspect the corporation's books and records for a purpose reasonably related to the
  director's position, and the corporation must prove an improper purpose to refuse ([220(d)][d8s7]).

## Where a fund director gets into trouble

| Situation | Why it's hard | What to do |
|---|---|---|
| The fund leads or joins an insider financing, especially a down round | The director sits on both sides | Use a process: disinterested approval, a fair price check, a rights offering to other holders. Recuse where needed |
| A sale where preferred stock takes most of the proceeds | The fund may prefer a quick exit; common holders may not | Document why the decision serves the company and its residual claimants; consider independent advice ([In re Trados][trados]) |
| Sharing company information with the fund | The fund wants it; the company may not consent | Agree in advance, in writing, what the director may share with the fund, and keep it confidential there |
| The fund invests in a competitor | Opportunity and confidentiality conflicts | Get a renunciation of corporate opportunities in the charter or by the board in Delaware ([122(17)][d8s2]), or an articles provision in Colorado ([C.R.S. 7-102-102(2)(e)][t7]); wall off information |
| The fund buys shares from a founder or employee | The director knows things the seller doesn't | Disclose material information, or don't trade; securities fraud rules apply to private shares too ([15 U.S.C. 78j(b)][us78j]; [17 CFR 240.10b-5][e10b5]; [C.R.S. 11-51-501][t11]) |
| Removing a founder | The fund may be under pressure from its own investors | See [What you owe when it happens](../fights/when-it-happens.md) |

## Before accepting a seat

- [ ] The charter's exculpation clause covers directors (and, in Delaware, officers if the director will also be one).
- [ ] An indemnification agreement with mandatory advancement.
- [ ] Directors and officers insurance, with the fund's own policy as a backstop.
- [ ] A written understanding of what information the director may share with the fund.
- [ ] A corporate opportunity renunciation, if the fund invests in the same field.
- [ ] The fund's own insider trading and code of ethics policies apply to the director.

Legallas template investors/funds/board-seat-duties version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

## Drafting notes

### Choice: director or observer: `{{seat_type}}`

| Option | Influence | Duty and risk |
|---|---|---|
| Director | A vote; formal standing | Fiduciary duties to all stockholders; litigation exposure; indemnification and insurance needed |
| Observer | Attends and speaks, no vote | Generally no fiduciary duty (judge-made); bound by the observer agreement; can be excluded from privileged sessions |

**Recommendation:** take a director seat when the fund holds a large stake and can add real governance value; take an
observer seat for smaller positions or where the fund has competing investments. **Where a lawyer should look:** the
observer agreement's confidentiality terms and any carve-outs for sharing with the fund.

### Choice: information sharing with the fund

**Recommendation:** put it in writing at the investment: the director may share board information with the fund's
investment team, who keep it confidential, unless the board decides otherwise for a specific matter.

## Sources

Primary:

- [C.R.S. title 7][t7] (Colorado Business Corporation Act); [C.R.S. title 11][t11]
- [8 Del. C. 102][d8s1]; [122][d8s2]; [141, 144, 145][d8s4]; [220][d8s7]
- [15 U.S.C. 78j][us78j]; [17 CFR 240.10b-5][e10b5]
- [In re Trados Inc. Shareholder Litigation, 73 A.3d 17 (Del. Ch. 2013)][trados]

## What couldn't be verified

- Delaware's duty law beyond the one case cited is judge-made and not covered here.
- Sections 144 and 220 were read in their current text through a legal research database. The 2025 act's application
  note, which says which transactions and demands the changes reach, wasn't available.

[t7]: https://olls.info/crs/crs2026-title-07.pdf
[t11]: https://olls.info/crs/crs2026-title-11.pdf
[d8s1]: https://delcode.delaware.gov/title8/c001/sc01/index.html
[d8s2]: https://delcode.delaware.gov/title8/c001/sc02/index.html
[d8s4]: https://delcode.delaware.gov/title8/c001/sc04/index.html
[d8s7]: https://delcode.delaware.gov/title8/c001/sc07/index.html
[us78j]: https://uscode.house.gov/us/usc/t15/s78j/
[e10b5]: https://www.ecfr.gov/current/title-17/section-240.10b-5
[trados]: https://www.courtlistener.com/opinion/5146900/in-re-trados-inc-shareholder-litigation/
