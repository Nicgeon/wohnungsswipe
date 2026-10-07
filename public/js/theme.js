/* ══════════════════════════════════════════════════════════
   Shared UI helpers: line icons, theme (auto / light / dark), account menu.
   Loaded before app.js.
══════════════════════════════════════════════════════════ */

// ── Line icons (24×24, stroke currentColor) ───────────────
const ICONS = {
  x:        'M6 6l12 12M18 6L6 18',
  heart:    'M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z',
  star:     'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
  undo:     'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  skip:     'M5 5l7 7-7 7M13 5l7 7-7 7',
  cards:    'M5 9.5A2.5 2.5 0 0 1 7.5 7h9A2.5 2.5 0 0 1 19 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17.5zM8.5 4h7',
  bookmark: 'M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z',
  users:    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.3c2.2.7 3.5 2.7 3.5 5.7',
  grid:     'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  area:     'M4 4h16v16H4zM4 9h3M4 14h3M9 4v3M14 4v3',
  door:     'M6 20V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15M4 20h16M13.5 12h.01',
  pin:      'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  back:     'M15 5l-7 7 7 7',
  next:     'M9 5l7 7-7 7',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  share:    'M12 15V4M8 8l4-4 4 4M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  image:    'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01',
  sun:      'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8',
  moon:     'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  auto:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18M12 3a9 9 0 0 1 0 18',
  user:     'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6',
  file:     'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6',
  logout:   'M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9',
  chat:     'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  flag:     'M6 21V4M6 5h11l-2 4 2 4H6',
};
function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;
}
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (el.dataset.iconDone) return;
    const cls = el.classList.contains('lg') ? 'lg' : el.classList.contains('sm') ? 'sm' : '';
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, cls));
    el.dataset.iconDone = '1';
  });
}

// ── Theme: 'auto' | 'light' | 'dark' ──────────────────────
const theme = (() => {
  const KEY = 'ws-theme';
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const read = () => { try { return localStorage.getItem(KEY) || 'dark'; } catch { return 'dark'; } };
  const resolve = m => m === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : m;
  function apply() {
    const m = read(), t = resolve(m);
    document.documentElement.dataset.theme = t;
    document.getElementById('meta-theme-color')?.setAttribute('content', t === 'light' ? '#f6f2ea' : '#0f0f11');
    document.querySelectorAll('[data-theme-mode]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.themeMode === m)));
  }
  function set(m) {
    try { localStorage.setItem(KEY, m); } catch (_) {}
    apply();
  }
  mq?.addEventListener?.('change', () => { if (read() === 'auto') apply(); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-theme-mode]');
    if (b) set(b.dataset.themeMode);
  });
  return { apply, set, read };
})();

// ── Account menu (avatar in the top bar) ──────────────────
function setNavUser(name) {
  const n = name || '';
  const el = document.getElementById('nav-username');
  if (el) el.textContent = n;
  const av = document.getElementById('nav-avatar');
  if (av) av.textContent = (n.trim().charAt(0) || '?').toUpperCase();
}

(function initAccountMenu() {
  const btn = document.getElementById('account-btn');
  const menu = document.getElementById('account-menu');
  if (!btn || !menu) return;
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open  = () => { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); menu.querySelector('.acct-item')?.focus(); };
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden ? open() : close(); });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
  menu.addEventListener('click', e => {
    const go = e.target.closest('[data-acct-goto]');
    if (go) { close(); window.showView?.(go.dataset.acctGoto, true); return; }
    if (e.target.closest('#logout-btn')) close();
  });
})();

hydrateIcons();
theme.apply();
