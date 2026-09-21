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
- Map view with cached city coordinates; overlapping events are grouped per location
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

## Deploy on Koyeb

[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&builder=dockerfile&repository=github.com/lucienburm13/european-startup-events&branch=site-v0.1&workdir=site&name=european-startup-events&ports=8000%3Bhttp%3B%2F)

This branch includes a small Docker/Caddy setup so the static site can be deployed directly from GitHub.

Suggested settings:

- repository: `lucienburm13/european-startup-events`
- branch while testing: `site-v0.1`
- work directory: `site`
- builder: Dockerfile
- exposed HTTP port: `8000`
- health route: `/`

After launch, point the intended custom subdomain to the Koyeb service.

## Live master feed

The site works immediately from `public/events.json`. The current snapshot contains 156 published events and matches the master Sheet. For production, add `apps-script/WebApi.gs` to the existing calendar Apps Script project and deploy it as a public Web app.

Set the resulting `/exec` URL as `eventsApiUrl` in `config.js`. The browser uses a read-only JSONP callback for the events feed; the static snapshot remains the fallback.

## Event submissions

Preferred production route: create the minimal Tally form described in `../docs/tally-event-submission-form.md` and connect it to the existing `Submissions` tab in the master spreadsheet. Then set `tallyFormUrl` in `config.js`.

The website never writes submissions straight into `Events`.

## Map

The interactive map uses MapLibre with OpenFreeMap. `scripts/geocode_locations.py` builds a derived city-coordinate cache for map pins and deliberately skips ambiguous multi-city / online locations.

## Remaining production connections

The site code on `site-v0.1` is preview-ready. Production still needs four account-level connections that are intentionally not hard-coded into the repository:

1. deploy the Apps Script Web API and set `eventsApiUrl`;
2. create/connect the Tally submission form and set `tallyFormUrl` (or use the Apps Script submission endpoint);
3. deploy the static Docker site on Koyeb and attach the chosen domain/DNS;
4. enable Plausible only after the production domain exists.

Keep `main` untouched until the preview has been checked.
