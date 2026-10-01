#!/usr/bin/env python3
import json, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVENTS = ROOT / 'site' / 'public' / 'events.json'
OUT = ROOT / 'site' / 'public' / 'locations.json'
API = 'https://geocoding-api.open-meteo.com/v1/search'

SKIP_WORDS = ('online', 'nationwide')

def clean(value):
    return ' '.join(str(value or '').split())

def key(city, country):
    return f'{clean(city)}|{clean(country)}'

def should_skip(city, country, venue=''):
    c, co, v = clean(city), clean(country), clean(venue)
    low = f'{c} {co} {v}'.lower()
    if not c or not co:
        return True
    if any(w in low for w in SKIP_WORDS):
        return True
    # Multi-city / mixed-country rows are deliberately not pinned to one place.
    if any(sep in c for sep in (' + ', ' / ', '/')):
        return True
    if any(sep in co for sep in (' + ', ' / ', '/')):
        return True
    return False

def fetch_rows(params, attempts=3):
    url = f"{API}?{urllib.parse.urlencode(params)}"
    last_error = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={'User-Agent':'EuropeanStartupEvents/0.1'})
            with urllib.request.urlopen(req, timeout=25) as r:
                return (json.load(r).get('results') or [])
        except Exception as exc:
            last_error = exc
            if attempt < attempts - 1:
                time.sleep(0.8 * (attempt + 1))
    raise last_error

def geocode(city, country):
    rows = fetch_rows({
        'name': f'{city}, {country}',
        'count': 5,
        'language': 'en',
        'format': 'json',
    })
    if not rows:
        rows = fetch_rows({'name': city, 'count': 10, 'language':'en', 'format':'json'})
    if not rows:
        return None
    country_cf = country.casefold()
    exact = [x for x in rows if clean(x.get('country')).casefold() == country_cf]
    row = (exact or rows)[0]
    return {
        'lat': row.get('latitude'),
        'lng': row.get('longitude'),
        'resolvedName': row.get('name',''),
        'resolvedCountry': row.get('country',''),
        'timezone': row.get('timezone',''),
    }

def main():
    data = json.loads(EVENTS.read_text())
    pairs = {}
    for e in data.get('events', []):
        city, country, venue = clean(e.get('city')), clean(e.get('country')), clean(e.get('venue'))
        if should_skip(city, country, venue):
            continue
        pairs[key(city,country)] = (city,country)

    previous = {}
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text()).get('locations', {})
        except Exception:
            previous = {}

    locations = dict(previous)
    errors = []
    for k,(city,country) in sorted(pairs.items()):
        if k in locations and locations[k].get('lat') is not None:
            continue
        try:
            hit = geocode(city,country)
            if hit:
                locations[k] = {'city':city,'country':country,**hit}
            else:
                errors.append({'key':k,'error':'no result'})
        except Exception as exc:
            errors.append({'key':k,'error':str(exc)})
        time.sleep(0.12)

    out = {
        'source': 'Open-Meteo Geocoding API (location data based on GeoNames)',
        'generatedFor': 'European Startup Events',
        'count': len(locations),
        'locations': dict(sorted(locations.items())),
        'unresolved': errors,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
    print(f"resolved={len(locations)} unresolved={len(errors)} total_candidates={len(pairs)}")

if __name__ == '__main__':
    main()
