---
id: founders/open-source-inventory
title: Open-Source Inventory
kind: record
path: startup-forms
level: [federal]
entity: [colorado-llc, colorado-corporation, delaware-llc, delaware-corporation]
statutes:
  - MIT License
  - BSD 3-Clause License
  - Apache License 2.0, section 4
  - GNU GPL 3.0, section 6
  - GNU LGPL 3.0, section 4
  - GNU AGPL 3.0, section 13
  - Mozilla Public License 2.0, section 3.2
source: Original drafting for Legallas from the licence texts listed, each read from its steward, and first principles. No law firm's or scanning vendor's form was read or adapted.
licence: CC0-1.0
date_checked: 2026-11-09
fields:
  - COMPANY_NAME
  - PRODUCT
  - INVENTORY_DATE
  - KEPT_BY
---

# Open-Source Inventory

> Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.
>
> No lawyer has reviewed this template.

## Before you use this

A list of the open-source code a product ships, each component's licence and what that licence asks. Investors ask for it in
diligence. A dependency scanner can fill the rows; this record adds the decision for each.

| Licence | What it asks, in its own words, read 2026-11-09 | Triggered by | Steward |
|---|---|---|---|
| MIT | "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software." | Any copy | [opensource.org][mit] |
| BSD 3-Clause | Source and binary copies keep "the above copyright notice, this list of conditions and the following disclaimer" | Any copy | [opensource.org][bsd3] |
| Apache 2.0 | Give recipients "a copy of this License"; modified files "carry prominent notices stating that You changed the files"; keep any "NOTICE" file's attributions (section 4) | Redistribution | [apache.org][apache] |
| GPL 3.0 | Object code goes out only if "you also convey the machine-readable Corresponding Source" (section 6) | Conveying object code | [gnu.org][gpl3] |
| LGPL 3.0 | A Combined Work may use terms "that, taken together, effectively do not restrict modification of the portions of the Library", plus listed notices (section 4) | Conveying a Combined Work | [gnu.org][lgpl3] |
| AGPL 3.0 | A modified version "must prominently offer all users interacting with it remotely through a computer network" the Corresponding Source (section 13) | Network use of a modified version | [gnu.org][agpl3] |
| MPL 2.0 | Executable copies: the Covered Software "must also be made available in Source Code Form" (section 3.2) | Distributing executables | [mozilla.org][mpl2] |

- **Triggers differ.** The GPL turns on conveying copies; the AGPL also reaches a modified program used over a network. A hosted
  product can ship AGPL code without sending any copy.
- **No licence file, no written permission.** Put such code in group N and decide in Section 2.

## The document

<!-- TEMPLATE START -->

**OPEN-SOURCE INVENTORY**

| | |
|---|---|
| Company | {{COMPANY_NAME}} |
| Product or repository | {{PRODUCT}} |
| As of | {{INVENTORY_DATE}} |
| Kept by | {{KEPT_BY}} |

**1. Components.** One row each. Group of licences: P, permissive (MIT, BSD, Apache); W, weak copyleft (LGPL, MPL); S, strong copyleft (GPL, AGPL); N, none or unknown.

| Component | Version | Licence (SPDX id) | Group | How used: shipped, hosted, build-only | Modified | Obligation met |
|---|---|---|---|---|---|---|
| | | | | | | |

**2. Decisions.** One row for each component in group S or N, or W and modified.

| Component | Issue | Decision: keep and comply, replace, get a commercial licence, remove | Owner | Date |
|---|---|---|---|---|
| | | | | |

**3. Notices file.** Where the product shows the copyright and licence notices that groups P and W ask for.

[OPTION A: One notices file shipped with the product. Recommended.]
The product ships a third-party notices file, rebuilt each release from Section 1.
[END OPTION A]

[OPTION B: Notices in an about screen or web page.]
The product links to a notices page, rebuilt each release from Section 1.
[END OPTION B]

Legallas template founders/open-source-inventory version 1. Law checked 2026-11-09. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

<!-- TEMPLATE END -->

**Example, invented.** Harbor Labs lists 212 packages: 205 group P, 4 group W unmodified, 2 group S build-only, 1 group N. The N row goes to Section 2: replace.

## Drafting notes

| Choice | Options | Recommendation and why | Where a lawyer should look |
|---|---|---|---|
| Scope | Shipped code only; everything, build tools too | **Everything, marked by use.** Build-only tools rarely trigger obligations, but diligence asks | Code generators whose output carries a licence |
| Group S in a hosted product | Keep; replace | **Keep GPL if never conveyed; review AGPL every time.** AGPL section 13 reaches network users of a modified version ([AGPL][agpl3]) | Whether the company modified it |
| Notices | A, file; B, page | **A.** It travels with every copy, which MIT and BSD tie their notice to ([MIT][mit], [BSD][bsd3]) | Mobile app stores' own rules |

## What couldn't be checked

- **Licence compatibility** between components, and which licence governs a dual-licensed package.
- **Licences outside this table** (EPL, CDDL, SSPL, Creative Commons, source-available licences).
- **Whether a court reads "convey" or "distribute"** to reach a given deployment. A lawyer should confirm.

## Sources

Read 2026-11-09, each from its steward: [MIT License][mit] and [BSD 3-Clause][bsd3] (Open Source Initiative); [Apache License 2.0][apache]
(Apache Software Foundation); [GPL 3.0][gpl3], [LGPL 3.0][lgpl3] and [AGPL 3.0][agpl3] (Free Software Foundation); [MPL 2.0][mpl2] (Mozilla).

[mit]: https://opensource.org/license/mit
[bsd3]: https://opensource.org/license/bsd-3-clause
[apache]: https://www.apache.org/licenses/LICENSE-2.0
[gpl3]: https://www.gnu.org/licenses/gpl-3.0.html
[lgpl3]: https://www.gnu.org/licenses/lgpl-3.0.html
[agpl3]: https://www.gnu.org/licenses/agpl-3.0.html
[mpl2]: https://www.mozilla.org/en-US/MPL/2.0/
