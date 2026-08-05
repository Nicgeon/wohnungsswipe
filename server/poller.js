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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent':      UA,
  'Accept':          'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'de-DE,de;q=0.9',
  'Cache-Control':   'no-cache',
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
  const res = await fetch(url, { headers: HEADERS, timeout: timeoutMs });
  if (!res.ok && !allowedFailCodes.includes(res.status)) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
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
      if (href.startsWith('http')) urls.add(href.split('?')[0]);
    });
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

// ── Extract tags/features from listing ───────────────────
function extractTags($, platform, descText) {
  const tags = new Set();

  if (platform === 'kleinanzeigen') {
    // Kleinanzeigen feature chips/attributes
    $('[class*="tag"], [class*="Tag"], .iconlist li, [class*="feature"], [class*="Feature"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 1 && t.length < 40 && !/^\d+$/.test(t)) tags.add(t);
    });
    // Also mine from the details list
    $('.addetailslist--detail').each((_, el) => {
      const lbl = $(el).find('.addetailslist--detail--label').text().trim();
      const val = $(el).find('span:last-child').text().trim();
      if (lbl && val && !/preis|miete|größe|zimmer/i.test(lbl)) tags.add(`${lbl}: ${val}`);
    });
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
  const keywords = [
    'Balkon','Terrasse','Garten','Keller','Aufzug','Fahrstuhl','Einbauküche','EBK',
    'Parkett','Fußbodenheizung','Altbau','Neubau','Dachgeschoss','Erdgeschoss',
    'WG-geeignet','Haustiere erlaubt','barrierefrei','möbliert','teilmöbliert',
    'Tiefgarage','Stellplatz','Garage','Photovoltaik','Fernwärme','Gasheizung',
    'Zentralheizung','Badewanne','Dusche','Wannenbad','Abstellraum','Kellerabteil',
  ];
  keywords.forEach(kw => {
    if (new RegExp(kw, 'i').test(descText)) tags.add(kw);
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

// ── Check if listing is offline or reserved ───────────────
function checkListingStatus($, platform) {
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
  if (platform === 'kleinanzeigen') {
    if ($('.adexpired, [data-testid="adexpired"], .banner--warning').length) return 'offline';
    if ($('[data-testid="reserved-badge"], .reserved-badge').length) return 'reserved';
    // Only flag as offline if there's NO title AND the page is very small
    // (avoids false positives on JS-heavy pages that just haven't loaded yet)
    if (!$('h1#viewad-title, h1.headline').length && bodyText.length < 3000) return 'offline';
  }
  if (platform === 'immoscout') {
    if ($('[data-qa="expose-offline"], .expose--inactive').length) return 'offline';
  }
  // rentola/meinestadt: no DOM-based checks (they're SPAs, real content loads
  // client-side), but the generic text-pattern checks above now work reliably
  // for them too, since script/style content no longer pollutes bodyText.

  return 'active';
}

// ── Scrape a single listing ───────────────────────────────
async function scrapeListing(url) {
  const platform = detectPlatform(url);
  const d = {
    url, platform,
    title: '', price: '', price_cold: '', size: '', location: '',
    rooms: '', image_url: '', images_json: '[]', description: '',
    tags_json: '[]', status: 'active',
  };

  let html;
  try {
    // For SPA platforms, allow 403 responses – they still contain meta tags in the HTML
    const allowedCodes = (platform === 'rentola' || platform === 'meinestadt') ? [403] : [];
    html = await fetchPage(url, 18000, allowedCodes);
  }
  catch (e) {
    // HTTP 404 / 410 = definitely offline; 403 for non-SPA = likely offline
    if (e.message.includes('404') || e.message.includes('410') || e.message.includes('403')) {
      d.status = 'offline';
    }
    d.title = 'Inserat (nicht ladbar)';
    d.description = `Fehler: ${e.message}`;
    return d;
  }

  const $ = cheerio.load(html);
  d.status = checkListingStatus($, platform);

  if (platform === 'kleinanzeigen') {
    d.title       = $('h1#viewad-title').text().trim() || $('h1').first().text().trim();
    d.price       = extractPrice($('[data-testid="price"]').text() || $('.priceintro').text() || $('strong.price-big').text());
    d.location    = $('#viewad-locality').text().trim() || $('[data-testid="listing-location"]').text().trim();
    d.description = ($('#viewad-description-text').text() || $('[data-testid="description"]').text()).trim().substring(0, 800);
    $('#viewad-details .addetailslist--detail').each((_, el) => {
      const lbl = $(el).find('.addetailslist--detail--label').text().toLowerCase();
      const val = $(el).find('span:last-child').text().trim();
      if (/zimmer/.test(lbl))           d.rooms      = val;
      if (/fläche|größe/.test(lbl))     d.size       = val;
      if (/kalt|netto|grund/.test(lbl)) d.price_cold = extractPrice(val) || val;
    });
    if (!d.price_cold) d.price_cold = findKaltmiete($, d.description);
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
    d.title = $('h1').first().text().trim();
    d.price = extractPrice($('[class*="AdvertPrice"]').text() || $('.price').first().text());
    $('[data-test*="fact"], [class*="FactItem"]').each((_, el) => {
      const lbl = $(el).text().toLowerCase();
      const val = $(el).find('[class*="value"], strong, b').text().trim() || $(el).text().trim();
      if (/zimmer/.test(lbl))    d.rooms      = extractRooms(lbl) || val;
      if (/fläche/.test(lbl))    d.size       = extractSize(lbl)  || val;
      if (/kaltmiete/.test(lbl)) d.price_cold = extractPrice(val) || val;
    });
    if (!d.price_cold) d.price_cold = findKaltmiete($, getVisibleText($, 'body').substring(0, 3000));
    const imgs = collectImages($, ['[class*="Gallery"] img', '[class*="gallery"] img', '[class*="Slider"] img']);
    d.images_json = JSON.stringify(imgs);
    d.image_url   = imgs[0] || $('meta[property="og:image"]').attr('content') || '';
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

  // Tags
  d.tags_json = JSON.stringify(extractTags($, platform, d.description));

  return d;
}

// ── Check existing listings for offline/reserved status ───
async function checkExistingListings(listings, onUpdate) {
  const results = { offline: 0, reserved: 0 };
  for (const listing of listings) {
    try {
      let html;
      try { html = await fetchPage(listing.url, 12000); }
      catch (e) {
        if (e.message.includes('404') || e.message.includes('410')) {
          onUpdate(listing.id, 'offline');
          results.offline++;
        }
        await sleep(1000 + Math.random() * 1000);
        continue;
      }
      const $      = cheerio.load(html);
      const status = checkListingStatus($, detectPlatform(listing.url));
      if (status !== 'active') {
        onUpdate(listing.id, status);
        results[status] = (results[status] || 0) + 1;
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

module.exports = { pollSearchJob, checkExistingListings, detectPlatform, scrapeListing };
