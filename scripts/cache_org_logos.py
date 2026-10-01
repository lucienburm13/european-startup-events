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
FORCE_SOURCES = {
    "Czech Founders": [
        "https://europeanstartupnetwork.eu/wp-content/uploads/2025/01/Czech-Founders.jpeg"
    ],
    "Roma Startup": [
        "https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,dpr=2,anim=false,background=white,quality=90,width=1000,height=1000/event-covers/99/ac747dfb-8c66-45ac-aadd-c22379c9ed11"
    ],
    "Dutch Startup Association": [
        "https://d21buns5ku92am.cloudfront.net/69190/logo/retina-1606397307.png"
    ],
    "351 Portuguese Startup Association": [
        "https://res.cloudinary.com/startup-grind/image/upload/c_fill,dpr_2,f_auto,g_center,q_auto:good/v1/gcs/platform-data-startupgrind/events/351_UB1mbWa.png"
    ],
    "Italian Tech Alliance": [
        "https://static.wixstatic.com/media/ffd03c_ab2150e8783c47d7b3ca561974169370~mv2.png"
    ],
    "Finnish Startup Community": [
        "https://startupyhteiso.com/wp-content/uploads/fsc-logo-w.svg"
    ],
    "PULSE - Luxembourg Startup Association": [
        "https://cdn.prod.website-files.com/66f2760c285e839111b37ed0/68acdae6d9b9320e0b28a9f6_News%2041.png"
    ],
    "Startup Portugal": [
        "https://startupportugal.com/wp-content/themes/start-up-portugal/dist/assets/logo.svg"
    ],
}

FALLBACK_OVERRIDES = {
    "Start2 Group GmbH": [
        "https://media.licdn.com/dms/image/v2/D4D05AQFnDXla3tdQhQ/feedshare-thumbnail_720_1280/feedshare-thumbnail_720_1280/0/1706689992914?e=2147483647&t=XAiU03X-Ds50BN_iNZPSR5pfJw_LZLdwfDFJFObO1H8&v=beta"
    ],
    "Roma Startup": [
        "https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,dpr=2,anim=false,background=white,quality=90,width=1000,height=1000/event-covers/99/ac747dfb-8c66-45ac-aadd-c22379c9ed11"
    ],
}


SPECIAL_CROPS = {
    # The available PULSE press image contains a board photo and partner strip.
    # Keep only the clean association wordmark area.
    "PULSE - Luxembourg Startup Association": (0.12, 0.53, 0.88, 0.80),
}

DISCOVER_ON_OFFICIAL_SITE = {
    "Startup Cyprus",
    "Czech Founders",
    "Roma Startup",
    "Start2 Group GmbH",
}
FORCE_REFRESH = {"Startup Cyprus", "Roma Startup", "Start2 Group GmbH"}

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

def normalize_selected_raster(name, ext, body):
    if ext not in {"png","jpg","webp"}:
        return ext, body
    try:
        im = Image.open(BytesIO(body)).convert("RGBA")
        w,h = im.size

        if name == "Dutch Startup Association":
            # Newsroom PNG is a white mark on transparency; make it black.
            im.putdata([(0,0,0,a) if a else (0,0,0,0) for r,g,b,a in im.getdata()])

        if name == "PULSE - Luxembourg Startup Association":
            # Remove the neutral light background from the cropped press wordmark.
            cleaned=[]
            for r,g,b,a in im.getdata():
                if a and (max(r,g,b)-min(r,g,b)) < 14 and min(r,g,b) > 150:
                    cleaned.append((255,255,255,0))
                else:
                    cleaned.append((r,g,b,a))
            im.putdata(cleaned)

        if name in {"Czech Founders","Roma Startup","351 Portuguese Startup Association","Dutch Startup Association","PULSE - Luxembourg Startup Association"}:
            # Tight visual bounds, retaining 4% breathing room.
            if name in {"Dutch Startup Association","PULSE - Luxembourg Startup Association"}:
                mask=im.getchannel("A")
            else:
                mask=Image.new("L", im.size, 0)
                mp=mask.load(); ip=im.load()
                for y in range(im.height):
                    for x in range(im.width):
                        r,g,b,a=ip[x,y]
                        if a > 20 and min(r,g,b) < 242:
                            mp[x,y]=255
            bbox=mask.getbbox()
            if bbox:
                l,t,r,b=bbox
                pad=max(4, int(max(r-l,b-t)*0.04))
                im=im.crop((max(0,l-pad),max(0,t-pad),min(im.width,r+pad),min(im.height,b+pad)))

        out=BytesIO()
        im.save(out, format="PNG", optimize=True)
        return "png", out.getvalue()
    except Exception:
        return ext, body

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
    tokens = [t for t in re.findall(r"[a-z0-9]+", org_name.lower()) if len(t)>3 and t not in {"association","community","society"}]
    score += 16 * sum(t in attrs for t in tokens)
    parent = tag.parent
    for _ in range(4):
        if parent is None: break
        parent_attrs = " ".join([parent.name or "", parent.get("id",""), " ".join(parent.get("class",[]))]).lower()
        if "header" in parent_attrs or "nav" in parent_attrs:
            score += 80
            break
        parent = parent.parent
    if any(x in attrs for x in ["partner","member-logo","sponsor","avatar","person","team","event"]): score -= 50
    if "sg-logo" in attrs or "startupgrind" in attrs or "startup-grind" in attrs: score -= 160
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
        inline_svg = None
        candidates.sort(reverse=True)
        return [u for _,u in candidates[:10]], inline_svg
    except Exception:
        return [], None

def write_inline_svg(org, svg):
    name = slugify(org["name"]) + ".svg"
    path = OUT_DIR / name
    path.write_text(svg, encoding="utf-8")
    return "./public/org-logos/" + name, "inline SVG from official site"

def raster_stats(path):
    try:
        im = Image.open(path).convert("RGBA")
        w,h = im.size
        px = im.load()
        corners = [px[0,0],px[w-1,0],px[0,h-1],px[w-1,h-1]]
        bg = tuple(sum(p[i] for p in corners)//4 for i in range(4))
        xs=[]; ys=[]
        step=max(1,min(w,h)//500)
        for y in range(0,h,step):
            for x in range(0,w,step):
                p=px[x,y]
                d=sum(abs(p[i]-bg[i]) for i in range(3)) + abs(p[3]-bg[3])
                if d>70:
                    xs.append(x); ys.append(y)
        bbox=(min(xs),min(ys),max(xs)+1,max(ys)+1) if xs else None
        return {"size":[w,h],"corner":bg,"content_bbox":bbox}
    except Exception as e:
        return {"error":str(e)}

def main():
    data = json.loads(ORG_FILE.read_text(encoding="utf-8"))
    failed = []
    changed = 0
    for org in data["organizations"]:
        name = org["name"]
        old_logo = org.get("logo")
        force_sources = FORCE_SOURCES.get(name, [])
        # Already local and present: keep it unless this organisation has a forced better source.
        if name not in FORCE_REFRESH and not force_sources and old_logo and old_logo.startswith("./public/org-logos/") and (ROOT / "site" / old_logo[2:]).exists():
            continue

        candidates = list(force_sources)
        inline_svg = None
        if name in DISCOVER_ON_OFFICIAL_SITE:
            found, inline_svg = discover_official_logo(org)
            if name in FORCE_REFRESH:
                print("DISCOVER", name, *found[:8], sep="\n  ")
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
                # Normalize known special cases for the monochrome site.
                if name == "Finnish Startup Community" and ext == "svg":
                    txt = body.decode("utf-8", "ignore")
                    txt = re.sub(r"#fff(?:fff)?\b", "#111111", txt, flags=re.I)
                    txt = re.sub(r"white\b", "#111111", txt, flags=re.I)
                    body = txt.encode("utf-8")
                filename = slugify(name) + "." + ext
                if name in SPECIAL_CROPS and ext != "svg":
                    try:
                        im = Image.open(BytesIO(body)).convert("RGBA")
                        x1,y1,x2,y2 = SPECIAL_CROPS[name]
                        box=(int(im.width*x1),int(im.height*y1),int(im.width*x2),int(im.height*y2))
                        im=im.crop(box)
                        out=BytesIO()
                        im.save(out, format="PNG")
                        body=out.getvalue()
                        ext="png"
                        filename=slugify(name)+".png"
                    except Exception:
                        pass
                ext, body = normalize_selected_raster(name, ext, body)
                filename = slugify(name) + "." + ext
                (OUT_DIR / filename).write_bytes(body)
                saved = "./public/org-logos/" + filename
                source = final_url
                break

        if saved:
            org["logoOriginal"] = org.get("logoOriginal") or (old_logo if old_logo and old_logo.startswith("http") else source)
            org["logo"] = saved
            org["logoSource"] = source
            changed += 1
            print(f"OK  {name}: {saved} <- {source}")
        else:
            failed.append(name)
            print(f"MISS {name}")

    for check in ["czech-founders.jpg","roma-startup.jpg","dutch-startup-association.png","351-portuguese-startup-association.png","pulse-luxembourg-startup-association.png"]:
        p=OUT_DIR/check
        if p.exists(): print("ASSETSTAT", check, raster_stats(p))
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
