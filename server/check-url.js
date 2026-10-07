#!/usr/bin/env node
/* Diagnose why a listing is (not) flagged offline.
 *   docker exec <container> node server/check-url.js <listing-url>
 * Fetches the page exactly like the poller does and prints what the status
 * detection sees. Add --save to write the raw HTML to /tmp/check-url.html. */
const cheerio = require('cheerio');
const { fetchPageRaw, checkListingStatus, detectPlatform, scrapeListing } = require('./poller');

(async () => {
  const url = process.argv[2];
  if (!url) { console.error('usage: node server/check-url.js <url> [--save]'); process.exit(1); }
  const platform = detectPlatform(url);
  console.log('Plattform:', platform);
  let raw;
  try { raw = await fetchPageRaw(url, 20000); }
  catch (e) { console.log('Abruf fehlgeschlagen:', e.message); }
  if (raw) {
    console.log('Final-URL:', raw.finalUrl);
    console.log('Länge:', raw.text.length, 'Bytes');
    if (process.argv.includes('--save')) { require('fs').writeFileSync('/tmp/check-url.html', raw.text); console.log('HTML gespeichert: /tmp/check-url.html'); }
    const $ = cheerio.load(raw.text);
    console.log('<title>:', $('title').text().trim().slice(0, 120));
    const h1 = $('h1#viewad-title');
    console.log('h1#viewad-title vorhanden:', h1.length > 0, '| data-soldlabel:', JSON.stringify(h1.attr('data-soldlabel') ?? null));
    console.log('.adexpired-Marker:', $('.adexpired, [data-testid="adexpired"]').length, '| reserved-Badge:', $('[data-testid="reserved-badge"], .reserved-badge').length);
    console.log('h1-HTML:', (h1.first().toString() || '(keiner)').replace(/\s+/g, ' ').slice(0, 500));
    console.log('Preis-Element:', $('#viewad-price').text().trim() || '(keins)', '| Beschreibung vorhanden:', $('#viewad-description-text, #viewad-description').length > 0, '| Kontakt-Box:', $('#viewad-contact, #viewad-contact-box').length > 0);
    console.log('og:title:', $('meta[property="og:title"]').attr('content') || '(keins)');
    console.log('Bilder:', $('img[src*="prod-ads/images"]').length);
    const why = {};
    console.log('Entscheidung (nur Seiteninhalt):', checkListingStatus($, platform, why), why.reason ? `(${why.reason})` : '');
    if (!h1.length) console.log('Textanfang:', $('body').text().replace(/\s+/g, ' ').trim().slice(0, 300));
  }
  const d = await scrapeListing(url, { lite: true });
  console.log('Endergebnis scrapeListing:', d.status, '| Titel:', d.title);
})();
