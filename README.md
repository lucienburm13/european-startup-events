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

All normal entries are transparent and all-day. `CONFIRMED` titles are clean; `TBC`, `CONFLICT`, `POSTPONED`, and `CANCELLED` may carry explicit prefixes according to the master rules.

## Robustness principles

The calendar sync is intentionally conservative:

- **Idempotent reconciliation:** events are matched by private `masterId`, not by title or date.
- **No wipe-and-rebuild:** unchanged events are untouched.
- **Ownership marker:** the script only deletes events carrying its own private `managedBy=euse-v1` marker.
- **Stable identity through changes:** date, title, venue, location and description updates patch the same managed event.
- **Duplicate guard:** if more than one managed event has the same master ID, the run stops before writing.
- **Large-change guard:** unexpectedly large batches of inserts/updates stop automatically unless a force-run is explicitly used after review.
- **Deletion grace:** a missing source row must stay missing for at least 24 hours and two sync observations before deletion is even eligible.
- **Deletion cap:** too many deletions in one run trigger a safety halt.
- **Delete-last:** deletes are attempted only after every insert/update has succeeded.
- **ETag protection:** updates use the event ETag so concurrent external edits do not get silently overwritten.
- **Locking:** overlapping sync runs are prevented.
- **Audit trail:** every run writes to a `Sync Log` sheet.
- **Canary first:** production bootstrap starts with a single managed event before full sync.

## Apps Script source

See [`apps-script/`](apps-script/).

Files:
- `Code.gs` — validation, planning, safe reconciliation and daily trigger.
- `Canary.gs` — one-event production canary and safe removal helper.
- `appsscript.json` — timezone, OAuth scopes and Advanced Calendar API service.

The implementation uses the Google Calendar Advanced Service because the Calendar API supports private extended properties for durable application-specific event metadata and conditional updates.

## Rollout procedure

Do **not** run the full bootstrap immediately.

1. Create an Apps Script project under the same Google account that owns the three calendars.
2. Copy `Code.gs`, `Canary.gs`, and `appsscript.json` into it.
3. Ensure the Advanced Calendar service is enabled.
4. Run `canarySync()` and approve the requested Google permissions.
5. Verify that master event ID 1 appears as a **native all-day, transparent** event in the Main Google Calendar and subsequently in Apple Calendar through the normal Google-account sync.
6. Run `previewSync()` and inspect the planned insert/update/stale counts.
7. Only when the plan is expected, run `syncAllCalendarsForce()` once for the initial bootstrap.
8. Verify event counts and spot-check Main, Additional and Policy in Google Calendar and Apple Calendar.
9. Remove the legacy midnight-placeholder events only after the native events are proven correct.
10. Run `setup()` to install the daily safe sync. Future automatic runs use `syncAllCalendars()` and cannot bypass the safety thresholds.

## Update cadence

The discovery sweeps do not write directly to calendars. They edit the master Sheet. The Apps Script reconciles once daily around 05:20 Europe/Amsterdam, so a source correction normally reaches subscribers within one day.

For public subscribers, this is a subscription rather than an import: changes to the native public Google Calendars continue to propagate. External clients such as Apple Calendar and Outlook control their own refresh timing.
