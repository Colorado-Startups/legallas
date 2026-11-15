---
id: raise/conversion-to-delaware
title: Plan of Conversion to a Delaware Corporation
kind: template
path: startup-raises
level: [colorado, delaware, federal]
entity: [colorado-llc, colorado-corporation]
statutes:
  - C.R.S. 7-90-201, -201.3, -201.4, -201.7, -202, -205.5, -206
  - C.R.S. 7-111-103
  - C.R.S. 7-113-102(1)(a)
  - 8 Del. C. 265
  - 26 U.S.C. 351, 357(c), 368(a)(1)(F), 1202(h)(4), (i)(1)(A)
  - Rev. Rul. 2004-59
source: Original drafting for Legallas from the statutes listed. No form was adapted.
licence: CC0-1.0
date_checked: 2026-11-02
fields:
  - COMPANY_NAME
  - CONVERTING_FORM
  - NEW_NAME
  - EXCHANGE_TERMS
  - EFFECTIVE_TIME
  - APPROVAL_DATE
---

# Plan of Conversion to a Delaware Corporation

> Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.
>
> No lawyer has reviewed this template.

## Before you use this

Only if the company chooses it, for example because an investor asks. The company stays the same entity: Colorado says "the resulting entity is the same entity as the converting entity" ([7-90-202(4)][t7]), and Delaware treats its existence as starting when the Colorado entity first formed ([265(d)][d8s9]).

| Step | Colorado LLC | Colorado corporation |
|---|---|---|
| 1. Approve this plan | As the operating agreement provides for a conversion, or else for a merger, or else for an amendment; failing all, every member ([7-90-201.4(2)][t7]). The Legallas [operating agreement](../founders/colorado-llc-operating-agreement.md) sets this in Section 15.1: Two-Thirds in Interest, and any Founder whose consent Section 3.2 requires, if the plan meets its conditions (a) to (e), including delivery to all holders 15 business days ahead; otherwise Section 15.2 needs each affected holder's consent | The board adopts and recommends it; each voting group approves by a majority of all votes it could cast ([7-111-103(2), (5)][t7]). Shareholders likely have appraisal rights, so give the article 113 notice (see the drafting notes) |
| 2. Delaware filings, together | Certificate of conversion and certificate of incorporation, filed at the same time ([265(b)][d8s9]) | Same |
| 3. Colorado filing | Statement of conversion with the Secretary of State ([7-90-201.7][t7]) | Same |
| 4. Then | Delaware bylaws, board consent, stock ledger, new equity plan; Colorado foreign authority if it still does business here | Same |

```mermaid
flowchart LR
  A["Approve the plan"] --> D["File in Delaware:<br/>certificate of conversion<br/>and certificate of incorporation"]
  D --> C["File in Colorado:<br/>statement of conversion"]
  C --> F["Delaware bylaws,<br/>board consent, ledger"]
  F --> Q["Colorado foreign<br/>authority, if needed"]
```

**Tax matters most here. Have the company's tax professional review before anyone signs.**

## The document

<!-- TEMPLATE START -->

**PLAN OF CONVERSION**

**1. Converting entity.** {{COMPANY_NAME}}, a {{CONVERTING_FORM}} formed under the law of Colorado.

**2. Resulting entity.** {{NEW_NAME}}, a corporation formed under the General Corporation Law of the State of Delaware.

**3. Effect.** At {{EFFECTIVE_TIME}}, or when the Delaware certificate of conversion and certificate of incorporation are both filed and effective if later, the converting entity converts into the resulting entity. It is the same entity: it keeps all its property, rights, obligations and liabilities, and the conversion isn't a dissolution or a transfer.

**4. How interests change.** At the effective time, each owner's interest in the converting entity becomes shares of the resulting entity as follows: {{EXCHANGE_TERMS}}. Any vesting, repurchase right or other restriction on an interest carries over to the shares it becomes, adjusted for the exchange. Each outstanding option, profits interest, convertible note or simple agreement for future equity becomes, or is exchanged for, the corresponding right in the resulting entity, as the exchange terms state.

**5. Governing documents.** The certificate of incorporation attached as Exhibit A becomes the resulting entity's certificate of incorporation. The persons named in Exhibit B are its initial directors and officers, until their successors are chosen.

**6. Filings.** The officers, managers or members, as the converting entity's documents provide, shall file the certificate of conversion and the certificate of incorporation in Delaware at the same time, file the statement of conversion with the Colorado Secretary of State, and take the other steps needed to carry out this plan.

**7. Ending or changing this plan.** Before the effective time, the board, managers or members, as the converting entity's documents provide, may abandon this plan, or change it, except that a change to section 4, to Exhibit A, or to any other term in a way that would adversely affect the owners in any material respect needs the same approval as this plan.

Approved on {{APPROVAL_DATE}} as section 7-90-201.4 of the Colorado Revised Statutes requires.

______________________________

Exhibit A: Delaware certificate of incorporation. Exhibit B: initial directors and officers.

Legallas template raise/conversion-to-delaware version 1. Law checked 2026-11-02. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

<!-- TEMPLATE END -->

## Drafting notes

| Choice | Options | Recommendation and why | Where a lawyer should look |
|---|---|---|---|
| Convert at all | Convert; stay a Colorado entity | **Neither is recommended here.** See choice 5 in the [document map](../../docs/design/document-set-and-law.md#choices-on-this-path-1) and the [entity comparison](../founders/entity-comparison.md) | Whether the investor will accept a Colorado corporation |
| Route | Statutory conversion, as drafted; merger into a new Delaware corporation | **Statutory conversion.** Both states allow it directly ([7-90-201(1)(b)][t7]; [265][d8s9]), with no second entity to wind up | Contracts that treat a conversion or merger as an assignment |
| LLC tax | A conversion taxed as a contribution of assets for stock | **Have the tax professional confirm the plan.** For a partnership converting under a state formless conversion statute, the IRS treats it as the partnership contributing all its assets and liabilities to the corporation for stock, then distributing the stock ([Rev. Rul. 2004-59][rr2004]). That can be tax-free if [26 U.S.C. 351][us351]'s conditions are met, but liabilities above the basis of the assets can be gain ([357(c)][us357]) | Liabilities, profits interests and any built-in gain |
| Qualified small business stock | Starts at conversion for an LLC; carries over for a corporation | **Know the clock before converting.** For an LLC, the stock is acquired on the conversion date and its basis is at least the fair value of what was contributed, so gain built up before conversion doesn't qualify ([1202(i)(1)][us1202]). For a Colorado corporation, a change of state can be a reorganization under [368(a)(1)(F)][us368], and stock exchanged in a reorganization keeps its original date. A limit tied to value at the exchange applies only if the company is no longer a qualified small business at that time ([1202(h)(4)(A), (B)][us1202]) | Each holder's own position |
| Appraisal rights | Corporation: likely yes; LLC: as its agreement says | **Plan for them in a corporation.** Colorado's appraisal list doesn't name a conversion to a foreign corporation ([7-113-102(1)(g), (h)][t7]), but where the statutes neither give nor expressly deny appraisal rights, an owner gets them on the same basis as in a merger into an entity of the resulting form ([7-90-206(2)(a)][t7]), and shareholders who vote on a merger and whose shares don't stay outstanding have them ([7-113-102(1)(a)(I)][t7]). For a Legallas LLC, Section 15.2 of the operating agreement says no member has them if the plan meets Section 15.1 | The article 113 notice and payment steps, and any shareholder who might object |
| Interests (4) | Fill in the exchange terms | **Fill in exactly,** including vesting and how options, profits interests, notes and SAFEs carry over. A SAFE is a contract with the company and continues; a profits interest has no corporate equivalent and must be exchanged for stock or options | Profits interests: a tax professional and the holders |

**Fights.** A conversion changes which state's law governs the founders' rights, including written consent, cumulative voting and director removal. A founder who didn't vote for it may lose Colorado protections the [entity comparison](../founders/entity-comparison.md) describes. Approval rules in step 1 are where that fight would start.

## What couldn't be checked

- **Delaware's filing fees and franchise tax** for a converted corporation weren't reread here.
- **Whether a new employer identification number is needed** after an LLC converts. Not researched; ask the IRS or a tax professional.
- **Delaware's requirements for the certificate of conversion's signature** under [265(i)][d8s9] weren't read in full.
- **Contracts and licences** that treat a conversion as an assignment. Each needs reading.

## Sources

[C.R.S. Title 7][t7], 2026 edition, read 2026-11-02. [8 Del. C. ch. 1, subch. IX][d8s9], read 2026-11-02. [26 U.S.C. 351][us351], [357][us357], [368][us368], [1202][us1202]. [Rev. Rul. 2004-59, 2004-24 I.R.B. 1050][rr2004].

[t7]: https://olls.info/crs/crs2026-title-07.pdf
[d8s9]: https://delcode.delaware.gov/title8/c001/sc09/index.html
[us351]: https://uscode.house.gov/us/usc/t26/s351/
[us357]: https://uscode.house.gov/us/usc/t26/s357/
[us368]: https://uscode.house.gov/us/usc/t26/s368/
[us1202]: https://uscode.house.gov/us/usc/t26/s1202/
[rr2004]: https://www.irs.gov/pub/irs-irbs/irb04-24.pdf
