# Submission and sweep feedback loop

The master Sheet is the source of truth. A submitted link is a clue, not a new event by default. One occurrence has one stable Master ID and one calendar category; alternative URLs remain evidence linked to that occurrence. A recurring series can have multiple occurrences with different Master IDs.

## Review each submission

1. Check the submitted page and identify the organiser, event name, city and date. Compare the URL against `Events` official sources and `Event Sources` aliases. Ignore tracking parameters, but keep event-identifying query parameters.
2. Compare name, date and city against `Events` even when the URL differs. Check the `Discovery Leads` series/organiser cues for a next edition. Search official organiser pages and a second source for material Main/date/status changes.
3. If it is the **same occurrence**, record its ID in `Submissions → Matched Master ID` and mark the human `Decision` as `DUPLICATE`. The approval script records the reported alternative URL in `Event Sources` and a search cue in `Discovery Leads`; it does not create another event.
4. If it is a **new edition**, verify its own date and source before an `APPROVE` decision and a new Master ID. Never copy last year's date. The series remains a `WATCH` lead for the next sweep.
5. If it is a **correction**, keep the existing Master ID, update the existing event after verification, and log the source and change. If unclear, use `HOLD`; if irrelevant or spam, use `REJECT`. AI can suggest matches but does not edit `Decision`.

`Duplicate / series match` holds the review explanation. `Matched Master ID` holds an actual confirmed occurrence match. `Sweep cue` lets the reviewer name a topic, organiser or adjacent event to search. The public form stays minimal; the review step derives these fields from the supplied source.

## Persistent memory

- `Event Sources`: normalized alternative URL, reported URL, matched Master ID, submission ID, recorded date and note. Use it before inserting an event; a URL mapping to two IDs is a conflict requiring review.
- `Discovery Leads`: series, organiser, topic or similar-event cue, official seed URL, geography, origin, status, last/next check and result. `WATCH` leads recur until deliberately paused or done. A confirmed submission adds a similar-event cue and, where known, an organiser or reviewer topic cue. Matching leads are not duplicated.
- `Events`: only verified, editorially approved occurrences. `WATCH` or uncertain leads do not automatically become calendar entries.

## Each discovery sweep

Start with due `WATCH` leads and newly reviewed submissions. Search an official series/organiser page for changes and next editions. Then search for comparable events in the same sector across other European hubs and countries, not only near the original event. Cross-check candidates against the master IDs, aliases and series before proposing additions. Update each checked lead's result and dates even when no event was found. Follow with the usual country/hub, sector, ecosystem/VC and independent omission passes. A lead can be `PAUSED` when its source is dead or repeatedly irrelevant, with a reason; do not silently delete it.

The active monthly sweep includes these checks. Weekly Main/Additional and Policy sweeps use the same memory when enabled. Calendar sync remains separate and publishes only eligible rows from `Events`.
