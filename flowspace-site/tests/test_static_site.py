"""The static site's discoverability checks (S1.1–S1.6) — standard library only.

    python3 -m unittest flowspace-site/tests/test_static_site.py -v

Everything here reads the committed files: the generated blocks agree with
assets/data/business.json (the generator's --check), the head carries what
search engines and link previews need, the JSON-LD parses and quotes the same
facts as the page, the FAQ on the page is the FAQPage in the JSON-LD, the
crawl files are well-formed, and the page works without JavaScript (title,
h1, room photos with alt, FAQ text, address). No browser, no network.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import unittest
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
REPO = SITE.parent
BUSINESS = json.loads((SITE / "assets" / "data" / "business.json").read_text(encoding="utf-8"))
FAQ = json.loads((SITE / "assets" / "data" / "faq.json").read_text(encoding="utf-8"))
INDEX = (SITE / "index.html").read_text(encoding="utf-8")
PRIVACY = (SITE / "privacidade.html").read_text(encoding="utf-8")
URL = BUSINESS["url"]


def tags(html: str, name: str) -> list[dict[str, str | None]]:
    """Every <name …> start tag's attributes, in document order."""
    found: list[dict[str, str | None]] = []

    class P(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag == name:
                found.append(dict(attrs))

    P().feed(html)
    return found


def meta(html: str, key: str, value: str) -> str | None:
    for attrs in tags(html, "meta"):
        if attrs.get(key) == value:
            return attrs.get("content")
    return None


def text_of(html: str) -> str:
    """Visible text, whitespace collapsed (scripts and styles dropped)."""
    out: list[str] = []

    class P(HTMLParser):
        skip = 0

        def handle_starttag(self, tag, attrs):
            if tag in ("script", "style"):
                self.skip += 1

        def handle_endtag(self, tag):
            if tag in ("script", "style"):
                self.skip -= 1

        def handle_data(self, data):
            if not self.skip:
                out.append(data)

    P().feed(html)
    return re.sub(r"\s+", " ", "".join(out)).strip()


def jsonld() -> dict:
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', INDEX, re.S)
    assert m, "no JSON-LD block"
    return json.loads(m.group(1).replace("<\\/", "</"))


def by_type(graph: dict, kind: str) -> dict:
    nodes = [n for n in graph["@graph"] if n["@type"] == kind]
    assert len(nodes) == 1, f"expected exactly one {kind}, found {len(nodes)}"
    return nodes[0]


class GeneratedFilesAgreeWithTheFacts(unittest.TestCase):
    def test_the_generator_finds_nothing_to_change(self):
        # S1.1: a fact edited by hand in any rendered file, or edited in
        # business.json without regenerating, fails here.
        run = subprocess.run([sys.executable, str(SITE / "scripts" / "render-static.py"), "--check"], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_the_example_env_lists_both_tokens_and_the_real_one_is_ignored(self):
        example = json.loads((SITE / "site.env.example.json").read_text(encoding="utf-8"))
        self.assertEqual({"SEARCH_CONSOLE_TOKEN", "BING_TOKEN"}, {k for k in example if not k.startswith("_")})
        self.assertIn("flowspace-site/site.env.json", (REPO / ".gitignore").read_text(encoding="utf-8"))


class Head(unittest.TestCase):
    def test_title_fits_a_result_and_names_intent_place_and_brand(self):
        title = re.search(r"<title>(.*?)</title>", INDEX).group(1)
        self.assertEqual(title, BUSINESS["title"])
        self.assertLessEqual(len(title), 60, title)
        for word in ("Queluz", "FlowSpace", "hora"):
            self.assertIn(word, title)

    def test_description_fits_a_snippet_and_says_who_where_and_how(self):
        description = meta(INDEX, "name", "description")
        self.assertEqual(description, BUSINESS["description"])
        self.assertLessEqual(len(description), 155, description)
        for word in ("saúde e bem-estar", "à hora", "Queluz", "Massamã", "contratos", "online"):
            self.assertIn(word, description)

    def test_the_hero_h1_is_the_owners_copy_and_the_only_h1(self):
        self.assertEqual(len(tags(INDEX, "h1")), 1)
        self.assertIn("<h1>O seu espaço, <em>no seu tempo.</em></h1>", INDEX)

    def test_canonical_robots_and_the_sharing_card(self):
        canonical = [a for a in tags(INDEX, "link") if a.get("rel") == "canonical"]
        self.assertEqual([a["href"] for a in canonical], [URL])
        self.assertEqual(meta(INDEX, "name", "robots"), "index, follow, max-image-preview:large")
        og = BUSINESS["og_image"]
        self.assertEqual(meta(INDEX, "property", "og:type"), "website")
        self.assertEqual(meta(INDEX, "property", "og:url"), URL)
        self.assertEqual(meta(INDEX, "property", "og:locale"), "pt_PT")
        self.assertEqual(meta(INDEX, "property", "og:title"), BUSINESS["title"])
        self.assertEqual(meta(INDEX, "property", "og:description"), BUSINESS["description"])
        self.assertEqual(meta(INDEX, "property", "og:image"), URL + og["src"])
        self.assertEqual(meta(INDEX, "property", "og:image:width"), str(og["width"]))
        self.assertEqual(meta(INDEX, "property", "og:image:height"), str(og["height"]))
        self.assertEqual(meta(INDEX, "property", "og:image:alt"), og["alt"])
        self.assertEqual(meta(INDEX, "name", "twitter:card"), "summary_large_image")
        self.assertEqual(meta(INDEX, "name", "twitter:image"), URL + og["src"])

    def test_every_head_link_and_image_resolves_to_a_committed_file(self):
        hrefs = [a["href"] for a in tags(INDEX, "link") if a.get("rel") in ("icon", "apple-touch-icon", "manifest", "stylesheet", "preload")]
        srcs = [a["src"] for a in tags(INDEX, "img")] + [BUSINESS["og_image"]["src"], BUSINESS["logo"]]
        for ref in hrefs + srcs:
            self.assertTrue((SITE / ref).is_file(), f"{ref} is not a file in flowspace-site/")
        og = BUSINESS["og_image"]
        self.assertEqual((og["width"], og["height"]), (1200, 630))

    def test_the_privacy_page_has_its_own_canonical_and_is_not_indexed(self):
        canonical = [a["href"] for a in tags(PRIVACY, "link") if a.get("rel") == "canonical"]
        self.assertEqual(canonical, [URL + BUSINESS["privacy_page"]])
        self.assertEqual(meta(PRIVACY, "name", "robots"), "noindex, follow")
        self.assertEqual(re.search(r'<html lang="([^"]+)"', PRIVACY).group(1), "pt-PT")


class StructuredData(unittest.TestCase):
    def test_one_graph_with_the_five_nodes_and_no_ratings(self):
        graph = jsonld()
        self.assertEqual(graph["@context"], "https://schema.org")
        self.assertEqual([n["@type"] for n in graph["@graph"]], ["Organization", "LocalBusiness", "WebSite", "BreadcrumbList", "FAQPage"])
        self.assertNotIn("aggregateRating", json.dumps(graph))
        self.assertNotIn("review", json.dumps(graph).lower())
        self.assertEqual(INDEX.count('<script type="application/ld+json">'), 1)

    def test_the_local_business_quotes_business_json(self):
        biz = by_type(jsonld(), "LocalBusiness")
        a, h = BUSINESS["address"], BUSINESS["hours"]
        self.assertEqual(biz["name"], BUSINESS["brand_line"])
        self.assertEqual(biz["url"], URL)
        self.assertEqual(biz["email"], BUSINESS["email"])
        self.assertNotIn("telephone", biz)
        self.assertEqual(biz["address"], {
            "@type": "PostalAddress", "streetAddress": a["street"], "addressLocality": a["locality"],
            "addressRegion": a["region"], "postalCode": a["postal_code"], "addressCountry": a["country"],
        })
        self.assertEqual(biz["geo"], {"@type": "GeoCoordinates", "latitude": BUSINESS["geo"]["lat"], "longitude": BUSINESS["geo"]["lng"]})
        self.assertEqual(biz["hasMap"], BUSINESS["map_url"])
        [hours] = biz["openingHoursSpecification"]
        self.assertEqual((hours["dayOfWeek"], hours["opens"], hours["closes"]), (h["days"], h["opens"], h["closes"]))
        self.assertEqual(biz["priceRange"], BUSINESS["price_range"])
        self.assertEqual([c["name"] for c in biz["areaServed"]], BUSINESS["area_served_cities"])
        amenities = {f["name"] for f in biz["amenityFeature"]}
        for room in BUSINESS["rooms"]:
            self.assertTrue(set(room["equipment"]) <= amenities, room["name"])
        self.assertEqual(len(biz["image"]), len(set(biz["image"])), "each image listed once")
        self.assertTrue(all(i.startswith(URL) for i in biz["image"]))
        self.assertNotIn("sameAs", biz)  # none exist yet (S0)

    def test_offers_carry_the_published_prices_per_hour_and_the_packs(self):
        offers = by_type(jsonld(), "LocalBusiness")["makesOffer"]
        hourly = {o["name"]: o["priceSpecification"] for o in offers if "priceSpecification" in o}
        for room in BUSINESS["rooms"]:
            spec = hourly[f"{room['name']} à hora"]
            self.assertEqual((spec["price"], spec["priceCurrency"], spec["unitCode"]), (room["price_per_hour"], "EUR", "HUR"))
        packs = [o for o in offers if "eligibleDuration" in o]
        self.assertEqual([p["name"] for p in packs], [p["name"] for p in BUSINESS["packs"]])
        for offer, pack in zip(packs, BUSINESS["packs"]):
            self.assertEqual(offer["eligibleDuration"]["value"], pack["hours"])
            self.assertIn(f"{pack['discount_percent']}%", offer["description"])
            self.assertIn(pack["validity"].lower(), offer["description"].lower())

    def test_the_reserve_action_points_at_the_booking_url(self):
        action = by_type(jsonld(), "LocalBusiness")["potentialAction"]
        self.assertEqual(action["@type"], "ReserveAction")
        self.assertEqual(action["target"]["urlTemplate"], BUSINESS["booking"]["url"])
        self.assertEqual(action["result"]["@type"], "Reservation")

    def test_organization_website_and_breadcrumbs(self):
        graph = jsonld()
        org = by_type(graph, "Organization")
        self.assertEqual((org["name"], org["url"], org["email"]), (BUSINESS["name"], URL, BUSINESS["email"]))
        self.assertEqual(org["logo"], {"@type": "ImageObject", "url": URL + BUSINESS["logo"]})
        site = by_type(graph, "WebSite")
        self.assertEqual((site["url"], site["inLanguage"]), (URL, "pt-PT"))
        crumbs = by_type(graph, "BreadcrumbList")["itemListElement"]
        self.assertEqual([c["position"] for c in crumbs], list(range(1, len(crumbs) + 1)))
        for crumb in crumbs[1:]:
            anchor = crumb["item"].split("#")[1]
            self.assertIn(f'id="{anchor}"', INDEX, crumb["name"])

    def test_the_faq_page_is_the_faq_on_the_page_verbatim(self):
        questions = by_type(jsonld(), "FAQPage")["mainEntity"]
        on_page = re.findall(r"<summary>(.*?)</summary>\s*<p>(.*?)</p>", INDEX, re.S)
        self.assertEqual(len(on_page), len(questions))
        self.assertGreaterEqual(len(on_page), 8)
        self.assertLessEqual(len(on_page), 10)
        for (q, a), node in zip(on_page, questions):
            self.assertEqual(unescape(q), node["name"])
            self.assertEqual(unescape(a), node["acceptedAnswer"]["text"])
        self.assertEqual(len(questions), len(FAQ["items"]))


class ContentWithoutJavaScript(unittest.TestCase):
    def test_at_least_three_room_photos_are_real_images_with_alt_text(self):
        images = [a for a in tags(INDEX, "img") if "room-photos" in (a.get("src") or "")]
        self.assertGreaterEqual(len(images), 3)
        for img, room in zip(images, BUSINESS["rooms"]):
            self.assertEqual(img["alt"], room["photo"]["alt"])
            self.assertEqual((img["width"], img["height"]), (str(room["photo"]["width"]), str(room["photo"]["height"])))
        self.assertEqual(images[0]["loading"], "eager")
        self.assertTrue(all(i["loading"] == "lazy" for i in images[1:]))

    def test_room_cards_state_capacity_equipment_and_price_as_text(self):
        text = text_of(INDEX)
        for room in BUSINESS["rooms"]:
            parts = ([f"Até {room['capacity']} pessoas"] if room["capacity"] else []) + room["equipment"] + [f"{room['price_per_hour']}€/hora"]
            self.assertIn(" · ".join(parts), text, room["name"])

    def test_the_facts_people_search_for_are_in_the_text(self):
        text = text_of(INDEX)
        a, h = BUSINESS["address"], BUSINESS["hours"]
        self.assertIn(a["street"], text)
        self.assertIn(f"{a['postal_code']} {a['locality']} — {a['sublocality']}", text)
        self.assertIn(h["label"], text)
        self.assertIn(BUSINESS["email"], text)
        self.assertIn(f"{BUSINESS['hourly']['min']}–{BUSINESS['hourly']['max']}€/hora", text)
        for item in FAQ["items"]:
            self.assertIn(item["q"], text)

    def test_semantic_landmarks(self):
        self.assertEqual(len(tags(INDEX, "main")), 1)
        self.assertEqual(len([a for a in tags(INDEX, "nav") if a.get("aria-label")]), 1)
        self.assertIn('<a href="#main" class="skip-link">', INDEX)
        self.assertEqual(len(tags(INDEX, "address")), 1)
        self.assertEqual([t["datetime"] for t in tags(INDEX, "time")], [BUSINESS["hours"]["opens"], BUSINESS["hours"]["closes"]])
        for anchor in ("salas", "como-funciona", "precos", "faq", "localizacao", "contacto"):
            self.assertIn(f'id="{anchor}"', INDEX)
        self.assertEqual(len(re.findall(r'<section id="faq"', INDEX)), 1)
        self.assertLess(INDEX.index('id="precos"'), INDEX.index('id="faq"'))
        self.assertLess(INDEX.index('id="faq"'), INDEX.index('id="localizacao"'))
        self.assertIn('<a href="#faq">FAQ</a>', INDEX)

    def test_formal_register(self):
        self.assertNotRegex(text_of(INDEX), r"\bvocê\b", "customer-facing Portuguese never says 'você'")


class BrandInline(unittest.TestCase):
    # B51: the mark and the wordmark are inlined once as symbols from the brand
    # files and drawn by reference in the header, the hero and the watermark.
    def test_the_symbols_are_the_brand_files_drawings(self):
        for symbol, file in (("brand-mark", "logo-mark.svg"), ("brand-wordmark", "wordmark.svg")):
            svg = (SITE / "assets" / "img" / "brand" / file).read_text(encoding="utf-8")
            m = re.search(rf'<symbol id="{symbol}" viewBox="([^"]+)">(.*?)</symbol>', INDEX, re.S)
            self.assertIsNotNone(m, symbol)
            self.assertIn(f'viewBox="{m.group(1)}"', svg)
            self.assertIn(m.group(2).strip(), svg)
            self.assertIn('fill="currentColor"', m.group(2))
        self.assertEqual(INDEX.count("<symbol "), 2)

    def test_the_three_uses_have_their_sizes_and_are_decorative(self):
        uses = re.findall(r'<svg class="([^"]+)" width="(\d+)" height="(\d+)" viewBox="[^"]+" aria-hidden="true" focusable="false"><use href="#(brand-[a-z]+)"></use></svg>', INDEX)
        self.assertEqual(uses, [
            ("brand-wordmark", "103", "22", "brand-wordmark"),
            ("hero-watermark", "440", "401", "brand-mark"),
            ("hero-mark-svg", "400", "365", "brand-mark"),
        ])
        self.assertIn('<a href="#top" class="wordmark" aria-label="FlowSpace">', INDEX)
        self.assertIn('<div class="hero-mark" aria-hidden="true">', INDEX)
        # The footer keeps the white lockup from the brand set (B50).
        self.assertIn('assets/img/brand/logo-horizontal.svg#lockup', INDEX)


class CrawlFiles(unittest.TestCase):
    def test_robots_allows_everyone_including_ai_crawlers_and_hides_only_tests(self):
        robots = (SITE / "robots.txt").read_text(encoding="utf-8")
        groups = re.findall(r"User-agent: (\S+)\n((?:(?:Allow|Disallow): \S+\n)+)", robots)
        self.assertEqual(groups[0], ("*", "Allow: /\nDisallow: /tests/\n"))
        for bot in ("GPTBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"):
            self.assertIn((bot, "Allow: /\n"), groups)
        self.assertEqual(robots.count("Disallow:"), 1)
        self.assertIn(f"Sitemap: {URL}sitemap.xml", robots)

    def test_sitemap_lists_both_pages_with_lastmod_and_the_room_photos(self):
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9", "image": "http://www.google.com/schemas/sitemap-image/1.1"}
        root = ET.parse(SITE / "sitemap.xml").getroot()
        urls = root.findall("s:url", ns)
        self.assertEqual([u.find("s:loc", ns).text for u in urls], [URL, URL + BUSINESS["privacy_page"]])
        for u in urls:
            datetime.strptime(u.find("s:lastmod", ns).text, "%Y-%m-%d")
        photos = [i.find("image:loc", ns).text for i in urls[0].findall("image:image", ns)]
        self.assertEqual(photos, sorted(set(photos), key=photos.index))
        self.assertTrue(photos and all(p.startswith(URL + "assets/img/room-photos/") for p in photos))

    def test_llms_txt_carries_the_facts_and_links_the_full_version(self):
        llms = (SITE / "llms.txt").read_text(encoding="utf-8")
        full = (SITE / "llms-full.txt").read_text(encoding="utf-8")
        a = BUSINESS["address"]
        self.assertTrue(llms.startswith(f"# {BUSINESS['brand_line']}\n"))
        for needle in (a["street"], a["postal_code"], BUSINESS["hours"]["label"], BUSINESS["email"], "12€–18€/hora",
                       BUSINESS["packs"][0]["name"], "até 24 horas antes", BUSINESS["booking"]["url"],
                       BUSINESS["booking"]["deep_link_format"], BUSINESS["booking"]["public_openapi_path"],
                       f"{URL}#faq", f"{URL}{BUSINESS['privacy_page']}", f"{URL}llms-full.txt"):
            self.assertIn(needle, llms, needle)
        self.assertTrue(full.startswith(llms.rstrip("\n")))
        for item in FAQ["items"]:
            self.assertIn(f"### {item['q']}", full)
        for room in BUSINESS["rooms"]:
            self.assertIn(f"- {room['name']}:", full)

    def test_security_txt_and_the_manifest(self):
        sec = (SITE / ".well-known" / "security.txt").read_text(encoding="utf-8")
        self.assertIn(f"Contact: mailto:{BUSINESS['email']}", sec)
        expires = datetime.strptime(re.search(r"Expires: (\S+)", sec).group(1), "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
        self.assertGreater(expires, datetime.now(timezone.utc), "security.txt has expired — bump security_txt_expires")
        manifest = json.loads((SITE / "site.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["name"], BUSINESS["brand_line"])
        for icon in manifest["icons"]:
            self.assertTrue((SITE / icon["src"]).is_file(), icon["src"])

    def test_the_deploy_allowlist_publishes_the_new_files(self):
        workflow = (REPO / ".github" / "workflows" / "deploy-flowspace-site.yml").read_text(encoding="utf-8")
        optional = re.search(r'OPTIONAL_PATHS="([^"]+)"', workflow).group(1).split()
        for entry in ("robots.txt", "sitemap.xml", "llms.txt", "llms-full.txt", ".well-known", "site.webmanifest", "CNAME"):
            self.assertIn(entry, optional)


if __name__ == "__main__":
    unittest.main()
