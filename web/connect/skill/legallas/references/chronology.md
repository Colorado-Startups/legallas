# Chronology

Adapted from claude-for-legal's `chronology` skill (Apache-2.0): the matter's dated events, weighted, with sources and gaps.

## Steps

1. Call legallas_case_overview with section "summary", then "events", following each cursor.
2. Call legallas_list_documents, following each cursor, for dated documents the events leave out.
3. Call legallas_search on each person, party and step the events name, for dated documents the first two steps missed.
4. Read the page behind each entry with legallas_read_pages to confirm its date.

## Write

A table in date order: date, event, who, weight, source. One event with several sources is one row citing them all. Weight is `key` (part of a claim, a defence or a deal term), `relevant` or `background`: keep `key` rare, and when torn take the lower one. Mark an approximate or disputed date as such, and give both sides of a conflict. Mark `privileged` where an entry's only source is marked privileged. Then list the gaps: date ranges with no documents, and events the record should show but doesn't.

## In Claude

With claude-for-legal's `chronology` installed, run it in documents mode with the room as its source, citing control number and page. Else build a timeline artifact from the table.
