# Entity-choice matrix

Modeled on Anthropic's Jurisdiction survey matrix: a Colorado LLC, a Colorado C corporation and a Delaware C corporation, side by side.

## Steps

1. Call legallas_search for the company's plans: raising from funds, founders' stakes, paying out profits, line of business, where people work.
2. Read the pages behind each of those facts with legallas_read_pages.
3. Call legallas_search_law for each factor below, with the citation in its row.

## Write

A matrix: one row per factor below, one column per form, each cell a short answer with its cite (a statute from the law library, or a control number and page). A cell the law library can't support reads "not in the law library". Then the company's facts that bear on the choice, cited. Give the options and the factors; recommend a form only where the room's instructions allow recommending.

## Factors

| Factor | Where to look |
|---|---|
| Yearly state filings | C.R.S. § 7-90-501; 8 Del. C. § 503; C.R.S. § 7-90-801 |
| Income tax | 26 U.S.C. § 701; 26 U.S.C. § 11; C.R.S. § 39-22-301; 30 Del. C. § 1902 |
| Qualified small business stock | 26 U.S.C. § 1202 |
| Incentive stock options | 26 U.S.C. § 422 |
| Owners acting without a meeting | C.R.S. § 7-80-401; C.R.S. § 7-107-104; 8 Del. C. § 228 |
| Cumulative voting | C.R.S. § 7-80-401; C.R.S. § 7-102-102; 8 Del. C. § 214 |
| Removing a director or manager | C.R.S. § 7-80-402; C.R.S. § 7-108-108; 8 Del. C. § 141 |
| Amending the charter | C.R.S. § 7-80-401; C.R.S. § 7-110-103; 8 Del. C. § 242 |
| A smaller holder's remedies | C.R.S. § 7-80-810; C.R.S. § 7-114-301; C.R.S. § 7-114-305; 8 Del. C. § 226 |
| Limits on money liability | C.R.S. § 7-80-404; C.R.S. § 7-102-102; 8 Del. C. § 102 |
| Converting later | C.R.S. § 7-90-201; 26 U.S.C. § 351; 8 Del. C. § 265; 26 U.S.C. § 368; 8 Del. C. § 266 |
| Working in Colorado | C.R.S. § 7-90-801; C.R.S. § 7-90-802 |
| What the company's investors expect | The room's term sheets and investor letters |

The rows come from Legallas's `templates/founders/entity-comparison.md`, and match the room's Entity choice page (`web/worker/entity-matrix.ts`), cell by cell.

## In Claude

Build a Jurisdiction survey matrix artifact: the forms as columns, the factors as rows, each cell's cite on hover.
