#!/usr/bin/env python3
import json, os, re, sys, hashlib
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image
from io import BytesIO

ROOT = Path(__file__).resolve().parents[1]
ORG_FILE = ROOT / "site/public/organizations.json"
OUT_DIR = ROOT / "site/public/org-logos"
OUT_DIR.mkdir(parents=True, exist_ok=True)

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; EuropeanStartupEvents/1.0; +https://european-startup-events.sites.deploybase.eu/)"
})

# Better/current sources for logos that were too small or were not present in the
# old AfS/ESN member directories. Official-site discovery is tried before fallback.
FALLBACK_OVERRIDES = {
    "Dutch Startup Association": [
        "https://d21buns5ku92am.cloudfront.net/69190/logo/retina-1606397307.png"
    ],
    "351 Portuguese Startup Association": [
        "https://res.cloudinary.com/startup-grind/image/upload/c_fill,dpr_2,f_auto,g_center,q_auto:good/v1/gcs/platform-data-startupgrind/events/351_UB1mbWa.png"
    ],
    "Italian Tech Alliance": [
        "https://static.wixstatic.com/media/ffd03c_7b7b6559b2e44d3390c559e334d083cb~mv2.jpeg/v1/fill/w_1920,h_1080,al_c/ffd03c_7b7b6559b2e44d3390c559e334d083cb~mv2.jpeg"
    ],
    "Finnish Startup Community": [
        "https://media.licdn.com/dms/image/sync/v2/D4D27AQEpliWa_AD5Ig/articleshare-shrink_800/articleshare-shrink_800/0/1741437759252?e=2147483647&t=3_DiR8LxwlSw69B5oRWwh0wUTcz2IG27C6Kfy6uhwMI&v=beta"
    ],
    "Roma Startup": [
        "https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,dpr=2,anim=false,background=white,quality=90,width=1000,height=1000/event-covers/99/ac747dfb-8c66-45ac-aadd-c22379c9ed11"
    ],
    "PULSE - Luxembourg Startup Association": [
        "https://cdn.prod.website-files.com/66f2760c285e839111b37ed0/68acdae6d9b9320e0b28a9f6_News%2041.png"
    ],
    "Startup Portugal": [
        "https://images.squarespace-cdn.com/content/v1/689b57bf3648515a7496d9e9/c7224310-75cc-4a53-a47d-9d8e8b08aacb/FE-23-startup-portugal-1024x768.png"
    ],
}

DISCOVER_ON_OFFICIAL_SITE = {
    "Startup Cyprus",
    "Estonian Founders Society",
    "Finnish Startup Community",
    "Roma Startup",
    "PULSE - Luxembourg Startup Association",
    "Startup Portugal",
    "Italian Tech Alliance",
    "Dutch Startup Association",
    "351 Portuguese Startup Association",
}

def slugify(s):
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80] or hashlib.sha1(s.encode()).hexdigest()[:12]

def ext_from_response(url, response, body):
    ct = (response.headers.get("content-type") or "").lower()
    if "svg" in ct or body.lstrip().startswith(b"<svg") or b"<svg" in body[:1000]:
        return "svg"
    if "png" in ct or body.startswith(b"\x89PNG"):
        return "png"
    if "webp" in ct or body[:4] == b"RIFF" and b"WEBP" in body[:16]:
        return "webp"
    if "jpeg" in ct or "jpg" in ct or body.startswith(b"\xff\xd8"):
        return "jpg"
    p = urlparse(url).path.lower()
    for ext in ("svg","png","webp","jpg","jpeg"):
        if p.endswith("." + ext):
            return "jpg" if ext == "jpeg" else ext
    return None

def validate_image(ext, body):
    if len(body) < 500:
        return False
    if ext == "svg":
        txt = body[:5000].decode("utf-8", "ignore").lower()
        return "<svg" in txt
    try:
        im = Image.open(BytesIO(body))
        w, h = im.size
        return w >= 80 and h >= 40
    except Exception:
        return False

def fetch_image(url):
    try:
        r = session.get(url, timeout=25, allow_redirects=True)
        if r.status_code != 200:
            return None
        body = r.content
        ext = ext_from_response(r.url, r, body)
        if not ext or not validate_image(ext, body):
            return None
        return r.url, ext, body
    except Exception:
        return None

def image_score(tag, abs_url, org_name):
    attrs = " ".join([
        tag.get("alt",""), tag.get("title",""), tag.get("class","") if isinstance(tag.get("class"), str) else " ".join(tag.get("class",[])),
        tag.get("id",""), abs_url
    ]).lower()
    score = 0
    if "logo" in attrs: score += 80
    if "brand" in attrs: score += 30
    if "header" in attrs or "navbar" in attrs or "nav-" in attrs: score += 20
    tokens = [t for t in re.findall(r"[a-z0-9]+", org_name.lower()) if len(t)>3 and t not in {"startup","association","community","society"}]
    score += 12 * sum(t in attrs for t in tokens)
    if any(x in attrs for x in ["partner","member-logo","sponsor","avatar","person","team","event"]): score -= 50
    if any(x in abs_url.lower() for x in [".svg",".png",".webp",".jpg",".jpeg"]): score += 8
    return score

def discover_official_logo(org):
    url = org.get("url")
    if not url:
        return [], None
    try:
        r = session.get(url, timeout=25, allow_redirects=True)
        if r.status_code != 200 or "html" not in (r.headers.get("content-type") or ""):
            return [], None
        soup = BeautifulSoup(r.text, "html.parser")
        candidates = []
        for tag in soup.find_all(["img","source"]):
            raw = tag.get("src") or tag.get("data-src") or tag.get("data-lazy-src")
            if not raw and tag.get("srcset"):
                raw = tag.get("srcset").split(",")[-1].strip().split(" ")[0]
            if not raw:
                continue
            abs_url = urljoin(r.url, raw)
            if abs_url.startswith("data:"):
                continue
            score = image_score(tag, abs_url, org["name"])
            if score > 15:
                candidates.append((score, abs_url))
        # Header/nav inline SVG is often the cleanest current wordmark.
        inline_svg = None
        for parent in soup.find_all(["header","nav"]):
            svg = parent.find("svg")
            if svg and len(str(svg)) > 250:
                inline_svg = str(svg)
                break
        candidates.sort(reverse=True)
        return [u for _,u in candidates[:10]], inline_svg
    except Exception:
        return [], None

def write_inline_svg(org, svg):
    name = slugify(org["name"]) + ".svg"
    path = OUT_DIR / name
    path.write_text(svg, encoding="utf-8")
    return "./public/org-logos/" + name, "inline SVG from official site"

def main():
    data = json.loads(ORG_FILE.read_text(encoding="utf-8"))
    failed = []
    changed = 0
    for org in data["organizations"]:
        name = org["name"]
        old_logo = org.get("logo")
        # Already local and present: keep it.
        if old_logo and old_logo.startswith("./public/org-logos/") and (ROOT / "site" / old_logo[2:]).exists():
            continue

        candidates = []
        inline_svg = None
        if name in DISCOVER_ON_OFFICIAL_SITE:
            found, inline_svg = discover_official_logo(org)
            candidates.extend(found)
        candidates.extend(FALLBACK_OVERRIDES.get(name, []))
        if old_logo and old_logo.startswith("http"):
            candidates.append(old_logo)

        saved = None
        source = None
        # Prefer a clean inline official header SVG over third-party fallbacks.
        if inline_svg:
            try:
                saved, source = write_inline_svg(org, inline_svg)
            except Exception:
                saved = None

        if not saved:
            seen = set()
            for candidate in candidates:
                if candidate in seen: continue
                seen.add(candidate)
                got = fetch_image(candidate)
                if not got:
                    continue
                final_url, ext, body = got
                filename = slugify(name) + "." + ext
                (OUT_DIR / filename).write_bytes(body)
                saved = "./public/org-logos/" + filename
                source = final_url
                break

        if saved:
            org["logoOriginal"] = old_logo or source
            org["logo"] = saved
            org["logoSource"] = source
            changed += 1
            print(f"OK  {name}: {saved} <- {source}")
        else:
            failed.append(name)
            print(f"MISS {name}")

    data["count"] = len(data["organizations"])
    data["logoCacheUpdatedAt"] = "2026-09-23"
    ORG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Cached/updated {changed} logos; missing {len(failed)}")
    if failed:
        print("Missing:", ", ".join(failed))
        # Do not fail the workflow: keep wordmark fallback in the UI.
    return 0

if __name__ == "__main__":
    sys.exit(main())
