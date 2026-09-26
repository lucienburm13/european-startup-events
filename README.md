# European Startup Events

Public calendar infrastructure for a curated European startup / tech / policy events database.

## Architecture

**Source of truth:** Google Sheet `European Startup & Tech Events — Master 2026–2027`.

**Discovery:**
- weekly Policy sweep
- weekly Main + Additional delta sweep
- monthly deep sweep: country/hub + sector + ecosystem/VC + omission audit

**Publishing path:**
1. sweeps update the master Sheet only;
2. a daily Google Apps Script reconciles the Sheet with three native Google Calendars;
3. those Google Calendars are the primary public subscription layer;
4. Google users subscribe directly to the calendars; Apple / Outlook users subscribe to the Google calendars' public iCal URLs;
5. GitHub ICS files remain an open fallback/export, not the primary sync path.

## Native calendars

- European Startup Events - Main
- European Startup Events - Additional
- European Startup Events - Policy

### Planned: Hosted

`Hosted` is a fourth editorial calendar for substantive European startup ecosystem events run by a startup/scaleup, investor, corporate or ecosystem organisation. `Hosted by` records the organiser type (`Startup`, `Scaleup`, `Investor`, `Corporate`, `Ecosystem`); it is not a sponsorship or paid-placement flag. An event belongs in one calendar only. Main, Additional and Policy keep their existing meaning until individual events are reviewed for a move.

The submission review queue and master `Events` sheet now have `Hosted by`. The website and export pipeline can carry `hostedBy`, while the calendar sync derives its calendar names from its configured IDs. **Activation requires a real fourth public Google Calendar ID** and deployment of the matching Apps Script sources. Add the new ID to `CONFIG.calendars` in `apps-script/Code.gs` and `site/config.js` together. Then run `previewSync()` and inspect the plan before allowing any Hosted row to publish. The public site shows Hosted in its type filter only after a verified Hosted event enters the feed.

All normal entries are transparent and all-day. `CONFIRMED` titles are clean; `TBC`, `CONFLICT`, `POSTPONED`, and `CANCELLED` may carry explicit prefixes according to the master rules.

## Robustness principles

The calendar sync is intentionally conservative:

- **Idempotent reconciliation:** events are matched by private Calendar event tags (`masterId`), not by title or date.
- **No wipe-and-rebuild:** unchanged events are untouched.
- **Ownership marker:** the script only deletes events carrying its own `managedBy=euse-v2` tag.
- **Stable identity through changes:** date, title, venue, location and description changes update the same managed event.
- **Duplicate guard:** if more than one managed event has the same master ID, the run stops before writing.
- **Large-change guard:** unexpectedly large batches of inserts/updates stop automatically unless a force-run is explicitly used after review.
- **Deletion grace:** a missing source row must stay missing for at least 24 hours and two sync observations before deletion is eligible.
- **Deletion cap:** too many deletions in one run trigger a safety halt.
- **Delete-last:** deletes are attempted only after every insert/update has succeeded.
- **Locking:** overlapping sync runs are prevented.
- **Audit trail:** every run writes to a `Sync Log` sheet.
- **Canary first:** production bootstrap starts with a single managed event before full sync.

## Apps Script source

See [`apps-script/Code.gs`](apps-script/Code.gs).

The implementation deliberately uses Apps Script's built-in `CalendarApp`, including native all-day events and Calendar event tags. No Advanced Calendar API service and no custom `appsscript.json` are required.

## Rollout procedure

Do **not** run the full bootstrap immediately.

1. Create an Apps Script project under the same Google account that owns the three calendars.
2. In Project Settings, set the time zone to `Europe/Amsterdam`.
3. Replace the contents of the project's `Code.gs` with `apps-script/Code.gs` from this repository. No other files or services are needed.
4. Run `canarySync()` and approve the requested Google permissions.
5. Verify that master event ID 1 appears as a **native all-day, transparent** event in the Main Google Calendar and subsequently in Apple Calendar through the normal Google-account sync.
6. Run `previewSync()` and inspect the planned insert/update/stale counts.
7. Only when the plan is expected, run `syncAllCalendarsForce()` once for the initial bootstrap.
8. Verify event counts and spot-check Main, Additional and Policy in Google Calendar and Apple Calendar.
9. Remove the legacy midnight-placeholder events only after the native events are proven correct.
10. Run `setup()` to install the daily safe sync. Future automatic runs use `syncAllCalendars()` and cannot bypass the safety thresholds.

## Update cadence

The discovery sweeps do not write directly to calendars. They edit the master Sheet. The Apps Script reconciles once daily in the early morning, so a source correction normally reaches the native Google calendars within one day.

For public subscribers, this is a subscription rather than an import: changes to the native public Google Calendars continue to propagate. External clients such as Apple Calendar and Outlook control their own refresh timing.
