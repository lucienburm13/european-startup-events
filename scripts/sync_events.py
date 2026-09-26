#!/usr/bin/env python3
# Snapshot sync source: public read-only Apps Script feed.
import json
import os
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site" / "public" / "events.json"
FEED_URL = os.environ.get("EVENTS_FEED_URL", "").strip()
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

FIELDS = [
    "id", "start", "end", "name", "city", "country", "venue",
    "calendar", "status", "title", "notes", "source",
    "lastVerified", "address", "hostedBy"
]
REQUIRED = ["id", "start", "name", "calendar", "status"]

def clean(value):
    return str(value or "").strip()

def fetch_feed():
    if not FEED_URL:
        raise RuntimeError("EVENTS_FEED_URL is not set")
    req = urllib.request.Request(
        FEED_URL,
        headers={"User-Agent": "EuropeanStartupEvents-SnapshotSync/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read().decode("utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        preview = raw[:200].replace("\n", " ")
        raise RuntimeError(f"Feed did not return JSON: {preview}") from exc
    if not data.get("ok"):
        raise RuntimeError(f"Feed returned ok=false: {data.get('error', 'unknown error')}")
    events = data.get("events")
    if not isinstance(events, list):
        raise RuntimeError("Feed has no events array")
    return data

def normalize_event(row):
    event = {field: clean(row.get(field)) for field in FIELDS}
    # Preserve coordinates only when the source sheet actually supplies them.
    lat, lng = clean(row.get("lat")), clean(row.get("lng"))
    if lat and lng:
        event["lat"] = lat
        event["lng"] = lng
    return event

def validate(events, old_count):
    if not events:
        raise RuntimeError("Refusing to publish an empty event feed")

    ids = []
    for i, event in enumerate(events, 1):
        missing = [key for key in REQUIRED if not event.get(key)]
        if missing:
            raise RuntimeError(f"Row {i} missing required fields: {', '.join(missing)}")
        if not DATE_RE.match(event["start"]):
            raise RuntimeError(f"Invalid start date for ID {event['id']}: {event['start']}")
        if event.get("end") and not DATE_RE.match(event["end"]):
            raise RuntimeError(f"Invalid end date for ID {event['id']}: {event['end']}")
        try:
            start = datetime.strptime(event["start"], "%Y-%m-%d")
            end = datetime.strptime(event.get("end") or event["start"], "%Y-%m-%d")
        except ValueError as exc:
            raise RuntimeError(f"Invalid calendar date for ID {event['id']}") from exc
        if end < start:
            raise RuntimeError(f"End date precedes start date for ID {event['id']}")
        ids.append(event["id"])

    if len(ids) != len(set(ids)):
        seen, dupes = set(), set()
        for event_id in ids:
            if event_id in seen:
                dupes.add(event_id)
            seen.add(event_id)
        raise RuntimeError(f"Duplicate event IDs: {', '.join(sorted(dupes))}")

    # Safety rail: a bad Sheet/API configuration must not wipe a healthy site.
    if old_count and len(events) < max(25, int(old_count * 0.75)):
        raise RuntimeError(
            f"Refusing large event-count drop: {old_count} -> {len(events)} "
            "(more than 25%)"
        )

def sort_key(event):
    event_id = event.get("id", "")
    try:
        numeric_id = int(event_id)
    except ValueError:
        numeric_id = 10**12
    return (event.get("start", ""), numeric_id, event_id, event.get("name", ""))

def main():
    old = {}
    if OUT.exists():
        old = json.loads(OUT.read_text(encoding="utf-8"))
    old_events = old.get("events", []) if isinstance(old, dict) else []

    feed = fetch_feed()
    events = [normalize_event(row) for row in feed["events"]]
    events.sort(key=sort_key)
    validate(events, len(old_events))

    if events == old_events:
        print(f"No event changes ({len(events)} events).")
        return

    payload = {
        "generatedFrom": "European Startup & Tech Events — Master 2026–2027",
        "generatedAt": feed.get("generatedAt") or datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "count": len(events),
        "events": events,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated snapshot: {len(old_events)} -> {len(events)} events.")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
