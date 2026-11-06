#!/usr/bin/env node
/**
 * Test runner – `npm test` (unit + API), `npm run test:ui` (additionally the browser tests).
 *
 *   unit/  pure functions (duplicate detection, message texts), no server
 *   api/   against a real server with its own temporary database; search agents get fixed
 *          results (helpers/fake-poll.js) instead of fetching real portals
 *   ui/    in Chromium via Playwright (mobile and desktop size), needs `playwright`
 *
 * Each test file is a plain script that prints ✓/✗ lines. A file fails when it exits with an
 * error or reports a failure (✗, "N FAILS", "N failed", "fails: N", page errors).
 * Only some files: `node test/run.js dedupe duplicates`.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, stopImageServer } = require('./helpers/server');

const withUi = process.argv.includes('--ui');
const filters = process.argv.slice(2).filter(a => !a.startsWith('--'));
const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flatswipe-shots-'));
const dupPlan = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'duplicates-plan.json'), 'utf8'));

// [file, server setup, extra args]
const TESTS = [
  ['unit/dedupe.test.js'], ['unit/template.test.js'], ['unit/introduction.test.js'],
  ['unit/formatting.test.js'], ['unit/documents.test.js'],
  ['api/core.test.js', { seed: true }],
  ['api/duplicates.test.js', { plan: dupPlan }],
];
if (withUi) for (const size of [['390', '844'], ['1440', '900']]) TESTS.push(
  ['ui/back-navigation.test.js', { seed: true }, size],
  ['ui/rate-in-detail.test.js', { seed: true }, size],
  ['ui/duplicates.test.js', { plan: dupPlan }, size],
);
if (withUi) TESTS.push(['ui/tabs.test.js', { seed: true }], ['ui/shared-link.test.js', { seed: true }]);

const FAILED = /^\s*✗|^\s*FAIL\b|\b[1-9]\d* (?:FAILS|failed)\b|fails: [1-9]|errors?: \[\s*"|^ERR\b|Error:/m;

function runFile(file, base, args) {
  return new Promise(res => {
    const p = spawn(process.execPath, [path.join(__dirname, file), shotDir, ...args], { env: { ...process.env, TEST_BASE: base || '' } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('exit', code => res({ code, out }));
  });
}

(async () => {
  if (withUi && !require('./helpers/browser').available) {
    console.error('Playwright nicht gefunden – für die Browser-Tests `npm i -D playwright && npx playwright install chromium`.');
    process.exit(1);
  }
  let failed = 0;
  for (const [file, setup, args = []] of TESTS) {
    if (filters.length && !filters.some(f => file.includes(f))) continue;
    const label = `${file}${args.length ? ` (${args.join('×')})` : ''}`;
    const server = setup ? await startServer(setup) : null;
    const t0 = Date.now();
    const { code, out } = await runFile(file, server && server.base, args);
    if (server) await server.stop();
    const bad = code !== 0 || FAILED.test(out);
    const checks = (out.match(/^\s*✓/gm) || []).length;
    console.log(`${bad ? '✗' : '✓'} ${label}  ${checks ? `${checks} Prüfungen, ` : ''}${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (bad) { failed++; console.log(out.split('\n').map(l => `    ${l}`).join('\n')); }
  }
  stopImageServer();
  console.log(failed ? `\n${failed} Testdatei(en) fehlgeschlagen` : '\nAlle Tests bestanden');
  process.exit(failed ? 1 : 0);
})();
