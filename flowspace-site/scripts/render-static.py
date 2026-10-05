#!/usr/bin/env python3
"""Render the generated parts of flowspace-site from one facts file (S1.1).

The site has no build step, so the facts that appear in several places —
the head, the JSON-LD, the room cards, the price cards, the FAQ, the "Onde
estamos" lines, robots.txt, sitemap.xml, llms.txt, llms-full.txt,
.well-known/security.txt and site.webmanifest — are rendered here from
assets/data/business.json and assets/data/faq.json, and committed. In
index.html only the blocks between `<!-- generated:<name> -->` and
`<!-- /generated:<name> -->` are touched; everything else (the hero, "Como
funciona", the form, the footer) is hand-written and left alone.

    python3 scripts/render-static.py          # rewrite the generated files
    python3 scripts/render-static.py --check  # exit 1 with a diff if any differs

`--check` is what tests/test_static_site.py and CI run, so a fact edited in
one place and not regenerated can never ship. Standard library only.

The `verification` block (S1.6) is the one exception: it is rendered from
site.env.json (gitignored — the Search Console / Bing tokens), and when that
file is absent the block is left exactly as committed, so CI (which has no
tokens) agrees with an owner who rendered them.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
import sys
from datetime import date
from html import escape
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

SITE = Path(__file__).resolve().parent.parent
DATA = SITE / "assets" / "data"
INDEX = SITE / "index.html"
FENCE = re.compile(
    r"(?P<open><!-- generated:(?P<name>[a-z-]+) -->)(?P<body>.*?)(?P<close>[ \t]*<!-- /generated:(?P=name) -->)",
    re.S,
)
LASTMOD = re.compile(r"<lastmod>\d{4}-\d{2}-\d{2}</lastmod>")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def absolute(business: dict, path: str) -> str:
    return business["url"] + path.lstrip("/")


def git_lastmod(*paths: str) -> str:
    """The date of the last commit touching any of `paths`; today when git
    cannot say (a shallow clone, an export) — the check mode ignores the
    value, so a lagging date never fails anything, it just prints."""
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", *paths],
            cwd=SITE, capture_output=True, text=True, check=True,
        ).stdout.strip()
        return out or date.today().isoformat()
    except (OSError, subprocess.CalledProcessError):
        return date.today().isoformat()


# --- facts ----------------------------------------------------------------

def price(value: float) -> str:
    """12 → "12€", 12.5 → "12,50€" — the site's own notation."""
    return (f"{value:.2f}".replace(".", ",") if value != int(value) else str(int(value))) + "€"


def included_text(business: dict) -> str:
    """"What is included", composed from the rooms' equipment so the answer
    can only say what the cards say: the tags every room shares, then each
    room's own."""
    rooms = business["rooms"]
    common = [t for t in rooms[0]["equipment"] if all(t in r["equipment"] for r in rooms)]
    lower = lambda t: t if t[:1].isupper() and t[1:2].isupper() or t.startswith("Wi-Fi") else t[:1].lower() + t[1:]  # noqa: E731
    parts = []
    if common:
        parts.append("Todas as salas têm " + " e ".join(lower(t) for t in common) + ".")
    for r in rooms:
        own = [lower(t) for t in r["equipment"] if t not in common]
        if own:
            parts.append(f"{r['name']}: " + ", ".join(own) + ".")
    return " ".join(parts)


def facts(business: dict) -> dict:
    a = business["address"]
    pack = business["packs"][0]
    rail = business["transport"]["rail"]
    return {
        "audience": business["audience"],
        "email": business["email"],
        "locality": a["locality"],
        "sublocality": a["sublocality"],
        "street": a["street"],
        "postal_code": a["postal_code"],
        "opens": business["hours"]["opens"],
        "closes": business["hours"]["closes"],
        "hours_label": business["hours"]["label"],
        "hourly_min": price(business["hourly"]["min"]),
        "hourly_max": price(business["hourly"]["max"]),
        "minimum_hours": business["hourly"]["minimum_hours"],
        "pack_name": pack["name"],
        "pack_discount": pack["discount_percent"],
        "pack_validity": pack["validity"],
        "pack_validity_lower": pack["validity"][:1].lower() + pack["validity"][1:].rstrip("."),
        "cancel_hours": business["cancellation"]["hours_before"],
        "recurring_min_hours": business["recurring"]["min_hours_per_week"],
        "station": rail["station"],
        "station_distance_m": rail["distance_m"],
        "station_walk_minutes": rail["walk_minutes"],
        "included": included_text(business),
        "booking_url": business["booking"]["url"],
    }


def render_faq(faq: dict, business: dict) -> list[dict]:
    f = facts(business)
    return [{"id": item["id"], "q": item["q"].format_map(f), "a": item["a"].format_map(f)} for item in faq["items"]]


# --- index.html blocks ------------------------------------------------------

def block_head_meta(business: dict) -> str:
    og = business["og_image"]
    title, description = business["title"], business["description"]
    lines = [
        f"<title>{escape(title)}</title>",
        f'<meta name="description" content="{escape(description, quote=True)}" />',
        f'<link rel="canonical" href="{business["url"]}" />',
        '<meta name="robots" content="index, follow, max-image-preview:large" />',
        f'<meta property="og:title" content="{escape(title, quote=True)}" />',
        f'<meta property="og:description" content="{escape(description, quote=True)}" />',
        '<meta property="og:type" content="website" />',
        f'<meta property="og:url" content="{business["url"]}" />',
        f'<meta property="og:site_name" content="{escape(business["name"], quote=True)}" />',
        '<meta property="og:locale" content="pt_PT" />',
        f'<meta property="og:image" content="{absolute(business, og["src"])}" />',
        f'<meta property="og:image:width" content="{og["width"]}" />',
        f'<meta property="og:image:height" content="{og["height"]}" />',
        f'<meta property="og:image:alt" content="{escape(og["alt"], quote=True)}" />',
        '<meta name="twitter:card" content="summary_large_image" />',
        f'<meta name="twitter:title" content="{escape(title, quote=True)}" />',
        f'<meta name="twitter:description" content="{escape(description, quote=True)}" />',
        f'<meta name="twitter:image" content="{absolute(business, og["src"])}" />',
        f'<meta name="twitter:image:alt" content="{escape(og["alt"], quote=True)}" />',
    ]
    return "\n".join("  " + line for line in lines)


def block_verification(env: dict | None) -> str | None:
    """None = leave the committed block alone (no site.env.json)."""
    if env is None:
        return None
    lines = []
    if env.get("SEARCH_CONSOLE_TOKEN"):
        lines.append(f'<meta name="google-site-verification" content="{escape(env["SEARCH_CONSOLE_TOKEN"], quote=True)}" />')
    if env.get("BING_TOKEN"):
        lines.append(f'<meta name="msvalidate.01" content="{escape(env["BING_TOKEN"], quote=True)}" />')
    return "\n".join("  " + line for line in lines)


def unique(items: list) -> list:
    """Order-preserving: the three rooms share one illustration today."""
    seen: list = []
    for item in items:
        if item not in seen:
            seen.append(item)
    return seen


def postal_address(business: dict) -> dict:
    a = business["address"]
    return {
        "@type": "PostalAddress",
        "streetAddress": a["street"],
        "addressLocality": a["locality"],
        "addressRegion": a["region"],
        "postalCode": a["postal_code"],
        "addressCountry": a["country"],
    }


def jsonld_graph(business: dict, faq_items: list[dict]) -> dict:
    url = business["url"]
    org_id, biz_id, site_id = url + "#organization", url + "#business", url + "#website"
    rooms = business["rooms"]
    amenities = []
    for r in rooms:
        for tag in r["equipment"]:
            if tag not in amenities:
                amenities.append(tag)
    offers = [
        {
            "@type": "Offer",
            "name": f"{r['name']} à hora",
            "url": url + "#salas",
            "availability": "https://schema.org/InStock",
            "priceSpecification": {
                "@type": "UnitPriceSpecification",
                "price": r["price_per_hour"],
                "priceCurrency": business["currency"],
                "unitCode": "HUR",
            },
        }
        for r in rooms
    ]
    for p in business["packs"]:
        offers.append({
            "@type": "Offer",
            "name": p["name"],
            "url": url + "#precos",
            "priceCurrency": business["currency"],
            "description": (
                f"{p['hours']} horas com {p['discount_percent']}% de desconto face ao preço à hora; "
                f"validade: {p['validity'][:1].lower() + p['validity'][1:]}."
            ),
            "eligibleDuration": {"@type": "QuantitativeValue", "value": p["hours"], "unitCode": "HUR"},
        })
    organization = {
        "@type": "Organization",
        "@id": org_id,
        "name": business["name"],
        "legalName": business["legal_name"],
        "url": url,
        "logo": {"@type": "ImageObject", "url": absolute(business, business["logo"])},
        "email": business["email"],
        "address": postal_address(business),
    }
    if business["same_as"]:
        organization["sameAs"] = business["same_as"]
    local_business = {
        "@type": "LocalBusiness",
        "@id": biz_id,
        # Not a schema.org type: the Wikidata item for "coworking space".
        "additionalType": "https://www.wikidata.org/wiki/Q5146147",
        "name": business["brand_line"],
        "url": url,
        "image": unique([absolute(business, business["og_image"]["src"])] + [absolute(business, r["photo"]["src"]) for r in rooms]),
        "logo": absolute(business, business["logo"]),
        "email": business["email"],
        "address": postal_address(business),
        "geo": {"@type": "GeoCoordinates", "latitude": business["geo"]["lat"], "longitude": business["geo"]["lng"]},
        "hasMap": business["map_url"],
        "openingHoursSpecification": [{
            "@type": "OpeningHoursSpecification",
            "dayOfWeek": business["hours"]["days"],
            "opens": business["hours"]["opens"],
            "closes": business["hours"]["closes"],
        }],
        "priceRange": business["price_range"],
        "currenciesAccepted": business["currency"],
        "areaServed": [{"@type": "City", "name": c} for c in business["area_served_cities"]],
        "amenityFeature": [{"@type": "LocationFeatureSpecification", "name": t, "value": True} for t in amenities],
        "makesOffer": offers,
        "potentialAction": {
            "@type": "ReserveAction",
            "target": {
                "@type": "EntryPoint",
                "urlTemplate": business["booking"]["url"],
                "actionPlatform": ["https://schema.org/DesktopWebPlatform", "https://schema.org/MobileWebPlatform"],
                "inLanguage": business["language"],
            },
            "result": {"@type": "Reservation", "name": "Reserva de sala à hora"},
        },
        "parentOrganization": {"@id": org_id},
    }
    if business["same_as"]:
        local_business["sameAs"] = business["same_as"]
    crumbs = [("Início", url), ("Salas", url + "#salas"), ("Preços", url + "#precos"),
              ("Perguntas frequentes", url + "#faq"), ("Onde estamos", url + "#localizacao")]
    return {
        "@context": "https://schema.org",
        "@graph": [
            organization,
            local_business,
            {
                "@type": "WebSite",
                "@id": site_id,
                "url": url,
                "name": business["name"],
                "inLanguage": business["language"],
                "publisher": {"@id": org_id},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": i + 1, "name": name, "item": item}
                    for i, (name, item) in enumerate(crumbs)
                ],
            },
            {
                "@type": "FAQPage",
                "mainEntity": [
                    {"@type": "Question", "name": item["q"], "acceptedAnswer": {"@type": "Answer", "text": item["a"]}}
                    for item in faq_items
                ],
            },
        ],
    }


def block_jsonld(business: dict, faq_items: list[dict]) -> str:
    body = json.dumps(jsonld_graph(business, faq_items), ensure_ascii=False, indent=2)
    # "</" inside a <script> would end it; JSON allows the escape.
    body = body.replace("</", "<\\/")
    return '  <script type="application/ld+json">\n' + body + "\n  </script>"


def room_facts_line(room: dict) -> str:
    parts = ([f"Até {room['capacity']} pessoas"] if room.get("capacity") else []) + list(room["equipment"]) + [f"{price(room['price_per_hour'])}/hora"]
    return " · ".join(parts)


def block_rooms(business: dict) -> str:
    cards = []
    for i, r in enumerate(business["rooms"]):
        p = r["photo"]
        tags = "\n".join(f'            <li class="tag">{escape(t)}</li>' for t in r["equipment"])
        cards.append(f"""        <article class="card room-card">
          <div class="room-gallery" data-room="{r['slug']}" data-label="{escape(r['name'], quote=True)}">
            <img src="{p['src']}" width="{p['width']}" height="{p['height']}" alt="{escape(p['alt'], quote=True)}" loading="{'eager' if i == 0 else 'lazy'}" decoding="async" />
          </div>
          <div class="room-head">
            <h3>{escape(r['name'])}</h3>
            <p class="room-price">{price(r['price_per_hour'])}<small>/hora</small></p>
          </div>
          <p class="room-facts">{escape(room_facts_line(r))}</p>
          <ul class="tag-list">
{tags}
          </ul>
        </article>""")
    return "\n".join(cards)


def block_pricing(business: dict) -> str:
    h, pack, rec = business["hourly"], business["packs"][0], business["recurring"]
    return f"""        <div class="card price-card">
          <h3>À hora</h3>
          <p class="price">{price(h['min']).rstrip('€')}–{price(h['max'])}<small>/hora</small></p>
          <p class="price-desc">Conforme a sala escolhida.</p>
          <a href="#contacto" class="btn btn-outline btn-block">Reservar</a>
        </div>
        <div class="card price-card featured">
          <span class="card-badge">{escape(pack['badge'])}</span>
          <h3>{escape(pack['name'])}</h3>
          <p class="price">{pack['discount_percent']}%<small> de desconto</small></p>
          <p class="price-desc">{escape(pack['validity'])}.</p>
          <a href="#contacto" class="btn btn-primary btn-block">Reservar</a>
        </div>
        <div class="card price-card">
          <h3>Reserva recorrente</h3>
          <p class="price">{escape(rec['price_label'])}</p>
          <p class="price-desc">Negociado a partir de {rec['min_hours_per_week']} horas semanais.</p>
          <a href="#contacto" class="btn btn-outline btn-block">Falar connosco</a>
        </div>"""


def block_faq(faq_items: list[dict]) -> str:
    items = []
    for item in faq_items:
        items.append(f"""        <details class="faq-item" id="faq-{item['id']}">
          <summary>{escape(item['q'])}</summary>
          <p>{escape(item['a'])}</p>
        </details>""")
    return "\n".join(items)


def block_where(business: dict) -> str:
    a, h = business["address"], business["hours"]
    hours_text = h["label"].replace(
        f"{h['opens']}–{h['closes']}",
        f'<time datetime="{h["opens"]}">{h["opens"]}</time>–<time datetime="{h["closes"]}">{h["closes"]}</time>',
    )
    return f"""          <ul class="where-lines">
            <li class="where-line where-hours">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>{hours_text}</span>
            </li>
            <li class="where-line">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              <a href="mailto:{business['email']}">{business['email']}</a>
            </li>
            <li class="where-line">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
              <address class="where-address">
                <span>{escape(a['street'])}</span>
                <span>{escape(a['postal_code'])} {escape(a['locality'])} — {escape(a['sublocality'])}</span>
              </address>
            </li>
          </ul>
          <a
            class="btn btn-primary btn-sm where-directions"
            href="{escape(business['map_url'], quote=True)}"
            target="_blank"
            rel="noopener"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Como chegar
          </a>"""


# --- whole files ------------------------------------------------------------

AI_CRAWLERS = ["GPTBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"]


def file_robots(business: dict) -> str:
    out = [
        "# flowspace.pt — generated by scripts/render-static.py from assets/data/business.json (S1.5).",
        "# Everything is crawlable, including scripts and styles (Google renders the page).",
        "# AI crawlers are allowed on purpose: being found and cited is the point.",
        "",
        "User-agent: *",
        "Allow: /",
        "Disallow: /tests/",
        "",
    ]
    for bot in AI_CRAWLERS:
        out += [f"User-agent: {bot}", "Allow: /", ""]
    out.append(f"Sitemap: {business['url']}sitemap.xml")
    return "\n".join(out) + "\n"


def file_sitemap(business: dict) -> str:
    url = business["url"]
    photos: dict[str, dict] = {}
    for r in business["rooms"]:
        photos.setdefault(r["photo"]["src"], r)  # one entry per distinct file
    images = "".join(
        f"    <image:image>\n      <image:loc>{xml_escape(absolute(business, src))}</image:loc>\n"
        f"      <image:title>{xml_escape(r['name'])}</image:title>\n      <image:caption>{xml_escape(r['photo']['alt'])}</image:caption>\n    </image:image>\n"
        for src, r in photos.items()
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n'
        f"  <url>\n    <loc>{url}</loc>\n    <lastmod>{git_lastmod('index.html', 'assets/data')}</lastmod>\n{images}  </url>\n"
        f"  <url>\n    <loc>{url}{business['privacy_page']}</loc>\n    <lastmod>{git_lastmod(business['privacy_page'])}</lastmod>\n  </url>\n"
        "</urlset>\n"
    )


def llms_facts(business: dict) -> list[str]:
    a, h, b = business["address"], business["hours"], business["booking"]
    rooms = "; ".join(f"{r['name']} {price(r['price_per_hour'])}/hora" for r in business["rooms"])
    packs = "; ".join(f"{p['name']}: {p['discount_percent']}% de desconto face ao preço à hora, {p['validity'][:1].lower() + p['validity'][1:]}" for p in business["packs"])
    lines = [
        f"- Morada: {a['street']}, {a['postal_code']} {a['locality']} ({a['sublocality']}, {a['municipality']}), {a['country_name']} — lat {business['geo']['lat']}, lng {business['geo']['lng']}",
        f"- Horário: {h['label']}",
        f"- Email: {business['email']} (sem telefone)",
        f"- Preço à hora: {price(business['hourly']['min'])}–{price(business['hourly']['max'])}/hora conforme a sala ({rooms}); mínimo {business['hourly']['minimum_hours']} hora",
        f"- Packs: {packs}",
        f"- Reserva recorrente: {business['recurring']['price_label'].lower()}, a partir de {business['recurring']['min_hours_per_week']} horas semanais",
        f"- Cancelamento: até {business['cancellation']['hours_before']} horas antes do início; as horas pagas são creditadas no banco de horas",
        f"- Reservas: {b['url']}" + (f" — plataforma de reservas: {b['app_url']}" if b.get("app_url") else " (a plataforma de reservas online é anunciada aqui quando publicada)"),
        f"- Formato de ligação direta para uma sala e hora na plataforma: `{b['deep_link_format']}`",
    ]
    if b.get("api_url"):
        lines.append(f"- Disponibilidade legível por máquinas (OpenAPI, só leitura): {b['api_url'].rstrip('/')}{b['public_openapi_path']}")
    else:
        lines.append(f"- Disponibilidade legível por máquinas: `{b['public_openapi_path']}` na API da plataforma (OpenAPI, só leitura; o endereço é publicado com a plataforma)")
    return lines


def file_llms(business: dict) -> str:
    a = business["address"]
    url = business["url"]
    return "\n".join([
        f"# {business['brand_line']}",
        "",
        f"> Gabinetes profissionais à hora em {a['locality']} ({a['sublocality']}, {a['municipality']}, Lisboa) para {business['audience']}: "
        "salas equipadas reservadas apenas pelas horas necessárias, sem contratos nem caução, com reserva e pagamento online.",
        "",
        "## Factos",
        "",
        *llms_facts(business),
        "",
        "## Ligações",
        "",
        f"- [Perguntas frequentes]({url}#faq)",
        f"- [Salas e preços]({url}#salas)",
        f"- [Onde estamos]({url}#localizacao)",
        f"- [Política de privacidade]({url}{business['privacy_page']})",
        f"- [Versão completa para assistentes]({url}llms-full.txt)",
        "",
    ])


def file_llms_full(business: dict, faq_items: list[dict]) -> str:
    rooms = []
    for r in business["rooms"]:
        cap = f"até {r['capacity']} pessoas; " if r.get("capacity") else ""
        rooms.append(f"- {r['name']}: {cap}{', '.join(r['equipment'])}; {price(r['price_per_hour'])}/hora")
    return "\n".join([
        file_llms(business).rstrip("\n"),
        "",
        "## Salas",
        "",
        *rooms,
        "",
        "## Perguntas frequentes",
        "",
        *[f"### {item['q']}\n\n{item['a']}\n" for item in faq_items],
    ]) + "\n"


def file_security_txt(business: dict) -> str:
    return "\n".join([
        f"Contact: mailto:{business['email']}",
        f"Expires: {business['security_txt_expires']}",
        "Preferred-Languages: pt, en",
        f"Canonical: {business['url']}.well-known/security.txt",
        "",
    ])


def file_manifest(business: dict) -> str:
    return json.dumps({
        "name": business["brand_line"],
        "short_name": business["name"],
        "start_url": "/",
        "display": "browser",
        "lang": business["language"],
        "background_color": "#F9FAFB",
        "theme_color": business["theme_color"],
        "icons": [
            {"src": business["icons"]["svg"], "sizes": "any", "type": "image/svg+xml"},
            {"src": business["icons"]["png192"], "sizes": "192x192", "type": "image/png"},
            {"src": business["icons"]["png512"], "sizes": "512x512", "type": "image/png"},
        ],
    }, ensure_ascii=False, indent=2) + "\n"


# --- driver -----------------------------------------------------------------

def render_index(current: str, blocks: dict[str, str | None]) -> str:
    seen = set()

    def fill(m: re.Match) -> str:
        name = m.group("name")
        seen.add(name)
        body = blocks.get(name, m.group("body"))
        if body is None:  # a block this run must not touch
            return m.group(0)
        return f"{m.group('open')}\n{body}\n{m.group('close')}"

    out = FENCE.sub(fill, current)
    missing = set(blocks) - seen
    if missing:
        sys.exit(f"index.html is missing the generated fence(s): {', '.join(sorted(missing))}")
    return out


def outputs(business: dict, faq: dict, env: dict | None) -> dict[Path, str]:
    faq_items = render_faq(faq, business)
    blocks = {
        "head-meta": block_head_meta(business),
        "verification": block_verification(env),
        "jsonld": block_jsonld(business, faq_items),
        "rooms": block_rooms(business),
        "pricing": block_pricing(business),
        "faq": block_faq(faq_items),
        "where": block_where(business),
    }
    files = {
        INDEX: render_index(INDEX.read_text(encoding="utf-8"), blocks),
        SITE / "robots.txt": file_robots(business),
        SITE / "sitemap.xml": file_sitemap(business),
        SITE / "llms.txt": file_llms(business),
        SITE / "llms-full.txt": file_llms_full(business, faq_items),
        SITE / ".well-known" / "security.txt": file_security_txt(business),
        SITE / "site.webmanifest": file_manifest(business),
    }
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="compare only; exit 1 on any difference")
    args = parser.parse_args(argv)

    business = load_json(DATA / "business.json")
    faq = load_json(DATA / "faq.json")
    env_path = SITE / "site.env.json"
    env = load_json(env_path) if env_path.exists() else None
    files = outputs(business, faq, env)

    if args.check:
        failed = False
        for path, expected in files.items():
            actual = path.read_text(encoding="utf-8") if path.exists() else ""
            a, b = actual, expected
            if path.name == "sitemap.xml":
                a, b = LASTMOD.sub("<lastmod>…</lastmod>", a), LASTMOD.sub("<lastmod>…</lastmod>", b)
            if a != b:
                failed = True
                rel = path.relative_to(SITE)
                sys.stdout.writelines(difflib.unified_diff(
                    a.splitlines(keepends=True), b.splitlines(keepends=True),
                    fromfile=f"{rel} (committed)", tofile=f"{rel} (rendered)",
                ))
        if failed:
            print("\nThe committed files differ from what business.json/faq.json render: run scripts/render-static.py and commit.")
            return 1
        print("generated files are up to date")
        return 0

    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(f"wrote {path.relative_to(SITE)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
