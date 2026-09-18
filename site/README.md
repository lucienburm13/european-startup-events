# European Startup Events — website v0.1

Dependency-light public frontend for the European Startup Events master calendar.

## Architecture

- Google Sheet remains the single source of truth.
- `public/events.json` is a generated snapshot used until the read-only Apps Script web API is deployed.
- `config.js` can switch the frontend to the live API without changing the UI.
- Event submissions go to a separate `Submissions` queue and never publish directly.
- Existing Main / Additional / Policy Google Calendars remain the subscription layer.

## Frontend

Plain HTML, CSS and JavaScript on purpose: no framework, no package install, no build step.

Implemented in v0.1:

- period, category, country and search filters
- List view
- dependency-free Calendar view
- Map view prepared for master `Latitude` / `Longitude`
- Google Calendar + public iCal subscription links
- event submission modal/API contract
- European Stack Index badge and methodology

## Configuration

Edit `config.js`:

- `eventsApiUrl`: deployed Apps Script web-app URL for live events
- `submissionApiUrl`: normally the same Apps Script web-app URL
- `tallyFormUrl`: optional Tally alternative
- stack provider configuration

## Apps Script

`../apps-script/WebApi.gs` adds a read-only `doGet()` events endpoint and a controlled `doPost()` submission endpoint. Add it to the existing Apps Script project and deploy as a Web app when ready.

## Hosting

The site is static and can be hosted on any static host. The intended European-first production choice is Koyeb or another suitable European provider; this is shown as **planned**, not active, until actually deployed.
