/**
 * poller.js – Suche-Scraper für WohnungsSwipe
 *
 * Ablauf pro Job:
 *  1. Suchergebnisseite abrufen
 *  2. Alle Inserat-URLs extrahieren
 *  3. Neue URLs (nicht in DB) einzeln scrapen
 *  4. Bestehende Inserate auf offline/reserviert prüfen
 */

const fetch   = require('node-fetch');
const cheerio = require('cheerio');
const dns     = require('dns');
const http    = require('http');
const https   = require('https');
const { isIP, BlockList } = require('net');

// ── SSRF guard ───────────────────────────────────────────────
// Every URL the scraper fetches ultimately comes from a user (a listing link
// they pasted, or a search-agent URL) — so a malicious or compromised
// account could otherwise make THIS SERVER fetch anything it can reach:
// other containers/services on the same host or Docker network, the
// cloud-metadata endpoint (169.254.169.254) on a cloud VM, etc. — and in
// several cases (listings/add) the fetched page's title ends up stored and
// shown back to every user, turning it into a readable internal-network
// probe.
//
// Checking the URL once, before it's saved, isn't enough: a hostname's DNS
// can be repointed after the fact ("DNS rebinding") to resolve to an
// internal address only once the job actually runs. So the check below is
// wired into the `lookup` option of a dedicated http/https Agent, which
// Node calls to resolve the hostname at the moment it opens the TCP
// connection — i.e. on every single fetch, for whatever address the name
// resolves to right then, not just whatever it resolved to when a job was
// created.
// Built on Node's own net.BlockList rather than hand-rolled octet/prefix
// arithmetic, specifically because BlockList already does the one thing
// that's easy to get subtly wrong by hand: an IPv4-mapped IPv6 address
// ("::ffff:127.0.0.1", or its equally valid hex-compressed form
// "::ffff:7f00:1") is matched against the IPv4 rules below automatically,
// in whichever textual form it shows up as.
const blockedIps = new BlockList();
const BLOCKED_V4 = [
  ['0.0.0.0', 8],       // "this network"
  ['10.0.0.0', 8],      // RFC1918
  ['100.64.0.0', 10],   // CGNAT
  ['127.0.0.0', 8],     // loopback
  ['169.254.0.0', 16],  // link-local, incl. cloud-metadata (169.254.169.254)
  ['172.16.0.0', 12],   // RFC1918
  ['192.0.0.0', 24],    // IETF protocol assignments
  ['192.168.0.0', 16],  // RFC1918
  ['198.18.0.0', 15],   // benchmarking
  ['224.0.0.0', 4],     // multicast + reserved (224.0.0.0 - 255.255.255.255)
];
const BLOCKED_V6 = [
  ['::', 128],          // unspecified
  ['::1', 128],          // loopback
  ['fc00::', 7],         // unique local (ULA)
  ['fe80::', 10],        // link-local
  ['64:ff9b::', 96],     // NAT64 (not auto-unwrapped to IPv4 by BlockList, so blocked outright)
];
for (const [net_, prefix] of BLOCKED_V4) blockedIps.addSubnet(net_, prefix, 'ipv4');
for (const [net_, prefix] of BLOCKED_V6) blockedIps.addSubnet(net_, prefix, 'ipv6');

function isPrivateOrReservedIp(ip) {
  const fam = isIP(ip);
  if (fam !== 4 && fam !== 6) return true; // couldn't classify it – refuse rather than risk it
  return blockedIps.check(ip, fam === 4 ? 'ipv4' : 'ipv6');
}

// Cheap, synchronous pre-check (protocol + literal IP/hostname) used right
// when a URL is submitted, so the user gets an immediate, clear 400 instead
// of the request failing deep inside a background scrape. This is a
// convenience, NOT the security boundary — a hostname can still resolve to
// a private address later, which is why the real enforcement lives in the
// `lookup` function below and runs on every actual fetch.
function isUrlSyntacticallyAllowed(url) {
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  // IPv6 literals keep their brackets in URL#hostname (e.g. "[::1]"); strip
  // them before classifying, same as node-fetch does when connecting.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (isIP(host) && isPrivateOrReservedIp(host)) return false;
  return true;
}

// Resolves a hostname the same way Node would for an outgoing connection,
// but refuses to hand back an address in a private/reserved range. Passed
// as the `lookup` option of the Agents below, so it runs on every connect.
function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || isIP(addresses) }];
    const safe = list.find(a => !isPrivateOrReservedIp(a.address));
    if (!safe) return callback(new Error(`SSRF-Schutz: ${hostname} löst nur auf private/reservierte Adressen auf`));
    if (options.all) return callback(null, list.filter(a => !isPrivateOrReservedIp(a.address)));
    callback(null, safe.address, safe.family);
  });
}

const safeHttpAgent  = new http.Agent({ lookup: safeLookup, keepAlive: true });
const safeHttpsAgent = new https.Agent({ lookup: safeLookup, keepAlive: true });
const agentFor = url => (new URL(url).protocol === 'https:' ? safeHttpsAgent : safeHttpAgent);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent':      UA,
  'Accept':          'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'de-DE,de;q=0.9',
  'Cache-Control':   'no-cache',
};

// Immowelt only serializes the complete photo gallery (gallery.images) in its
// mobile webview variant of the expose page; the desktop HTML often contains
// just the first photo. scrapeListing() fetches this variant additionally.
const IMMOWELT_MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'de-DE,de;q=0.9',
  'Cache-Control': 'no-cache',
  'Cookie': 'aviv_client=ios',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Platform detection ─────────────────────────────────────
function detectPlatform(url) {
  if (url.includes('kleinanzeigen.de'))     return 'kleinanzeigen';
  if (url.includes('immobilienscout24.de')) return 'immoscout';
  if (url.includes('immowelt.de'))          return 'immowelt';
  if (url.includes('rentola.de'))           return 'rentola';
  if (url.includes('meinestadt.de'))        return 'meinestadt';
  return 'unbekannt';
}

async function fetchPage(url, timeoutMs = 18000, allowedFailCodes = []) {
  const res = await fetchPageRaw(url, timeoutMs, allowedFailCodes);
  return res.text;
}

// Like fetchPage but also returns the FINAL url after any redirects, so
// callers can detect when a listing URL silently redirected somewhere else
// (Kleinanzeigen bounces expired ads to a category/search page with HTTP
// 200 instead of returning a 404, which would otherwise look "alive").
async function fetchPageRaw(url, timeoutMs = 18000, allowedFailCodes = [], requestHeaders = HEADERS) {
  if (!isUrlSyntacticallyAllowed(url)) throw new Error('URL abgelehnt (ungültig oder zeigt auf eine private/interne Adresse)');
  const res = await fetch(url, { headers: requestHeaders, timeout: timeoutMs, agent: agentFor(url) });
  if (!res.ok && !allowedFailCodes.includes(res.status)) {
    throw new Error(`HTTP ${res.status}`);
  }
  const text = await res.text();
  // node-fetch exposes the final URL after following redirects as res.url
  return { text, finalUrl: res.url || url };
}

// ── Extract listing URLs from search results page ──────────
function extractListingUrls(html, searchUrl) {
  const $        = cheerio.load(html);
  const platform = detectPlatform(searchUrl);
  const urls     = new Set();

  if (platform === 'kleinanzeigen') {
    $('a[href*="/s-anzeige/"]').each((_, el) => {
      let href = $(el).attr('href') || '';
      if (href.startsWith('/')) href = 'https://www.kleinanzeigen.de' + href;
      if (href.startsWith('http')) urls.add(href.split('?')[0]);
    });
  } else if (platform === 'immoscout') {
    $('a[href*="/expose/"]').each((_, el) => {
      let href = $(el).attr('href') || '';
      if (href.startsWith('/')) href = 'https://www.immobilienscout24.de' + href;
      if (href.startsWith('http') && href.includes('/expose/')) urls.add(href.split('?')[0]);
    });
  } else if (platform === 'immowelt') {
    $('a[href*="/expose/"]').each((_, el) => {
      let href = $(el).attr('href') || '';
      if (href.startsWith('/')) href = 'https://www.immowelt.de' + href;
      if (href.startsWith('http') && /immowelt\.de\/expose\//i.test(href)) urls.add(href.split('?')[0]);
    });
    // Current Immowelt search pages can embed the result URLs in script/JSON
    // state without rendering <a> elements. Only used as a fallback so that
    // "similar listings" teasers embedded in the page state never get mixed
    // in when the regular result links are present.
    if (!urls.size) {
      const raw = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
      const re = /https?:\/\/(?:www\.)?immowelt\.de\/expose\/[a-z0-9-]+/gi;
      let m;
      while ((m = re.exec(raw))) urls.add(m[0].replace(/\\/g, '').split('?')[0]);
    }
  } else if (platform === 'rentola') {
    $('a[href*="/listings/"]').each((_, el) => {
      let href = $(el).attr('href') || '';
      if (href.startsWith('/')) href = 'https://rentola.de' + href;
      if (href.startsWith('http') && href.includes('/listings/')) urls.add(href.split('?')[0]);
    });
  } else if (platform === 'meinestadt') {
    $('a[href*="/expose/"]').each((_, el) => {
      let href = $(el).attr('href') || '';
      if (href.startsWith('/')) href = 'https://www.meinestadt.de' + href;
      if (href.startsWith('http') && href.includes('/expose/')) urls.add(href.split('?')[0]);
    });
  } else {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.startsWith('http') && /\/(anzeige|expose|inserat|listing|wohnung)\//.test(href))
        urls.add(href.split('?')[0]);
    });
  }

  return [...urls].slice(0, 50);
}

// ── Extract price helpers ──────────────────────────────────
function extractPrice(text)  { const m = (text||'').match(/(\d[\d.,]*)\s*€/); return m ? m[0].trim() : ''; }
function extractSize(text)   { const m = (text||'').match(/(\d[\d.,]*)\s*m[²2]/i); return m ? m[0].trim() : ''; }
function extractRooms(text)  { const m = (text||'').match(/(\d[,.]?\d*)\s*(?:zimmer|zi\.?)/i); return m ? m[1] : ''; }

function findKaltmiete($, descText) {
  let kalt = '';
  $('[class*="detail"], [class*="criteria"], [class*="attribute"], .addetailslist--detail').each((_, el) => {
    const lbl = $(el).find('[class*="label"], dt, .addetailslist--detail--label').text().toLowerCase();
    const val = $(el).find('[class*="value"], dd, span:last-child').text().trim();
    if (/kalt|netto|grundmiete/.test(lbl) && val) kalt = extractPrice(val) || val;
  });
  if (kalt) return kalt;
  for (const p of [
    /kaltmiete[:\s]+([0-9.,]+\s*€?)/i,
    /([0-9.,]+\s*€)\s*(?:kalt|kaltmiete)/i,
    /grundmiete[:\s]+([0-9.,]+\s*€?)/i,
    /nettomiete[:\s]+([0-9.,]+\s*€?)/i,
  ]) {
    const m = descText.match(p);
    if (m) return m[1].trim() + (m[1].includes('€') ? '' : ' €');
  }
  return '';
}

// ── Robust price extraction for listing pages ──────────────
// Kleinanzeigen (especially corporate/property-management listings like
// Vonovia) often show the main rent as a short standalone heading right
// under the title (e.g. "490 €") rather than inside any consistently
// class-named price element — CSS selectors for this drift often enough
// that we fall back to a structural pattern instead: any heading-ish
// element whose ENTIRE text content is just a euro amount and nothing
// else is almost certainly the listing's price.
function findStandalonePriceHeading($) {
  let found = '';
  $('h1, h2, h3, strong, b, [class*="price" i]').each((_, el) => {
    if (found) return;
    const t = $(el).text().trim();
    if (/^\d[\d.,]*\s*€$/.test(t)) found = t;
  });
  return found;
}

// Extract labeled cost/meta fields (Warmmiete, Nebenkosten, Heizkosten,
// Kaution, Wohnungstyp, Verfügbar ab) plus core facts (Wohnfläche, Zimmer,
// Schlafzimmer, Badezimmer, Etage) directly from the page's visible text.
// This sidesteps brittle CSS selectors entirely: as long as the label word
// appears somewhere near its value (true for every Kleinanzeigen layout
// variant we've observed — including newer listings that render this as a
// bare "Label Value" list with no wrapping class our old selectors knew
// about), the regex finds it regardless of markup.
function extractKleinanzeigenCostFields($, visibleText) {
  const out = {};
  const grab = (re) => { const m = visibleText.match(re); return m ? m[1].trim() : ''; };
  out.price_warm      = grab(/Warmmiete\s*([\d.,]+\s*€)/i);
  out.nebenkosten      = grab(/Nebenkosten\s*([\d.,]+\s*€)/i);
  out.heizkosten        = grab(/Heizkosten\s*([\d.,]+\s*€)/i);
  out.kaution           = grab(/Kaution(?:\s*\/\s*Genoss\.?-?Anteile)?\s*[:\s]*([\d.,]+\s*€)/i);
  // "Verfügbar ab" appears either as a numeric date ("08.09.26") or a
  // textual month + year ("September 2026") depending on listing type.
  out.available_from    = grab(/Verfügbar ab:?\s*([\d.,\/]+|[A-ZÄÖÜ][a-zäöüß]+\s+\d{4})/i);
  out.property_type     = grab(/Wohnungstyp\s+([A-ZÄÖÜ][A-Za-zäöüßÄÖÜ]+)/);
  // Core facts — fallback source for d.size/d.rooms when the old
  // selector-based extraction (which depends on specific CSS classes that
  // have proven unreliable across listing types) comes up empty.
  out.wohnflaeche        = grab(/Wohnfläche\s+([\d.,]+\s*m[²2])/i);
  out.zimmer_count       = grab(/\bZimmer\s+(\d+(?:,\d+)?)\b/);
  out.schlafzimmer       = grab(/Schlafzimmer\s+(\d+)\b/i);
  out.badezimmer         = grab(/Badezimmer\s+(\d+)\b/i);
  out.etage              = grab(/\bEtage\s+(\d+|EG|UG)\b/i);
  return out;
}

// ── Ausstattung (amenities) extraction ─────────────────────
// Kleinanzeigen renders a dedicated "Ausstattung" heading followed by a
// semicolon-separated list of real amenities. Reading FROM that heading
// is far more reliable than broad class-based selectors, which can also
// pick up unrelated page furniture: UI action buttons ("Nachricht
// schreiben", "Zur Merkliste hinzufügen") and — critically — preview
// cards from the "Andere Anzeigen des Anbieters" (other listings from
// this seller) section at the bottom of the page, which contain their
// OWN size/room/price badges that have nothing to do with this listing.
function extractKleinanzeigenAusstattung($) {
  const items = new Set();
  $('h1, h2, h3, h4, dt, strong').each((_, el) => {
    if (!/^ausstattung$/i.test($(el).text().trim())) return;
    let sib = $(el).next();
    let tries = 0;
    while (sib.length && tries < 3) {
      const txt = sib.text().trim();
      if (txt.length > 10) {
        txt.split(/[;\n]/).map(s => s.trim()).filter(Boolean).forEach(s => {
          if (s.length > 1 && s.length < 60) items.add(s);
        });
        break;
      }
      sib = sib.next();
      tries++;
    }
  });
  return [...items];
}

function collectImages($, selectors) {
  const set = new Set();
  selectors.forEach(sel => {
    $(sel).each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('content') || '';
      if (src.startsWith('http') && /\.(jpe?g|png|webp)/i.test(src) && !/logo|icon|avatar/i.test(src))
        set.add(src);
    });
  });
  return [...set];
}

// Immowelt-specific image collector. Immowelt's CDN URLs often carry no
// .jpg/.png extension and use srcset/data-imgsrc, which the generic
// collectImages() filter drops. Restricted to immowelt.de hosts so
// tracking pixels / third-party images can't leak into the gallery.
function collectImmoweltPageImages($, selectors) {
  const set = new Set();
  const add = src => {
    if (!src) return;
    src = String(src).trim().replace(/\\u0026/g, '&').replace(/\\\\\//g, '/');
    if (!/^https?:\/\/[a-z0-9.-]*immowelt\.de\//i.test(src)) return;
    if (/logo|icon|avatar|favicon|sprite/i.test(src)) return;
    set.add(src);
  };
  selectors.forEach(sel => {
    $(sel).each((_, el) => {
      const srcset = ($(el).attr('srcset') || $(el).attr('data-srcset') || '')
        .split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean);
      [$(el).attr('src'), $(el).attr('data-src'), $(el).attr('data-lazy-src'),
       $(el).attr('data-imgsrc'), $(el).attr('content'), ...srcset].forEach(add);
    });
  });
  return [...set];
}

// Extract image URLs from serialized page state. Immowelt exposes its gallery
// as an array of image objects in embedded application JSON; relying only on
// rendered <img> tags can therefore miss lazy-loaded photos.
function collectImmoweltEmbeddedImages($, html) {
  const set = new Set();

  const add = src => {
    if (!src) return;
    src = String(src).trim()
      .replace(/\\u0026/g, '&')
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/\\\\/g, '/');
    if (/^https?:\/\/mms\.immowelt\.de\//i.test(src)) set.add(src);
  };

  const walk = value => {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    for (const [key, val] of Object.entries(value)) {
      const keyLower = key.toLowerCase();

      if (keyLower === 'gallery' && val && typeof val === 'object') {
        const images = val.images;
        if (Array.isArray(images)) {
          images.forEach(img => {
            if (typeof img === 'string') add(img);
            else if (img && typeof img === 'object') {
              add(img.url);
              add(img.src);
            }
          });
        }
      }

      if (keyLower === 'imageurls' || keyLower === 'image_urls') {
        if (Array.isArray(val)) val.forEach(add);
      }

      if (keyLower === 'images' && Array.isArray(val)) {
        val.forEach(img => {
          if (typeof img === 'string') add(img);
          else if (img && typeof img === 'object') add(img.url);
        });
      }

      walk(val);
    }
  };

  const raw = String(html || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/');

  // Normal JSON script tags, including __NEXT_DATA__.
  $('script').each((_, el) => {
    const text = $(el).html() || '';
    try {
      walk(JSON.parse(text.trim()));
    } catch (_) {}
  });

  // Immowelt's detail payload is usually a JavaScript assignment containing
  // a DOUBLE-ENCODED JSON string. It is not a normal JSON script tag:
  // window["__UFRN_LIFECYCLE_SERVERREQUEST__"] = JSON.parse("...");
  const lifecycleRe =
    /window\s*\[\s*["']__UFRN_LIFECYCLE_SERVERREQUEST__["']\s*\]\s*=\s*JSON\.parse\("((?:\\.|[^"\\])*)"\)/g;

  let match;
  while ((match = lifecycleRe.exec(raw))) {
    try {
      const decodedJson = JSON.parse('"' + match[1] + '"');
      walk(JSON.parse(decodedJson));
    } catch (e) {
      console.warn('[Immowelt] UFRN-Detaildaten konnten nicht geparst werden:', e.message);
    }
  }

  // Fallback for serialized gallery objects not wrapped in the lifecycle
  // assignment.
  const galleryBlock =
    /["']gallery["']\s*:\s*\{[\s\S]*?["']images["']\s*:\s*\[([\s\S]*?)\]/gi;

  while ((match = galleryBlock.exec(raw))) {
    const chunk = match[1];
    const imageUrls =
      chunk.match(/https?:\/\/mms\.immowelt\.de\/[^"'\s<>\\]+/gi) || [];
    imageUrls.forEach(add);
  }

  return [...set];
}

// ── Strip content that belongs to OTHER listings ───────────
// Kleinanzeigen shows a "Das könnte dich auch interessieren" (related
// listings) carousel near the bottom of every ad page, and its preview
// cards use the exact same CDN domain/URL pattern for their thumbnails as
// the actual listing's own gallery photos — so a URL-pattern-based image
// collector (or any other broad scan) can't tell them apart by URL alone.
// This removes every link pointing to a DIFFERENT ad (identified by the
// numeric ad ID embedded in Kleinanzeigen's own /s-anzeige/.../<id>-...
// URL scheme) before any extraction runs, so related-listing photos,
// prices, sizes, tags etc. can never leak into the data for THIS listing —
// regardless of which specific field a future scraper change might read.
function stripOtherListingsContent($, ownUrl) {
  const ownIdMatch = (ownUrl || '').match(/(\d{6,})-\d+-\d+/);
  const ownId = ownIdMatch ? ownIdMatch[1] : null;
  if (!ownId) return;

  $('a[href*="/s-anzeige/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/(\d{6,})-\d+-\d+/);
    if (m && m[1] !== ownId) $(a).remove();
  });
}

// ── Strip the seller's own "other listings" preview widget ─
// Commercial/high-volume sellers (e.g. "Ohne Makler", property managers)
// get a profile card showing a handful of thumbnail previews from their
// OTHER active listings ("7584 Anzeigen online"), typically linking to
// their /s-bestandsliste.html overview page rather than individual
// /s-anzeige/ URLs — so stripOtherListingsContent()'s ad-ID matching
// doesn't catch these, and they still use the same CDN image pattern as
// this listing's own photos. "Anzeigen online" is a distinctive, stable
// anchor phrase for this specific widget regardless of its exact markup.
function stripSellerPreviewImages($) {
  $('*').each((_, el) => {
    const $el = $(el);
    // Only match on the element's OWN direct text content (excluding text
    // bubbled up from descendants) — otherwise .text() on broad ancestors
    // like <body> ALSO contains "Anzeigen online" somewhere in their full
    // subtree, causing the walk-up-and-remove logic below to sweep up
    // images from completely unrelated parts of the page, including the
    // listing's own real gallery.
    const ownText = $el.contents().filter((_, n) => n.type === 'text').text();
    if (!/anzeigen online/i.test(ownText)) return;

    let container = $el;
    for (let i = 0; i < 5 && container.length; i++) {
      const imgs = container.find('img[src*="kleinanzeigen.de/api/v1/prod-ads/images/"]');
      if (imgs.length) { imgs.remove(); break; }
      container = container.parent();
    }
  });
}

// ── Kleinanzeigen-specific gallery extraction ──────────────
// Kleinanzeigen's own CDN URLs don't carry a real file extension
// (e.g. ".../images/8f/8f8d6d23-...?rule=$_59.AUTO"), so the generic
// collectImages() extension filter silently drops every gallery photo
// except whichever one happens to be duplicated via the og:image meta tag.
// CSS class selectors for the gallery also tend to drift as Kleinanzeigen
// updates its markup. Instead we match directly on the stable CDN URL
// pattern (img.kleinanzeigen.de/api/v1/prod-ads/images/<id>), dedupe by
// the image's unique ID (ignoring the `rule=` size variant), and always
// request the larger "$_59" size for display quality.
function collectKleinanzeigenGalleryImages($) {
  const seen = new Map(); // imageId -> normalized large-size URL
  $('img[src*="kleinanzeigen.de/api/v1/prod-ads/images/"], img[data-src*="kleinanzeigen.de/api/v1/prod-ads/images/"], img[data-imgsrc*="kleinanzeigen.de/api/v1/prod-ads/images/"]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-imgsrc') || '';
    const match = src.match(/\/images\/([a-f0-9]+)\/([a-f0-9-]+)/i);
    if (!match) return;
    const imageId  = match[2];
    const largeUrl = src.replace(/rule=\$_\d+\.\w+/i, 'rule=$_59.AUTO');
    if (!seen.has(imageId)) seen.set(imageId, largeUrl);
  });
  return [...seen.values()];
}

// Shared real-estate amenity keywords, mined from free-text where no
// structured field exists. Word boundaries (applied at match time) prevent
// e.g. "Dachgeschoss" from matching inside the unrelated compound word
// "Dachgeschosswohnung" (seen in Kleinanzeigen's own footer navigation).
const AMENITY_KEYWORDS = [
  'Balkon','Terrasse','Garten','Keller','Aufzug','Fahrstuhl','Einbauküche','EBK',
  'Parkett','Fußbodenheizung','Altbau','Neubau','Dachgeschoss','Erdgeschoss',
  'WG-geeignet','Haustiere erlaubt','barrierefrei','möbliert','teilmöbliert',
  'Tiefgarage','Stellplatz','Garage','Photovoltaik','Fernwärme','Gasheizung',
  'Zentralheizung','Badewanne','Dusche','Wannenbad','Abstellraum','Kellerabteil',
];

// ── Extract tags/features from listing ───────────────────
function extractTags($, platform, descText) {
  const tags = new Set();

  if (platform === 'kleinanzeigen') {
    // Primary: read the real "Ausstattung" list directly (see helper above)
    // — reliably scoped to just this listing's own amenities, unlike broad
    // class selectors which also catch UI buttons and unrelated preview
    // cards from the "Andere Anzeigen des Anbieters" section.
    const ausstattung = extractKleinanzeigenAusstattung($);
    ausstattung.forEach(t => tags.add(t));
    // Deliberately NO generic DOM-selector fallback here anymore: broad
    // selectors like [class*="tag"] repeatedly proved unreliable, pulling
    // in seller trust badges ("TOP Zufriedenheit") and size/room figures
    // from unrelated listings in the "Das könnte dich auch interessieren"
    // carousel further down the page. When a listing has no proper
    // Ausstattung heading, the description-keyword mining at the end of
    // this function (scoped to this listing's own text) is the fallback —
    // fewer tags but never wrong ones.
  } else if (platform === 'immoscout') {
    $('[class*="criteriaGroup"] [class*="criteria"], [data-qa*="criterion"]').each((_, el) => {
      const lbl = $(el).find('[class*="label"]').text().trim();
      const val = $(el).find('[class*="value"]').text().trim();
      if (lbl && val && !/preis|miete|fläche|zimmer/i.test(lbl)) tags.add(`${lbl}: ${val}`);
    });
  } else if (platform === 'immowelt') {
    $('[data-test*="fact"], [class*="FactItem"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t && t.length < 50 && !/preis|miete|€/i.test(t)) tags.add(t);
    });
  } else if (platform === 'rentola') {
    $('[class*="feature"], [class*="Feature"], [class*="amenity"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 2 && t.length < 40 && !/^\d+$/.test(t) && !/[€m²]/.test(t)) tags.add(t);
    });
  } else if (platform === 'meinestadt') {
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const ausstMatch = metaDesc.match(/Ausstattung:\s*(.+?)(?:\.|$)/i);
    if (ausstMatch) {
      ausstMatch[1].split(/[,/]/).forEach(tag => {
        const t = tag.trim();
        if (t.length > 1 && t.length < 40) tags.add(t);
      });
    }
  }

  // Mine common keywords from description
  AMENITY_KEYWORDS.forEach(kw => {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(descText)) tags.add(kw);
  });

  return [...tags].slice(0, 12); // max 12 tags per listing
}

// ── Visible-text helper ────────────────────────────────────
// Cheerio's .text() includes text inside <script>/<style>/<noscript> tags.
// This is fine for normal server-rendered HTML, but JS-heavy SPA sites
// (rentola, and similar Next.js-based platforms) embed the entire app's
// state as JSON inside a <script> tag – including translation strings,
// config, and data about OTHER listings shown elsewhere on the same page.
// That embedded JSON can innocently contain phrases like "bereits vermietet"
// or "nicht mehr verfügbar" (e.g. as a status label used somewhere in the
// UI, or describing a *different* listing) that have nothing to do with
// the actual listing being scraped. We strip script/style content first so
// only genuinely rendered, visible text is used for status pattern-matching.
function getVisibleText($, selector = 'body') {
  const $clone = $(selector).clone();
  $clone.find('script, style, noscript, template').remove();
  return $clone.text();
}

// ── Paragraph-preserving text extraction ───────────────────
// Cheerio's plain .text() concatenates every text node with no separator
// between block-level elements, so a description with clear paragraphs in
// the source HTML (<p>...</p><p>...</p> or lines separated by <br>) comes
// out as one unbroken wall of text. We insert explicit newlines at block
// boundaries BEFORE reading the text, so the paragraph structure a reader
// actually sees on the original page survives into our stored description.
function extractTextWithParagraphs($, el) {
  if (!el || !el.length) return '';
  const $clone = el.clone();
  $clone.find('br').replaceWith('\n');
  $clone.find('p, div, li').each((_, block) => { $(block).append('\n\n'); });
  let text = $clone.text();

  // Some listings (seen on professional/property-management accounts)
  // ship their description with literal "<br />"-style characters baked
  // in as plain TEXT rather than as real <br> DOM elements — likely from
  // pasting a rich-text template into a plaintext-only field. Real <br>
  // tags are already converted above; this catches the literal-text case
  // too, so paragraphs still come through instead of showing as raw
  // "&lt;br /&gt;" once the page escapes them for safe HTML display.
  text = text.replace(/<br\s*\/?>/gi, '\n');

  text = text.replace(/[ \t]+\n/g, '\n');   // trim trailing spaces before a break
  text = text.replace(/\n{3,}/g, '\n\n');   // collapse 3+ blank lines to exactly one
  return text.split('\n').map(l => l.trimEnd()).join('\n').trim();
}

// ── Check if listing is offline or reserved ───────────────
// Kleinanzeigen is decided by its own structural signals only. The generic
// body-text patterns below ("anzeige … nicht … vorhanden", "vergeben", …) use
// `.*` across the whole page text and match footer/sidebar/description
// wording on perfectly active ads, which flagged every ad as offline.
// Unknown (e.g. a bot-check page without the ad markup) counts as active:
// a wrong "offline" archives a live ad for everyone, a missed one is
// corrected on the next check by the site's own signals.
function checkKleinanzeigenStatus($, why = {}) {
  const title = $('title').text().toLowerCase();
  // The h1 carries data-soldlabel on EVERY ad ("Nicht mehr verfügbar" on
  // offers, "Gefunden" on wanted ads) — it is only the label text Kleinanzeigen
  // would show, not a status. The real signal is the visible status prefix
  // inside the h1 ("Gelöscht • …", "Reserviert • …"), which only exists on
  // deleted/reserved/sold ads.
  const $h1 = $('h1#viewad-title');
  const STATUS_WORD = /^(gelöscht|reserviert|verkauft|vergeben|gefunden|nicht mehr verfügbar|abgelaufen)\b/i;
  let prefix = ($h1.find('.text-onSurfaceNonessential').first().text() || '').replace(/[•·\s]+$/g, '').trim();
  if (!STATUS_WORD.test(prefix)) {
    const m = $h1.text().trim().match(/^(gelöscht|reserviert|verkauft|vergeben|gefunden|nicht mehr verfügbar|abgelaufen)\s*[•·]/i);
    prefix = m ? m[1] : '';
  }
  if (prefix) { why.reason = `Status-Präfix im Titel: "${prefix}"`; return /reserv/i.test(prefix) ? 'reserved' : 'offline'; }
  // The page's own JS config states it explicitly: `adExpired:false` on live ads.
  const expiredFlag = $('script').toArray().some(el => /adExpired\s*:\s*true/.test($(el).html() || ''));
  if (expiredFlag) { why.reason = 'adExpired:true im Seiten-Skript'; return 'offline'; }
  if ($('.adexpired, [data-testid="adexpired"]').length) { why.reason = 'adexpired-Marker'; return 'offline'; }
  if ($('[data-testid="reserved-badge"], .reserved-badge').length) { why.reason = 'reserved-Badge'; return 'reserved'; }
  if ($('h1#viewad-title').length) return 'active';
  if (/404|not found|seite nicht gefunden|anzeige.*(nicht mehr|gelöscht|nicht vorhanden)/i.test(title)) { why.reason = `Seitentitel "${title.slice(0, 80)}"`; return 'offline'; }
  return 'active';
}

function checkListingStatus($, platform, why = {}) {
  if (platform === 'kleinanzeigen') return checkKleinanzeigenStatus($, why);
  const bodyText = getVisibleText($, 'body').toLowerCase();
  const title    = $('title').text().toLowerCase();

  // Common offline indicators
  const offlinePatterns = [
    /nicht mehr aktiv/i, /anzeige.*nicht.*vorhanden/i, /bereits.*verkauft/i,
    /bereits.*vermietet/i, /diese anzeige.*existiert nicht/i,
    /anzeige.*gelöscht/i, /not found/i, /leider nicht mehr/i,
    /nicht mehr verfügbar/i, /angebot.*abgelaufen/i,
  ];
  // Only match 404/not-found in the page title, not in the body
  // (many active sites mention "not found" in navigation or error helpers)
  const titleOfflinePatterns = [/404/i, /not found/i, /seite nicht gefunden/i];

  for (const p of offlinePatterns) {
    if (p.test(bodyText) || p.test(title)) return 'offline';
  }
  for (const p of titleOfflinePatterns) {
    if (p.test(title)) return 'offline';
  }

  // Reserved indicators
  const reservedPatterns = [
    /reserviert/i, /vergeben/i, /bereits reserviert/i, /option.*genommen/i,
  ];
  for (const p of reservedPatterns) {
    if (p.test(bodyText)) return 'reserved';
  }

  // Platform-specific
  if (platform === 'immoscout') {
    if ($('[data-qa="expose-offline"], .expose--inactive').length) return 'offline';
  }
  // rentola/meinestadt: no DOM-based checks (they're SPAs, real content loads
  // client-side), but the generic text-pattern checks above now work reliably
  // for them too, since script/style content no longer pollutes bodyText.

  return 'active';
}

// ── Geocoding fallback ──────────────────────────────────────
// Not every platform embeds real coordinates like Kleinanzeigen does (e.g.
// rentola only gives us a free-text address). For those, we ask
// OpenStreetMap's free Nominatim geocoder to resolve the address to
// lat/lng, so the detail view can still show a real embedded map instead
// of just a text link. This runs at most once per newly-scraped listing,
// well within Nominatim's usage policy (max ~1 req/s, identify via
// User-Agent) since scraping already spaces out requests between listings.
async function geocodeLocation(locationText) {
  if (!locationText || !locationText.trim()) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(locationText.trim())}`,
      { headers: { 'User-Agent': 'WohnungsSwipe/1.0 (self-hosted apartment search tool)' }, timeout: 8000 }
    );
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;
    const lat = parseFloat(results[0].lat);
    const lon = parseFloat(results[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch (e) {
    console.warn(`[Geocode] Fehler für "${locationText}": ${e.message}`);
    return null;
  }
}

// ── Scrape a single listing ───────────────────────────────
// opts.lite: skip the extra Immowelt mobile request (used by the periodic
// status re-check, which only needs status/price/title — not the full gallery).
async function scrapeListing(url, opts = {}) {
  const platform = detectPlatform(url);
  const d = {
    url, platform,
    title: '', price: '', price_cold: '', size: '', location: '',
    rooms: '', image_url: '', images_json: '[]', description: '',
    tags_json: '[]', status: 'active',
    nebenkosten: '', heizkosten: '', kaution: '', available_from: '', property_type: '',
    latitude: null, longitude: null,
  };

  let html;
  let finalUrl = url;
  try {
    // For SPA platforms, allow 403 responses – they still contain meta tags in the HTML
    const allowedCodes = (platform === 'rentola' || platform === 'meinestadt') ? [403] : [];
    const raw = await fetchPageRaw(url, 18000, allowedCodes);
    html = raw.text;
    finalUrl = raw.finalUrl;
  }
  catch (e) {
    // HTTP 404 / 410 = definitely offline; 403 for non-SPA = likely offline.
    // Kleinanzeigen answers bot traffic with 403/429 on live ads too, so there
    // only 404/410 count.
    const gone = e.message.includes('404') || e.message.includes('410');
    const blocked = e.message.includes('403') && platform !== 'kleinanzeigen';
    if (gone || blocked) d.status = 'offline';
    d.fetchFailed = true;
    d.title = 'Inserat (nicht ladbar)';
    d.description = `Fehler: ${e.message}`;
    return d;
  }

  // Expired-listing redirect check: Kleinanzeigen (and similar sites) don't
  // always 404 a removed ad — they quietly 200-redirect it to a category or
  // search-results page. We started at a specific /s-anzeige/…/<id> listing
  // URL; if the final URL after redirects is no longer an /s-anzeige/ page
  // (or points at a *different* ad id), the original ad is gone → offline.
  if (platform === 'kleinanzeigen') {
    const startedOnListing = /\/s-anzeige\//.test(url);
    const idMatch = url.match(/(\d{6,})-\d+-\d+/);
    const startId = idMatch ? idMatch[1] : null;
    let finalPath = finalUrl;
    try { finalPath = new URL(finalUrl).pathname; } catch (_) {}
    // Only a redirect to a category/search page or the start page means the ad
    // is gone; a redirect to e.g. a consent or bot-check page says nothing.
    const wentToSearch = /^\/s-(?!anzeige\/)/.test(finalPath) || finalPath === '/';
    const finalIdMatch = finalUrl.match(/(\d{6,})-\d+-\d+/);
    const finalId = finalIdMatch ? finalIdMatch[1] : null;
    const otherAd = /\/s-anzeige\//.test(finalPath) && startId && finalId && startId !== finalId;
    if (startedOnListing && (wentToSearch || otherAd)) {
      d.status = 'offline';
      console.log(`[Status] ${url} → offline (Weiterleitung auf ${finalUrl})`);
      d.title = d.title || 'Inserat nicht mehr verfügbar';
      d.description = `Anzeige nicht mehr verfügbar (weitergeleitet zu ${finalUrl})`;
      return d;
    }
  }

  const $ = cheerio.load(html);

  // Immowelt: additionally load the mobile webview variant of the expose,
  // which contains the complete serialized gallery (see IMMOWELT_MOBILE_HEADERS).
  // Best-effort: a failure here just means we fall back to the desktop HTML.
  let immoweltMobileHtml = '';
  let immoweltMobile$ = null;
  if (platform === 'immowelt' && !opts.lite) {
    try {
      const mobileUrl = new URL(url);
      mobileUrl.searchParams.set('app', '1');
      const mobileRaw = await fetchPageRaw(mobileUrl.toString(), 22000, [403], IMMOWELT_MOBILE_HEADERS);
      if (mobileRaw.text && mobileRaw.text.length > 1000) {
        immoweltMobileHtml = mobileRaw.text;
        immoweltMobile$ = cheerio.load(immoweltMobileHtml);
      }
    } catch (e) {
      console.warn(`[Immowelt] Mobile-Detail fehlgeschlagen für ${url}: ${e.message}`);
    }
  }

  // Remove any content belonging to OTHER listings (e.g. the "Das könnte
  // dich auch interessieren" carousel) before extracting anything at all,
  // so it can never bleed into this listing's images, tags, or any other
  // field — regardless of which specific selector might otherwise match it.
  if (platform === 'kleinanzeigen') {
    stripOtherListingsContent($, url);
    stripSellerPreviewImages($);
  }
  const why = {};
  d.status = checkListingStatus($, platform, why);
  if (platform === 'kleinanzeigen' && d.status !== 'active') {
    console.log(`[Status] ${url} → ${d.status} (${why.reason || 'unbekannt'})`);
  }

  if (platform === 'kleinanzeigen') {
    // Extra at-a-glance facts (Schlafzimmer/Badezimmer/Etage) that don't
    // have dedicated DB columns get surfaced as tags instead — collected
    // below, merged into the final tag list further down.
    var extraFactTags = [];

    // Exclude the "Gelöscht • " / "Reserviert • " status-prefix span from the
    // title text — it's the same signal already captured in d.status above
    // (via data-soldlabel), so baking it into the title too would just
    // duplicate it there as ugly, redundant text ("Gelöscht • 3 Zimmer...").
    const $titleEl = $('h1#viewad-title').length ? $('h1#viewad-title') : $('h1').first();
    const $titleClone = $titleEl.clone();
    $titleClone.find('.text-onSurfaceNonessential').remove();
    d.title = $titleClone.text().trim();

    // Location: take only the FIRST match. Kleinanzeigen frequently renders
    // a duplicate (mobile+desktop) copy of the same location text elsewhere
    // on the page; concatenating every match produces a doubled string like
    // "28237 Gröpelingen – Gröpelingen28237 Gröpelingen – Gröpelingen".
    let loc = $('#viewad-locality').first().text().trim() || $('[data-testid="listing-location"]').first().text().trim();
    // Defensive dedup: collapse "XY" into "X" whenever the string is
    // literally two back-to-back copies of the same text, regardless of cause.
    if (loc.length % 2 === 0) {
      const half = loc.length / 2;
      if (loc.slice(0, half) === loc.slice(half)) loc = loc.slice(0, half);
    }
    d.location = loc;

    // Preserve paragraph breaks from the source page instead of collapsing
    // the whole description into one unbroken wall of text.
    const descEl = $('#viewad-description-text').length
      ? $('#viewad-description-text')
      : $('[data-testid="description"]');
    d.description = extractTextWithParagraphs($, descEl).substring(0, 3000);

    $('#viewad-details .addetailslist--detail').each((_, el) => {
      const lbl = $(el).find('.addetailslist--detail--label').text().toLowerCase();
      const val = $(el).find('span:last-child').text().trim();
      if (/zimmer/.test(lbl))           d.rooms      = val;
      if (/fläche|größe/.test(lbl))     d.size       = val;
      if (/kalt|netto|grund/.test(lbl)) d.price_cold = extractPrice(val) || val;
    });

    // Additional structured fields (Warmmiete, Nebenkosten, Heizkosten,
    // Kaution, Wohnungstyp, Verfügbar ab, Wohnfläche, Zimmer, Schlafzimmer,
    // Badezimmer, Etage) — text-pattern based, so they survive markup
    // changes the same way the price fallback below does. This is also the
    // ONLY source for newer listing layouts that render facts as a bare
    // "Label Value" list with no class our old selector-based approach knew
    // to look for (which is why d.size/d.rooms were sometimes ending up
    // completely empty despite the data clearly being on the page).
    const visibleBody = getVisibleText($, 'body');
    const costFields   = extractKleinanzeigenCostFields($, visibleBody);
    Object.assign(d, {
      nebenkosten:    costFields.nebenkosten,
      heizkosten:     costFields.heizkosten,
      kaution:        costFields.kaution,
      available_from: costFields.available_from,
      property_type:  costFields.property_type,
    });
    if (!d.size)  d.size  = costFields.wohnflaeche;
    if (!d.rooms) d.rooms = costFields.zimmer_count;

    // Schlafzimmer/Badezimmer/Etage don't have dedicated DB columns, but
    // they're useful at-a-glance facts, so surface them as extra tags.
    if (costFields.schlafzimmer) extraFactTags.push(`${costFields.schlafzimmer} Schlafzimmer`);
    if (costFields.badezimmer)   extraFactTags.push(`${costFields.badezimmer} Badezimmer`);
    if (costFields.etage)        extraFactTags.push(`Etage ${costFields.etage}`);

    // Some listings show their amenities as a bare, unlabeled list (no
    // "Ausstattung" heading at all — just "Balkon / Terrasse / Einbauküche"
    // sitting right after the cost figures), which extractKleinanzeigenAusstattung()
    // can't find since it specifically looks for that heading. As a safety
    // net, scan the already-cleaned page text (other listings already
    // stripped above) for the same amenity keywords used elsewhere — word
    // boundaries keep this safe from Kleinanzeigen's own footer category
    // links ("Dachgeschosswohnung in Gröpelingen" etc. don't match
    // "Dachgeschoss" as a whole word).
    AMENITY_KEYWORDS.forEach(kw => {
      if (new RegExp(`\\b${kw}\\b`, 'i').test(visibleBody)) extraFactTags.push(kw);
    });

    // price_cold: prefer the addetailslist label match above; otherwise the
    // standalone price heading (common on corporate/property-management
    // listings that show the base rent as a bare "490 €" under the title
    // rather than in any consistently labeled element); otherwise the
    // legacy description-text pattern fallback.
    if (!d.price_cold) d.price_cold = findStandalonePriceHeading($) || findKaltmiete($, d.description);

    // price (rendered as the "warm" figure whenever it differs from
    // price_cold): prefer an explicit Warmmiete match; else fall back to
    // the classic selector-based price extraction (still valid for
    // simpler/older private listings); else mirror price_cold so at least
    // one figure is always shown instead of "Preis nicht angegeben".
    d.price = costFields.price_warm
           || extractPrice($('[data-testid="price"]').text() || $('.priceintro').text() || $('strong.price-big').text())
           || d.price_cold;

    // Primary: match Kleinanzeigen's stable CDN URL pattern directly (robust
    // against markup/class-name changes and doesn't get filtered out by
    // extension checks, since these URLs carry no real file extension).
    let imgs = collectKleinanzeigenGalleryImages($);
    if (!imgs.length) {
      // Fallback to the old selector-based approach in case the CDN pattern changes
      imgs = collectImages($, ['#viewad-image img', '.galleryimage-element img', '[class*="gallery"] img']);
    }
    const og = $('meta[property="og:image"]').attr('content') || '';
    if (og && !imgs.some(u => u.includes(og.split('?')[0]))) imgs.unshift(og);
    d.images_json = JSON.stringify([...new Set(imgs)]);
    d.image_url   = imgs[0] || '';
  }
  else if (platform === 'immoscout') {
    d.title       = $('h1').first().text().trim();
    d.price       = extractPrice($('[data-is24-qa="price"]').text() || $('[class*="price"]').first().text());
    d.location    = $('[data-is24-qa="expose-address"]').text().trim() || $('[class*="address"]').first().text().trim();
    d.description = $('[data-is24-qa="description"]').text().trim().substring(0, 800);
    $('[class*="criteriaGroup"] [class*="criteria"], [class*="attribute"]').each((_, el) => {
      const lbl = $(el).find('[class*="label"]').text().toLowerCase();
      const val = $(el).find('[class*="value"]').text().trim();
      if (/zimmer/.test(lbl))    d.rooms      = val;
      if (/fläche/.test(lbl))    d.size       = val;
      if (/kaltmiete/.test(lbl)) d.price_cold = val;
    });
    if (!d.price_cold) d.price_cold = findKaltmiete($, d.description);
    const imgs = collectImages($, ['[data-qa="galleryImage"] img', '[class*="gallery"] img', '[class*="Gallery"] img']);
    d.images_json = JSON.stringify(imgs);
    d.image_url   = imgs[0] || $('meta[property="og:image"]').attr('content') || '';
  }
  else if (platform === 'immowelt') {
    // Immowelt's current HTML contains a lot of repeated/hidden metadata in
    // the H1 subtree. Prefer the actual short heading and clean any metadata
    // that accidentally got concatenated into it.
    const rawH1    = $('h1').first().text().replace(/\s+/g, ' ').trim();
    const ogTitle  = $('meta[property="og:title"]').attr('content') || '';
    const pageTitle = $('title').text().replace(/\s+/g, ' ').trim();

    let cleanTitle = rawH1 || ogTitle || pageTitle || 'Wohnung zur Miete';
    // If the selected heading contains the price/metadata block, keep only
    // the actual property headline before the first euro amount.
    cleanTitle = cleanTitle.split(/\d[\d.,]*\s*€/)[0].trim();
    cleanTitle = cleanTitle
      .replace(/\s*(?:SCHUFA-Bonitätscheck|geschätzte Warmmiete|Kaltmiete|Warmmiete).*$/i, '')
      .trim();
    d.title = cleanTitle || 'Wohnung zur Miete';

    d.price = extractPrice($('[class*="AdvertPrice"]').text() || $('.price').first().text());
    $('[data-test*="fact"], [class*="FactItem"]').each((_, el) => {
      const lbl = $(el).text().toLowerCase();
      const val = $(el).find('[class*="value"], strong, b').text().trim() || $(el).text().trim();
      if (/zimmer/.test(lbl))    d.rooms      = extractRooms(lbl) || extractRooms(val) || val;
      if (/fläche/.test(lbl))    d.size       = extractSize(lbl)  || extractSize(val) || val;
      if (/kaltmiete/.test(lbl)) d.price_cold = extractPrice(val) || val;
    });

    // Address/location appears as a dedicated address block on current
    // Immowelt exposes. Keep it separate from the noisy title metadata.
    d.location = $('[data-test*="address"], [data-testid*="address"], [class*="Address"], [class*="address"], [class*="Location"], [class*="location"]')
      .first().text().replace(/\s+/g, ' ').trim();

    const bodyText = getVisibleText($, 'body').replace(/\s+/g, ' ');
    if (!d.rooms) d.rooms = extractRooms(bodyText);
    if (!d.size)  d.size  = extractSize(bodyText);

    if (!d.price_cold) d.price_cold = findKaltmiete($, bodyText.substring(0, 5000));
    if (!d.price) d.price = extractPrice($('[class*="Warmmiete"], [class*="warmmiete"]').text()) || d.price_cold;

    // Make the title useful in the app without copying Immowelt's complete
    // metadata string into it.
    const titleParts = [];
    if (d.rooms) titleParts.push(d.rooms + ' Zimmer');
    if (d.size)  titleParts.push(d.size);
    if (titleParts.length) d.title += ' – ' + titleParts.join(' · ');

    const immoweltSelectors = [
      '[class*="Gallery"] img',
      '[class*="gallery"] img',
      '[class*="Slider"] img',
      '[class*="slider"] img',
      'img[src*="mms.immowelt.de"]',
      'img[data-src*="mms.immowelt.de"]',
      'img[data-lazy-src*="mms.immowelt.de"]'
    ];

    const imageCandidates = [
      ...collectImmoweltPageImages($, immoweltSelectors),
      ...collectImmoweltEmbeddedImages($, html),
    ];

    // Merge the complete gallery from the direct listing page's mobile
    // representation as well. Immowelt exposes the image objects under
    // gallery.images in this variant even when desktop HTML contains only
    // the first visible photo.
    if (immoweltMobile$) {
      imageCandidates.push(
        ...collectImmoweltPageImages(immoweltMobile$, immoweltSelectors),
        ...collectImmoweltEmbeddedImages(immoweltMobile$, immoweltMobileHtml)
      );
    }

    const og = $('meta[property="og:image"]').attr('content') || '';
    if (og && /mms\.immowelt\.de/i.test(og)) imageCandidates.unshift(og);

    const uniqueImgs = [...new Set(imageCandidates)];
    d.images_json = JSON.stringify(uniqueImgs);
    d.image_url   = uniqueImgs[0] || og;
  }
  else if (platform === 'rentola') {
    // Rentola is a Next.js SPA – most content is client-rendered.
    // The server delivers reliable data only via meta tags and the page title.
    // Example title: "Wohnung (61.0 m²) zur Miete in Bremen (Alte Neustadt, Bremen, Germany) - rentola.de"
    // Example meta-description: "Jetzt verfügbar: 61.0 m² Wohnung zur Langzeitmiete in Alte Neustadt, Bremen, Germany. Mietpreis: 452 €."
    const ogTitle   = $('meta[property="og:title"]').attr('content') || '';
    const pageTitle = $('title').text();
    const metaDesc  = $('meta[name="description"]').attr('content') || '';

    // Title: prefer h1 if rendered, fall back to og:title → page title
    d.title = $('h1').first().text().trim() || ogTitle || pageTitle.replace(/ - rentola\.de$/i, '').trim();

    // Rooms from og:title or page title: "3 Zimmer Wohnung mit 61m²"
    d.rooms = extractRooms(ogTitle) || extractRooms(pageTitle) || extractRooms(metaDesc);

    // Size from og:title, page title, or meta description
    d.size  = extractSize(ogTitle) || extractSize(pageTitle) || extractSize(metaDesc);

    // Price from meta description: "Mietpreis: 452 €"
    const priceMatch = metaDesc.match(/Mietpreis:\s*(\d[\d.,]*\s*€)/i) ||
                       metaDesc.match(/(\d[\d.,]*)\s*€/);
    d.price      = priceMatch ? priceMatch[1].trim() : extractPrice(metaDesc);
    d.price_cold = d.price; // rentola shows Kaltmiete directly

    // Location from meta description: "in Alte Neustadt, Bremen, Germany"
    // Strip the English country name at the end
    const locMatch = metaDesc.match(/in\s+([^.]+,\s*[^.]+?)(?:\.|Mietpreis|$)/i) ||
                     pageTitle.match(/in\s+([^(]+)\s*\(/i);
    if (locMatch) {
      d.location = locMatch[1].trim()
        .replace(/,?\s*(Germany|Deutschland|Austria|Österreich|Switzerland|Schweiz)\s*$/i, '')
        .trim();
    }

    // Description from meta description (remove price sentence at end)
    d.description = metaDesc.replace(/Kontaktiere den Vermieter.*$/i, '').trim().substring(0, 800);

    // Images: server-rendered img tags with rentola CDN
    const imgs = collectImages($, [
      'img[src*="img2.rentola.com"]',
      'img[src*="rentola"]',
      '[class*="gallery"] img',
      '[class*="slider"] img',
    ]);
    const ogImg = $('meta[property="og:image"]').attr('content') || '';
    if (ogImg && !imgs.includes(ogImg)) imgs.unshift(ogImg);
    d.images_json = JSON.stringify([...new Set(imgs)]);
    d.image_url   = imgs[0] || '';
  }
  else if (platform === 'meinestadt') {
    // meinestadt exposes often have data in the page title: "3 Zimmer - 68 m² - 559 € Kaltmiete"
    const pageTitle = $('title').text();
    const titleMatch = pageTitle.match(/^(.+?)\s*\|\s*/);
    d.title = $('h1').first().text().trim() ||
              $('meta[property="og:title"]').attr('content') || pageTitle;

    // Extract from title string: "3 Zimmer - 68 m² - 559 € Kaltmiete"
    d.rooms      = extractRooms(pageTitle) || extractRooms($('meta[property="og:title"]').attr('content') || '');
    d.size       = extractSize(pageTitle)  || extractSize($('meta[property="og:title"]').attr('content') || '');
    d.price_cold = extractPrice(pageTitle) || extractPrice($('[class*="price"], [class*="kalt"]').text());
    d.price      = d.price_cold || extractPrice($('[class*="price"]').first().text());

    // Location from meta description or address fields
    d.location   = $('[class*="address"], [class*="location"]').first().text().trim() ||
                   ($('meta[name="description"]').attr('content') || '').split(' in ').pop()?.split('.')[0] || '';
    // Description from meta
    d.description = $('meta[name="description"]').attr('content')?.substring(0, 800) || '';

    // Features from meta description (e.g. "Balkon / Terrasse, Keller, ...")
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const ausstMatch = metaDesc.match(/Ausstattung:\s*(.+?)(?:\.|$)/);
    if (ausstMatch) {
      ausstMatch[1].split(',').forEach(tag => {
        const t = tag.trim();
        if (t) d.description += (d.description ? '\n' : '') + t;
      });
    }

    // Images
    const ogImg = $('meta[property="og:image"]').attr('content') || '';
    const imgs  = collectImages($, ['[class*="gallery"] img', '[class*="image"] img', 'img[src*="image-service"]']);
    if (ogImg) imgs.unshift(ogImg);
    d.images_json = JSON.stringify([...new Set(imgs)]);
    d.image_url   = imgs[0] || ogImg;

    // meinestadt shows "Immobilie nicht mehr verfügbar" for expired listings
    const visibleBody = getVisibleText($, 'body');
    if (visibleBody.includes('nicht mehr verfügbar') ||
        visibleBody.includes('bereits vergeben')) {
      d.status = 'offline';
    }
  }

  // OpenGraph fallbacks
  if (!d.title)       d.title       = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || 'Inserat';
  if (!d.description) d.description = ($('meta[property="og:description"]').attr('content') || '').substring(0, 800);
  if (!d.image_url)   d.image_url   = $('meta[property="og:image"]').attr('content') || '';
  if (d.images_json === '[]' && d.image_url) d.images_json = JSON.stringify([d.image_url]);

  // Real coordinates — Kleinanzeigen (and some other listing sites) embed
  // exact latitude/longitude as standard Open Graph meta tags. When present,
  // this lets the detail view show a genuine embedded map instead of only a
  // "open in maps app" link built from a fuzzy address string.
  const ogLat = parseFloat($('meta[property="og:latitude"]').attr('content'));
  const ogLng = parseFloat($('meta[property="og:longitude"]').attr('content'));
  if (Number.isFinite(ogLat) && Number.isFinite(ogLng)) {
    d.latitude  = ogLat;
    d.longitude = ogLng;
  }

  // Fallback: platforms without native coordinates (e.g. rentola) still
  // usually give us a text address — geocode that via Nominatim so the
  // map embed works there too, not just on Kleinanzeigen.
  if (!Number.isFinite(d.latitude) && d.location?.trim()) {
    const geo = await geocodeLocation(d.location);
    if (geo) { d.latitude = geo.lat; d.longitude = geo.lon; }
  }

  // Tags
  const baseTags = extractTags($, platform, d.description);
  const allTags  = [...new Set([...(typeof extraFactTags !== 'undefined' ? extraFactTags : []), ...baseTags])];
  d.tags_json = JSON.stringify(allTags.slice(0, 12));

  return d;
}

// ── Check existing listings for offline/reserved status AND changes ──
// Beyond the offline/reserved status flip, this also re-scrapes each
// listing fully so title/price/size/rooms changes get caught too (a
// landlord editing the title, dropping the price, or a listing quietly
// getting reserved without the page's status text saying so explicitly).
async function checkExistingListings(listings, onStatusChange, onFieldChange) {
  const results = { offline: 0, reserved: 0, changed: 0 };
  const TRACKED_FIELDS = ['title', 'price', 'price_cold', 'size', 'rooms'];

  for (const listing of listings) {
    try {
      const fresh = await scrapeListing(listing.url, { lite: true });

      if (fresh.status && fresh.status !== 'active') {
        onStatusChange(listing.id, fresh.status);
        results[fresh.status] = (results[fresh.status] || 0) + 1;
      }

      if (onFieldChange && !fresh.fetchFailed) {
        const changes = [];
        for (const field of TRACKED_FIELDS) {
          const oldVal = (listing[field] || '').trim();
          const newVal = (fresh[field]  || '').trim();
          if (newVal && oldVal !== newVal) changes.push({ field, oldVal, newVal });
        }
        if (changes.length) {
          onFieldChange(listing.id, changes, fresh);
          results.changed++;
        }
      }

      await sleep(1500 + Math.random() * 1500);
    } catch (e) {
      console.warn(`[Poller] Status-check Fehler für ${listing.url}: ${e.message}`);
    }
  }
  return results;
}

// ── Main export – poll one search job ─────────────────────
async function pollSearchJob(job, exists, insert) {
  let searchHtml;
  try { searchHtml = await fetchPage(job.search_url, 20000); }
  catch (e) { throw new Error(`Suchseite nicht erreichbar: ${e.message}`); }

  const urls = extractListingUrls(searchHtml, job.search_url);
  if (!urls.length) {
    const lc = searchHtml.toLowerCase();
    if (lc.includes('captcha') || lc.includes('robot'))
      throw new Error('CAPTCHA erkannt – bitte Seite manuell öffnen');
    throw new Error(`Keine Inserat-Links gefunden (${searchHtml.length} Bytes) – Seitenstruktur evtl. geändert`);
  }

  const newUrls = urls.filter(u => !exists(u));
  let newCount  = 0;
  for (const url of newUrls) {
    try {
      const data = await scrapeListing(url);
      insert(data);
      newCount++;
      await sleep(1500 + Math.random() * 1500);
    } catch (e) {
      console.warn(`[Poller] Fehler beim Scrapen von ${url}: ${e.message}`);
    }
  }
  return { newCount, totalFound: urls.length };
}

module.exports = {
  pollSearchJob, checkExistingListings, detectPlatform, scrapeListing, fetchPageRaw, checkListingStatus,
  isUrlAllowed: isUrlSyntacticallyAllowed,
};
