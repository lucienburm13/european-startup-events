# Event submission form — Tally spec

Goal: make submitting a missing event almost frictionless while keeping publication editorially controlled.

## Visible copy

**Missing an event?**

Paste the official public event page or programme URL.

Submissions are reviewed before publication. We only add events that are sufficiently relevant to the European startup, tech, business or policy ecosystem.

## Field

1. **Official event or programme URL** — URL — required
   - Help text: “An official public URL is required before we can review an event.”

No other fields are required in the public form. Event name, dates, location and organiser information are derived during review from the official source.

## Editorial review

Every submission goes into the `Submissions` queue and is checked before it can enter the public calendar.

Review for:
- relevance to founders, startups/scaleups, investors, tech companies, ecosystem builders or policymakers;
- meaningful connection to Europe and the site's geographic scope;
- a real event/programme with a verifiable official public source;
- sufficient substance for the target audience, not merely a generic sales, recruitment or promotional listing;
- duplicate / series matching against existing events.

Possible internal outcomes: `NEW`, `REVIEW`, `APPROVED`, `REJECTED`.

Approval is editorial. Submission does not guarantee publication, and payment or sponsorship must never determine inclusion.

## Completion message

Thanks. We’ll check the event for relevance, verify the official source and check for duplicates before anything is added to the public calendar.

## Google Sheets integration

Connect the form to the existing spreadsheet **European Startup & Tech Events — Master 2026–2027** and the existing tab **Submissions**.

The submitted URL is written to the queue. Internal columns `Status`, `Review notes`, `Decision` and `Master ID` remain controlled by the review process. New submissions should start as `NEW`.

No submission is ever written directly to `Events`.
