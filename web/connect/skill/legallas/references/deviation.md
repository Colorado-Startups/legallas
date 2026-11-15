# Deviation board

Modeled on Anthropic's Playbook deviation board: each deal term in the room's documents against Legallas's standard terms, as standard, deviation or missing.

## Steps

1. Call legallas_list_documents, following each cursor, for the deal documents: term sheet, SAFE, note, stock purchase, charter, side letters, investor rights.
2. Read each whole with legallas_read_pages, following each cursor.
3. Call legallas_search for each playbook term below that a document leaves out, in case another document carries it.

## Write

A board, one row per term per document: term, standard position, what the document says (quoted exactly), verdict, source. Verdict is `standard`, `deviation` or `missing`. For a deviation, say whom it favours, company or investor, and in one line why it matters. Then list the deviations by side.

## Playbook

| Instrument | Term | Standard position |
|---|---|---|
| SAFE, note | Valuation cap | Stated, pre- or post-money named |
| SAFE, note | Discount | Stated, or none |
| SAFE, note | Sale before conversion | The greater of the money back or its value at the cap |
| SAFE, note | Capitalization for the cap | Defined, option pool named |
| SAFE, note | Amendment | Who may amend it, named |
| Note | Interest | Simple, rate stated |
| Note | Maturity | Date stated; majority holders may extend or demand payment |
| Note | Qualified financing | Cash threshold stated |
| Note | Ranking | Unsecured, equal with the other notes |
| Side letter | Pro rata | The next round only |
| Side letter | Most favoured nation | Later terms on the same instrument |
| Side letter | Information | Annual statements at least |
| Priced round | Charter and investment terms | Series Seed, with the Colorado edits for a Colorado company |
| Priced round | First refusal and co-sale | Major purchasers named as the investors |
| Any | Management rights | Consultation, inspection and information; no vote, veto or board seat |
| Any | Approvals | Board and stockholder consents approving the financing |

## In Claude

Build a Playbook deviation board artifact: one column per verdict, one card per term, each card with the quote and its cite.
