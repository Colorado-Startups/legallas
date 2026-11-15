# Cite check

Modeled on Anthropic's Cite check: every cite in a draft, checked against the room and its law library.

## Steps

1. Get the draft from the user, pasted or attached. Without one, ask for it and stop.
2. List every cite in the draft: a control number and page, a document's name, a quote, or a statute, rule or case.
3. For a record cite, find the document with legallas_search or legallas_list_documents, then read the cited page with legallas_read_pages.
4. For a law cite, call legallas_search_law with the cite.

## Write

A table, one row per cite: the cite as written, what it supports in the draft, verdict, the right cite, note. Verdict is `supported`, `wrong page`, `misquoted`, `not supported`, `not found`, or `not checked` for a law cite the room's law library can't reach. Where the draft quotes, set the source's words beside it, copied exactly. Then list each claim in the draft that carries no cite.

## In Claude

Build a Cite check artifact: the draft with each cite marked by its verdict, and the table beside it.
