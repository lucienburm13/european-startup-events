# Event submission form — Tally spec

Goal: make submitting a missing event almost frictionless while keeping publication editorially controlled.

## Visible copy

**Missing an event?**

Paste the official public event page or programme URL.

Submissions are reviewed before publication. We only add events that are sufficiently relevant to the European startup, tech, business or policy ecosystem.

## Form structure

The website already collects the official URL and performs the first duplicate check. The Tally form should therefore be almost invisible:

1. **Hidden field `url`** — populated from the website query parameter `?url=...`
2. **Hidden field `source`** — value `website`
3. Short confirmation text: “Submit this event for review?”
4. Submit button

No second URL entry and no other public fields. Event name, dates, location and organiser information are derived during review from the official source.

The website passes the URL into Tally using its existing `tallyFormUrl` integration. Tally hidden fields accept URL parameters, so the visitor does not need to paste anything twice.

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

The submitted URL is written to the queue in real time. Internal review columns remain controlled by the review process.

Recommended internal columns:
- `Status` — NEW / REVIEWED / DECIDED
- `Suggested decision` — ACCEPT / REVIEW / REJECT
- `Suggested calendar` — Main / Additional / Policy / Hosted
- `Hosted by` — Startup / Scaleup / Investor / Corporate / Ecosystem
- `Confidence` — High / Medium / Low
- `AI review reason`
- `Suggested event name`
- `Suggested dates`
- `Suggested city`
- `Suggested country`
- `Suggested organiser`
- `Duplicate / series match`
- `Human decision`
- `Master ID`

New submissions start as `NEW`. No submission is ever written directly to `Events`.
