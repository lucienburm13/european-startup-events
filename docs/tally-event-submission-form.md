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
- `Suggested calendar` — Main / Additional / Policy / Ecosystem
- `Organised by` — Startup / Scaleup / Investor / Corporate / Ecosystem
- `Confidence` — High / Medium / Low
- `AI review reason`
- `Suggested event name`
- `Suggested dates`
- `Suggested city`
- `Suggested country`
- `Suggested organiser`
- `Duplicate / series match`
- `Matched Master ID` — required for a human `DUPLICATE` decision
- `Sweep cue` — a related series, organiser, topic or comparable event to research later
- `Human decision`
- `Master ID`

New submissions start as `NEW`. No submission is ever written directly to `Events`.


## Human review and publication

The `Submissions` tab is the review inbox. Google Sheets conditional notifications alert the human reviewer when column A receives a new Submission ID.

AI review is intentionally not autonomous. When asked, ChatGPT reviews all still-unreviewed submissions, researches the submitted URL, checks the `Events` tab for duplicates/series matches, and fills the review/proposed-publication fields.

The human reviewer then sets `Decision` to:
- `APPROVE` — publish the reviewed proposal to `Events`
- `REJECT` — do not publish
- `HOLD` — keep pending
- `DUPLICATE` — link an alternative URL to an existing Master ID; do not add another event

Additional proposed-publication fields:
- `Proposed start date`
- `Proposed end date`
- `Proposed venue`
- `Proposed status`
- `Proposed calendar title`
- `Proposed notes`
- `Proposed official source`
- `Proposed full address`

An installable Apps Script on-edit trigger handles a human edit of `Decision` to `APPROVE` or `DUPLICATE`. For `APPROVE`, it validates required fields, blocks likely duplicates, assigns the next numeric Master ID, appends the event to `Events`, and writes the new Master ID back to the submission. It never auto-approves or changes the human decision.

A human `DUPLICATE` decision with `Matched Master ID` records the alternative URL in `Event Sources` and an ongoing search cue in `Discovery Leads`. `APPROVE` also adds discovery cues after the event is published. See [the feedback loop](discovery-feedback-loop.md). The live Apps Script project must contain the current `SubmissionApproval.gs` for these actions; editing the GitHub source alone does not install it.
