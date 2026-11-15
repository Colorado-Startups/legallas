# Review grid

Modeled on Anthropic's Tabular review: one row per document, one column per question, every cell cited. The cell states are adapted from claude-for-legal's `tabular-review` skill (Apache-2.0).

## Steps

1. Settle the documents and the questions (the columns) with the user. Without them, propose the default columns below for this room, and confirm before filling.
2. Call legallas_list_documents, with the folder the user named if any, following each cursor, for the rows.
3. Read each document whole with legallas_read_pages, following each cursor. A search passage is not enough for a cell.
4. Call legallas_search on each column's question, for a document the list missed.

## Write

A table: the document's control number, then one column per question. Each cell holds value, state, quote and location. State is `answered`, `not_present` (read, and not there), `unclear` (there, but not classifiable) or `needs_review` (a person must decide). The quote is copied word for word from the page; where it can't be, the state is `needs_review`. Then count each state per column.

## Default columns

| Room | Columns |
|---|---|
| Formation | Parties, date, signed, vesting, IP assignment, governing law |
| Fundraising | Instrument, amount, valuation cap, discount, most favoured nation, pro rata, information rights, governing law |
| Litigation | Date, author, recipients, subject, marked privileged, key admission |

## In Claude

Build a Tabular review artifact: these rows and columns, each cell's quote and location on hover, shaded by state. With claude-for-legal's `tabular-review` installed, run it with the room as its document source: legallas_list_documents for the rows, legallas_read_pages for each document. For a privilege column in a litigation room, run `privilege-log-review` over the same rows.
