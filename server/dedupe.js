/**
 * dedupe.js – erkennt dieselbe Wohnung auf verschiedenen Portalen
 *
 * Wohnungsunternehmen stellen ihre Angebote oft parallel auf mehrere Portale
 * (LEG auch auf Immowelt, Vonovia auch auf ImmoScout24 …). Jede Kopie wäre
 * sonst ein eigenes Inserat im Swipe-Stapel. Diese Datei vergleicht nur
 * Inseratsdaten und bildet daraus Gruppen ("Cluster"); was die App mit einem
 * Cluster macht (einmal zeigen, eine Bewertung für alle Kopien), steht in
 * index.js.
 *
 * Zwei Inserate gelten als dieselbe Wohnung, wenn
 *   - sie von VERSCHIEDENEN Portalen stammen (innerhalb eines Portals hat
 *     jede Wohnung ihre eigene Anzeige – so verschmelzen baugleiche
 *     Wohnungen im selben Haus nicht),
 *   - die Wohnfläche praktisch gleich ist (±1 m² bzw. ±1,5 %),
 *   - die Lage passt (gleiche PLZ oder Koordinaten höchstens 400 m entfernt),
 *   - und die Miete passt (Kalt- bzw. Gesamtmiete ±3 %) oder – falls ein
 *     Portal keine Miete nennt – die Zimmerzahl übereinstimmt.
 * Eine abweichende Zimmerzahl schließt ein Duplikat immer aus. Von Hand als
 * "kein Duplikat" markierte Paare werden nie verbunden.
 */

// "1.812,87 €" → 1812.87, "53,43 m²" → 53.43, "56.0 m²" → 56, "2,5" → 2.5
function parseNumberDe(text) {
  const m = String(text || '').match(/\d+(?:[.,]\d+)*/);
  if (!m) return null;
  let t = m[0];
  if (t.includes('.') && t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function platformKey(l) {
  if (l.platform && l.platform !== 'unbekannt') return l.platform;
  try { return new URL(l.url).hostname.replace(/^www\./, ''); } catch (_) { return `?${l.id}`; }
}

function fingerprint(l) {
  const plzSource = `${l.location || ''} ${(String(l.description || '').match(/^Adresse:.*$/m) || [''])[0]}`;
  const plz = (plzSource.match(/\b(\d{5})\b/) || [])[1] || null;
  const lat = Number(l.latitude), lng = Number(l.longitude);
  return {
    id: l.id,
    platform: platformKey(l),
    size:  parseNumberDe(l.size),
    rooms: parseNumberDe(l.rooms),
    cold:  parseNumberDe(l.price_cold),
    warm:  parseNumberDe(l.price),
    plz,
    lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
    lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
  };
}

function distanceMeters(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const close = (x, y, rel, abs = 0) => Math.abs(x - y) <= Math.max(abs, rel * Math.max(x, y));

// a, b: fingerprints
function isSameFlat(a, b) {
  if (a.platform === b.platform) return false;
  if (!a.size || !b.size || !close(a.size, b.size, 0.015, 1)) return false;
  if (a.rooms && b.rooms && Math.abs(a.rooms - b.rooms) > 0.01) return false;

  let place = false;
  if (a.plz && b.plz) {
    if (a.plz !== b.plz) return false;
    place = true;
  }
  if (!place && a.lat != null && b.lat != null) place = distanceMeters(a, b) <= 400;
  if (!place) return false;

  if (a.cold && b.cold) return close(a.cold, b.cold, 0.03);
  if (a.warm && b.warm) return close(a.warm, b.warm, 0.03);
  return !!(a.rooms && b.rooms);                 // no comparable rent: the room count has to carry it
}

/**
 * Groups listings into clusters of the same flat.
 * @param listings     rows with id, url, platform, size, rooms, price, price_cold, location, description, latitude, longitude
 * @param notPairs     iterable of [idA, idB] that a user marked as "kein Duplikat"
 * @returns Map id → cluster id (the smallest id of its cluster); listings without duplicate are absent
 */
function computeClusters(listings, notPairs = []) {
  const fps = listings.map(fingerprint).filter(f => f.size);
  const byId = new Map(fps.map(f => [f.id, f]));
  const blocked = new Set([...notPairs].map(([x, y]) => `${Math.min(x, y)}:${Math.max(x, y)}`));

  // 1) candidate pairs – only listings of about the same size can match: bucket by whole m²
  const buckets = new Map();
  for (const f of fps) {
    const k = Math.round(f.size);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(f);
  }
  const edges = [];
  for (const f of fps) {
    const k = Math.round(f.size);
    for (const kk of [k - 1, k, k + 1]) {
      for (const g of buckets.get(kk) || []) {
        if (g.id <= f.id || blocked.has(`${f.id}:${g.id}`) || !isSameFlat(f, g)) continue;
        const rent = f.cold && g.cold ? Math.abs(f.cold - g.cold) / Math.max(f.cold, g.cold)
                   : f.warm && g.warm ? Math.abs(f.warm - g.warm) / Math.max(f.warm, g.warm) : 0.03;
        const dist = f.lat != null && g.lat != null ? distanceMeters(f, g) / 10000 : 0.01;
        edges.push({ a: f.id, b: g.id, score: Math.abs(f.size - g.size) / Math.max(f.size, g.size) + rent + dist });
      }
    }
  }

  // 2) join the closest matches first. A cluster holds at most one listing per portal (otherwise two
  //    twin flats of one landlord would merge through a third portal's copy) and never a pair a
  //    user marked as "kein Duplikat".
  edges.sort((x, y) => x.score - y.score || x.a - y.a || x.b - y.b);
  const clusterOf = new Map(fps.map(f => [f.id, [f.id]]));
  for (const { a, b } of edges) {
    const ca = clusterOf.get(a), cb = clusterOf.get(b);
    if (ca === cb) continue;
    const portals = new Set(ca.map(id => byId.get(id).platform));
    if (cb.some(id => portals.has(byId.get(id).platform))) continue;
    if (ca.some(x => cb.some(y => blocked.has(`${Math.min(x, y)}:${Math.max(x, y)}`)))) continue;
    const merged = [...ca, ...cb];
    for (const id of merged) clusterOf.set(id, merged);
  }

  const out = new Map();
  for (const members of new Set(clusterOf.values())) {
    if (members.length < 2) continue;
    const cid = Math.min(...members);
    for (const id of members) out.set(id, cid);
  }
  return out;
}

module.exports = { parseNumberDe, fingerprint, isSameFlat, computeClusters, platformKey };
