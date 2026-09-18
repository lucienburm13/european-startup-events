# Event submission form — Tally spec

Goal: make submitting a missing event almost frictionless while keeping publication controlled.

## Visible copy

**Missing an event?**

Paste the official event page or programme. We verify every submission before it enters the public calendar.

## Fields

1. **Event or programme URL** — URL — primary field
   - Help text: “One official link is normally enough.”
2. **Event name** — short text — optional
   - Show prominently only when URL is empty / unknown.
3. **Dates / timing** — short text — optional
4. **City / country** — short text — optional
5. **Contact email** — email — optional
   - Help text: “Only used if we need clarification about this submission.”
6. **Anything else we should know?** — long text — optional

## Completion message

Thanks. We’ll verify the event, check for duplicates and classify it before anything is added to the public calendar.

## Google Sheets integration

Connect the form to the existing spreadsheet **European Startup & Tech Events — Master 2026–2027** and the existing tab **Submissions**.

Map form fields to the corresponding columns. Internal columns `Status`, `Review notes`, `Decision` and `Master ID` remain controlled by the review process. New submissions should start as `NEW`.

Tally's native Google Sheets integration can write to an existing spreadsheet and sheet. No submission is ever written directly to `Events`.
