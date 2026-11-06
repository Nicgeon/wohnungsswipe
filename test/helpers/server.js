// Starts the app for one test: own port, own temporary database, portal fetch replaced by
// fake-poll.js. With `seed`, it also registers anna@x.de / secret123 and runs a global agent
// "Seed" that brings in six listings (their photos come from a small local image server).
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Serves test/fixtures/imgs – listing photos must be http(s) URLs
let imageServer = null;
async function startImageServer() {
  if (imageServer) return imageServer.port;
  const port = await freePort();
  const dir = path.join(__dirname, '..', 'fixtures', 'imgs');
  const srv = http.createServer((req, res) => {
    const f = path.join(dir, path.basename(decodeURIComponent(req.url.split('?')[0])));
    if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    fs.createReadStream(f).pipe(res);
  }).listen(port);
  imageServer = { port, srv };
  return port;
}
function stopImageServer() { if (imageServer) { imageServer.srv.close(); imageServer = null; } }

function seedPlan(imgPort) {
  const img = k => [0, 1, 2, 3].map(i => `http://localhost:${imgPort}/p${(i + k) % 6}.svg`);
  const L = [
    ['Helle 2-Zimmer-Wohnung mit Balkon in der Neustadt', '700 €', '850 €', '58 m²', '2', '28199 Bremen - Neustadt', ['Balkon', 'Altbau', 'Einbauküche', 'Dielenboden']],
    ['Gemütliche 3-Zimmer-Wohnung in Findorff', '820 €', '1.010 €', '74 m²', '3', '28215 Bremen - Findorff', ['Keller', 'Garten']],
    ['Kleine 1-Zimmer-Wohnung nahe Uni', '430 €', '560 €', '31 m²', '1', '28359 Bremen - Horn-Lehe', ['Einbauküche']],
    ['Altbau mit Dielen in Schwachhausen', '950 €', '1.180 €', '82 m²', '3', '28209 Bremen - Schwachhausen', ['Altbau', 'Balkon']],
    ['Neubau-Wohnung mit Aufzug', '1.050 €', '1.290 €', '69 m²', '2', '28217 Bremen - Walle', ['Aufzug', 'Tiefgarage']],
    ['WG-geeignete 4-Zimmer-Wohnung', '1.200 €', '1.480 €', '96 m²', '4', '28205 Bremen - Östliche Vorstadt', ['Balkon', 'Keller']],
  ];
  return { Seed: L.map(([title, price_cold, price, size, rooms, location, tags], k) => ({
    url: `https://www.kleinanzeigen.de/s-anzeige/seed-${k}/${100 + k}-203-1`, platform: 'kleinanzeigen',
    title, price_cold, price, size, rooms, location, image_url: img(k)[0],
    images_json: JSON.stringify(img(k)), tags_json: JSON.stringify(tags),
    description: `Schöne Wohnung (${title}). Ruhige Lage, gute Anbindung.`,
  })) };
}

async function startServer({ plan = {}, seed = false } = {}) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flatswipe-test-'));
  if (seed) plan = { ...plan, ...seedPlan(await startImageServer()) };
  const planFile = path.join(dir, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const proc = spawn(process.execPath, ['-r', path.join(__dirname, 'fake-poll.js'), path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'test.db'), SESSION_SECRET: 'test-secret-for-the-test-suite-only',
           FAKE_POLL: planFile, BASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    try { await fetch(base); break; } catch (_) {
      if (i > 100 || proc.exitCode !== null) throw new Error(`Server startet nicht:\n${log}`);
      await sleep(100);
    }
  }
  if (seed) {
    let cookie = '';
    const api = async (method, p, body) => {
      const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return r.json();
    };
    await api('POST', '/api/auth/register', { username: 'Anna', email: 'anna@x.de', password: 'secret123' });
    const { job } = await api('POST', '/api/jobs', { label: 'Seed', search_url: 'https://www.kleinanzeigen.de/s-wohnung-mieten/bremen/c203l1', visibility: 'global' });
    await api('POST', `/api/jobs/${job.id}/run`);
    for (let i = 0; i < 50 && ((await api('GET', '/api/listings/swipe')).listings || []).length < 6; i++) await sleep(100);
  }
  return {
    base,
    log: () => log,
    stop: () => new Promise(res => { proc.once('exit', () => { fs.rmSync(dir, { recursive: true, force: true }); res(); }); proc.kill(); }),
  };
}

module.exports = { startServer, stopImageServer };
