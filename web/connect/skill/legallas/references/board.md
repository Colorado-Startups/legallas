# Matter board

Modeled on Anthropic's Matter board. Any room: a litigation room's tracks, a fundraising room's closing items, a formation room's filings.

## Steps

1. Call legallas_case_overview with section "summary", then "tracks", following each cursor. A room with no tracks returns none: go on.
2. Call legallas_list_documents with since set to 14 days before today, for what is new.
3. Call legallas_search for "deadline", "due date", "closing", "filing" and "next step", for open items the overview leaves out.
4. Read the pages behind each owner, step and date with legallas_read_pages.

## Write

A table, one row per matter, track or open item: item, owner, status, next step, next deadline, source. Sort by next deadline, soonest first. Where the record gives no owner or date, write "not in the record"; never guess one.

## In Claude

Build a Matter board artifact: one card per row, in columns by status, each card with its deadline and cite. In a fundraising or formation room with claude-for-legal's `closing-checklist` installed, run it with these rows as the checklist.
