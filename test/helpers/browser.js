// Playwright for the browser tests: a local install, else a global one. CHROMIUM_PATH picks the
// browser binary (default: Playwright's own download, or /opt/pw-browsers/chromium if present).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (_) {}
  try { return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch (_) {}
  return null;
}

const playwright = loadPlaywright();
const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

module.exports = {
  available: !!playwright,
  chromium: playwright && playwright.chromium,
  launchOptions: { ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox'] },
};
