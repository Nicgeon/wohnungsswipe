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
  return 'unbekannt';
}

async function fetchPage(url, timeoutMs = 18000) {
  const res = await fetch(url, { headers: HEADERS, timeout: timeoutMs });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

// ── Check if listing is offline or reserved ───────────────
function checkListingStatus($, platform) {
  const bodyText = $('body').text().toLowerCase();
  const title    = $('title').text().toLowerCase();

  // Common offline indicators
  const offlinePatterns = [
    /nicht mehr aktiv/i, /anzeige.*nicht.*vorhanden/i, /bereits.*verkauft/i,
    /bereits.*vermietet/i, /diese anzeige.*existiert nicht/i,
    /anzeige.*gelöscht/i, /404/i, /not found/i, /leider nicht mehr/i,
    /nicht mehr verfügbar/i, /angebot.*abgelaufen/i,
  ];
  for (const p of offlinePatterns) {
    if (p.test(bodyText) || p.test(title)) return 'offline';
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
    // Check if title area exists – if not, likely 404/expired
    if (!$('h1#viewad-title, h1.headline').length && bodyText.length < 5000) return 'offline';
  }
  if (platform === 'immoscout') {
    if ($('[data-qa="expose-offline"], .expose--inactive').length) return 'offline';
  }

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
  try { html = await fetchPage(url); }
  catch (e) {
    // HTTP 404 / 410 = definitely offline
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
    const imgs = collectImages($, ['#viewad-image img', '.galleryimage-element img', '[class*="gallery"] img']);
    const og   = $('meta[property="og:image"]').attr('content') || '';
    if (og) imgs.unshift(og);
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
    if (!d.price_cold) d.price_cold = findKaltmiete($, $('body').text().substring(0, 3000));
    const imgs = collectImages($, ['[class*="Gallery"] img', '[class*="gallery"] img', '[class*="Slider"] img']);
    d.images_json = JSON.stringify(imgs);
    d.image_url   = imgs[0] || $('meta[property="og:image"]').attr('content') || '';
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
