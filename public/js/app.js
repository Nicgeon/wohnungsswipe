/* ══════════════════════════════════════════════════════════
   WohnungsSwipe – Frontend
══════════════════════════════════════════════════════════ */

const state = {
  user:       null,
  groups:     [],
  swipeQueue: [],
  ratedFilter: 'all',
  lastSwipe:  null, // { listing, action } – powers the "Sofort-Undo" button
};

// ── Helpers ───────────────────────────────────────────────
const $id = id => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

function toast(msg, ms = 2800) {
  const t = $id('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), ms);
}

function setErr(id, msg) { const el = $id(id); if (el) el.textContent = msg; }
function setOk(id, msg)  { const el = $id(id); if (el) el.textContent = msg; }
function clr(...ids)     { ids.forEach(id => { const el = $id(id); if (el) el.textContent = ''; }); }

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseTags(json) {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}

function parseImages(listing) {
  try { return JSON.parse(listing.images_json || '[]'); } catch { return listing.image_url ? [listing.image_url] : []; }
}

function priceHtml(listing, large = false) {
  const cold  = (listing.price_cold || '').trim();
  const total = (listing.price      || '').trim();
  if (!cold && !total) return '';
  const mainSize = large ? 'font-size:1.1rem' : '';
  let html = `<div class="card-price-row">`;
  if (cold) {
    html += `<span class="card-price-main" style="${mainSize}">${esc(cold)}</span>`;
    html += `<span class="price-tag-cold">Kalt</span>`;
    if (total && total !== cold) html += `<span class="price-tag-warm">${esc(total)} warm</span>`;
  } else {
    html += `<span class="card-price-main" style="${mainSize}">${esc(total)}</span>`;
  }
  return html + '</div>';
}

// ── Screens ───────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $id(id).classList.add('active');
}

const SUB_VIEWS = new Set(['add', 'jobs', 'archive', 'settings']);

function showView(name, isSubNav = false) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab-nav').forEach(b => b.classList.remove('active'));
  $id(`view-${name}`).classList.add('active');

  // Sub-views (jobs/archive/settings) keep the "Mehr" tab highlighted
  const tabKey = SUB_VIEWS.has(name) ? 'more' : name;
  document.querySelector(`.tab-nav[data-view="${tabKey}"]`)?.classList.add('active');

  if (name === 'swipe')    loadSwipeQueue();
  if (name === 'rated')    loadRated();
  if (name === 'groups')   loadGroups();
  if (name === 'jobs')     loadJobs();
  if (name === 'settings') loadSettings();
  if (name === 'archive')  loadArchive();
  if (name === 'add')      loadMyAddedListings();
}

document.querySelectorAll('.tab-nav').forEach(btn =>
  btn.addEventListener('click', () => showView(btn.dataset.view))
);

// "Mehr" sub-menu navigation
document.querySelectorAll('[data-goto]').forEach(btn =>
  btn.addEventListener('click', () => showView(btn.dataset.goto, true))
);
document.querySelectorAll('[data-back-to-more]').forEach(btn =>
  btn.addEventListener('click', () => showView('more', true))
);

// ══════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════
document.querySelector('.auth-tabs').addEventListener('click', e => {
  const tab = e.target.dataset.tab;
  if (!tab) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  e.target.classList.add('active');
  $id(`${tab}-form`).classList.add('active');
  $id('forgot-panel').style.display = 'none';
});

$id('login-form').addEventListener('submit', async e => {
  e.preventDefault(); clr('login-error');
  const d = await api('/api/auth/login', { method: 'POST', body: {
    email: $id('login-email').value, password: $id('login-password').value,
  }});
  if (d.error) return setErr('login-error', d.error);
  onLogin(d);
});

$id('register-form').addEventListener('submit', async e => {
  e.preventDefault(); clr('reg-error');
  const d = await api('/api/auth/register', { method: 'POST', body: {
    username: $id('reg-username').value, email: $id('reg-email').value, password: $id('reg-password').value,
  }});
  if (d.error) return setErr('reg-error', d.error);
  onLogin(d);
});

// Forgot password
$id('show-forgot').addEventListener('click', () => {
  $id('login-form').style.display = 'none';
  $id('forgot-panel').style.display = 'flex';
  clr('forgot-ok','forgot-error');
});
$id('hide-forgot').addEventListener('click', () => {
  $id('forgot-panel').style.display = 'none';
  $id('login-form').style.display = '';
});
$id('forgot-submit').addEventListener('click', async () => {
  const email = $id('forgot-email').value.trim();
  clr('forgot-ok','forgot-error');
  if (!email) return setErr('forgot-error', 'E-Mail eingeben');
  const d = await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
  if (d.error) return setErr('forgot-error', d.error);
  setOk('forgot-ok', d.message || 'E-Mail gesendet (falls Account existiert)');
});

function onLogin(data) {
  state.user = data;
  $id('nav-username').textContent = data.username;
  showScreen('app-screen');
  loadGroups().then(() => loadSwipeQueue());
}

async function doLogout() {
  await api('/api/auth/logout', { method: 'POST' });
  state.user = null; state.groups = [];
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration().catch(()=>null);
    if (reg) { const sub = await reg.pushManager.getSubscription(); if (sub) sub.unsubscribe(); }
  }
  showScreen('auth-screen');
}
$id('logout-btn').addEventListener('click', doLogout);
$id('settings-logout-btn').addEventListener('click', doLogout);

// ══════════════════════════════════════════════════════════
//  LIGHTBOX
// ══════════════════════════════════════════════════════════
const lb = {
  imgs: [], idx: 0,
  open(images, start = 0) {
    if (!images?.length) return;
    this.imgs = images; this.idx = start;
    $id('lightbox').style.display = 'flex';
    this.render();
    document.addEventListener('keydown', lb._key);
  },
  close() {
    $id('lightbox').style.display = 'none';
    document.removeEventListener('keydown', lb._key);
  },
  go(d)  { this.idx = (this.idx + d + this.imgs.length) % this.imgs.length; this.render(); },
  to(i)  { this.idx = i; this.render(); },
  render() {
    $id('lb-img').src = this.imgs[this.idx];
    $id('lb-counter').textContent = `${this.idx + 1} / ${this.imgs.length}`;
    $id('lb-prev').disabled = this.imgs.length <= 1;
    $id('lb-next').disabled = this.imgs.length <= 1;
    const tb = $id('lb-thumbnails'); tb.innerHTML = '';
    this.imgs.forEach((src, i) => {
      const t = document.createElement('img');
      t.src = src; t.className = 'lb-thumb' + (i === this.idx ? ' active' : '');
      t.onclick = () => lb.to(i);
      tb.appendChild(t);
    });
    tb.querySelector('.lb-thumb.active')?.scrollIntoView({ inline:'center', block:'nearest' });
  },
  _key(e) {
    if (e.key === 'Escape')      lb.close();
    if (e.key === 'ArrowLeft')   lb.go(-1);
    if (e.key === 'ArrowRight')  lb.go(1);
  }
};
$id('lb-close').onclick = () => lb.close();
$id('lb-prev').onclick  = () => lb.go(-1);
$id('lb-next').onclick  = () => lb.go(1);
$id('lightbox').addEventListener('click', e => { if (e.target === $id('lightbox')) lb.close(); });

// ══════════════════════════════════════════════════════════
//  CARD BUILDERS
// ══════════════════════════════════════════════════════════
function buildSwipeCard(listing) {
  const images = parseImages(listing);
  const hasImg = images[0]?.startsWith('http');
  const tags   = parseTags(listing.tags_json).slice(0, 6);

  const card = document.createElement('div');
  card.className = 'swipe-card';
  card.dataset.id = listing.id;

  const statusBadge = listing.status === 'reserved'
    ? `<div class="card-status-badge status-reserved">Reserviert</div>` : '';

  card.innerHTML = `
    <div class="card-img-area">
      ${hasImg
        ? `<img class="card-image" src="${esc(images[0])}" onerror="this.style.display='none'" />`
        : `<div class="card-image-placeholder">🏠</div>`}
      ${statusBadge}
      ${images.length > 1 ? `<button class="card-photo-btn" data-gallery>📷 ${images.length}</button>` : ''}
    </div>
    <div class="card-overlay-badge badge-like">JA ♥</div>
    <div class="card-overlay-badge badge-dislike">NEIN ✕</div>
    <div class="card-overlay-badge badge-superlike">⭐ SUPER</div>
    <div class="card-body">
      <span class="card-platform">${esc(listing.platform || 'inserat')}</span>
      <div class="card-title">${esc(listing.title || 'Inserat')}</div>
      ${priceHtml(listing, true)}
      <div class="card-meta">
        ${listing.size   ? `<span class="card-meta-item">📐 ${esc(listing.size)}</span>` : ''}
        ${listing.rooms  ? `<span class="card-meta-item">🚪 ${esc(listing.rooms)} Zi.</span>` : ''}
        ${listing.location ? `<span class="card-meta-item">📍 ${esc(listing.location)}</span>` : ''}
      </div>
      ${tags.length ? `<div class="card-tags">${tags.map(t=>`<span class="card-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${listing.description ? `<div class="card-desc">${esc(listing.description)}</div>` : ''}
      <a class="card-link" href="${esc(listing.url)}" target="_blank" rel="noopener">Inserat öffnen →</a>
    </div>`;

  card.querySelector('[data-gallery]')?.addEventListener('click', e => {
    e.stopPropagation(); lb.open(images, 0);
  });
  return card;
}

function buildListCard(listing, opts = {}) {
  const images = parseImages(listing);
  const hasImg = images[0]?.startsWith('http');
  const tags   = parseTags(listing.tags_json).slice(0, 4);
  const cold   = (listing.price_cold || '').trim();
  const total  = (listing.price      || '').trim();
  const swipe  = listing.my_swipe;
  const swipeLabelMap = { like:'♥ Like', superlike:'⭐ Super-Like', dislike:'✕ Nein' };
  const cardUid = `lc_${listing.id}_${Math.random().toString(36).slice(2,7)}`;

  const div = document.createElement('div');
  div.className = 'list-card';

  div.innerHTML = `
    <div class="list-card-img-area">
      ${hasImg
        ? `<img class="list-card-img" src="${esc(images[0])}" onerror="this.style.display='none'" />`
        : `<div class="list-card-img-placeholder">🏠</div>`}
      ${images.length > 1 ? `<span class="list-card-photo-badge">📷 ${images.length}</span>` : ''}
      ${listing.status === 'offline'   ? `<span class="list-card-offline-badge">Offline</span>` : ''}
      ${listing.status === 'reserved'  ? `<span class="list-card-offline-badge" style="background:rgba(240,200,60,.8)">Reserviert</span>` : ''}
      <button class="card-menu-btn" data-menu-toggle title="Optionen">⋮</button>
      <div class="card-menu" data-menu style="display:none">
        ${!opts.isArchive ? `<button data-menu-action="unswipe">↩ Bewertung zurückziehen</button>` : ''}
        <button data-menu-action="contact-toggle">${listing.contacted ? '✓ Angeschrieben (Notiz bearbeiten)' : '📬 Als angeschrieben markieren'}</button>
      </div>
    </div>
    <div class="list-card-body">
      <div class="list-card-title">${esc(listing.title || 'Inserat')}</div>
      ${cold  ? `<div class="list-card-price">${esc(cold)} <span style="font-size:.7rem;font-weight:400;color:var(--text2)">kalt</span></div>` : ''}
      ${total && total !== cold ? `<div class="list-card-price-warm">${esc(total)} warm</div>` : ''}
      <div class="list-card-meta">
        ${listing.size     ? `<span>📐 ${esc(listing.size)}</span>` : ''}
        ${listing.rooms    ? `<span>🚪 ${esc(listing.rooms)} Zi.</span>` : ''}
        ${listing.location ? `<span>📍 ${esc(listing.location)}</span>` : ''}
      </div>
      ${tags.length ? `<div class="list-card-tags">${tags.map(t=>`<span class="list-card-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${opts.matchInfo ? `<div class="match-count" style="font-size:.76rem;color:var(--like);margin-bottom:5px">${esc(opts.matchInfo)}</div>` : ''}
      ${swipe ? `<div class="swipe-badge ${swipe}">${swipeLabelMap[swipe]||swipe}</div>` : ''}
      ${listing.contacted ? `<div class="contacted-badge">📬 Angeschrieben${listing.contact_note ? ' · ' + esc(listing.contact_note.substring(0,40)) : ''}</div>` : ''}
      <a class="list-card-link" href="${esc(listing.url)}" target="_blank" rel="noopener">Inserat öffnen →</a>
      <div class="contact-note-wrap" data-note-wrap>
        <textarea class="contact-note" placeholder="Notiz (optional): Wann kontaktiert, Antwort, etc." data-note-text>${esc(listing.contact_note || '')}</textarea>
        <div class="contact-note-actions">
          <button class="contact-note-save" data-note-save>Speichern</button>
          <button data-note-cancel>Abbrechen</button>
        </div>
      </div>
    </div>`;

  if (hasImg) div.querySelector('.list-card-img-area').addEventListener('click', e => {
    if (e.target.closest('[data-menu-toggle]') || e.target.closest('[data-menu]')) return;
    lb.open(images);
  });

  // ── Three-dot menu wiring ──
  const menuBtn  = div.querySelector('[data-menu-toggle]');
  const menu     = div.querySelector('[data-menu]');
  const noteWrap = div.querySelector('[data-note-wrap]');
  const noteText = div.querySelector('[data-note-text]');

  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    closeAllCardMenus(menu);
    menu.style.display = menu.style.display === 'none' ? '' : 'none';
  });

  menu.querySelectorAll('[data-menu-action]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      menu.style.display = 'none';
      const action = btn.dataset.menuAction;

      if (action === 'unswipe') {
        const r = await api(`/api/listings/swipe/${listing.id}`, { method: 'DELETE' });
        if (r.success) {
          div.style.opacity = '0'; div.style.transition = 'opacity .3s';
          setTimeout(() => div.remove(), 280);
          toast('↩ Bewertung zurückgezogen');
          state.swipeQueue = [];
        }
      } else if (action === 'contact-toggle') {
        if (!listing.contacted) {
          const r = await api('/api/contacts', { method: 'POST', body: {
            listingId: listing.id, groupId: opts.groupId || null, note: '',
          }});
          if (r.success) {
            listing.contacted = true;
            toast('📬 Als angeschrieben markiert');
            noteWrap.classList.add('open');
            btn.textContent = '✓ Angeschrieben (Notiz bearbeiten)';
            // Insert contacted badge if not already present
            if (!div.querySelector('.contacted-badge')) {
              const badge = document.createElement('div');
              badge.className = 'contacted-badge';
              badge.textContent = '📬 Angeschrieben';
              div.querySelector('.swipe-badge')?.insertAdjacentElement('afterend', badge)
                ?? div.querySelector('.list-card-link').insertAdjacentElement('beforebegin', badge);
            }
          }
        } else {
          noteWrap.classList.toggle('open');
        }
      }
    });
  });

  div.querySelector('[data-note-save]')?.addEventListener('click', async () => {
    await api(`/api/contacts/${listing.id}`, { method: 'PATCH', body: {
      note: noteText?.value || '', groupId: opts.groupId || null,
    }});
    noteWrap.classList.remove('open');
    toast('✓ Notiz gespeichert');
    const badge = div.querySelector('.contacted-badge');
    if (badge) badge.textContent = '📬 Angeschrieben' + (noteText.value ? ' · ' + noteText.value.substring(0,40) : '');
  });
  div.querySelector('[data-note-cancel]')?.addEventListener('click', () => noteWrap.classList.remove('open'));

  // Archive timestamp
  if (opts.isArchive && listing.archived_at) {
    const ts = document.createElement('div');
    ts.className = 'archive-ts';
    const d = new Date(listing.archived_at + 'Z');
    ts.textContent = `📦 Archiviert ${d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' })}`;
    div.querySelector('.list-card-body')?.prepend(ts);
  }

  return div;
}

// Close all open card menus except the one passed in (or all if omitted)
function closeAllCardMenus(except = null) {
  document.querySelectorAll('.card-menu').forEach(m => {
    if (m !== except) m.style.display = 'none';
  });
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-menu-toggle]') && !e.target.closest('[data-menu]')) {
    closeAllCardMenus();
  }
});

// ══════════════════════════════════════════════════════════
//  SWIPE ENGINE
// ══════════════════════════════════════════════════════════
async function loadSwipeQueue() {
  const d = await api('/api/listings/swipe');
  state.swipeQueue = d.listings || [];
  updateUndoButton();
  // Show badge on tab if there are unswiped listings
  updateSwipeBadge(state.swipeQueue.length);
  renderStack();
}

function updateSwipeBadge(count) {
  const tab = document.querySelector('.tab-nav[data-view="swipe"]');
  if (!tab) return;
  let badge = tab.querySelector('.tab-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-badge';
      tab.querySelector('.tab-icon').appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : count;
  } else if (badge) {
    badge.remove();
  }
}

function renderStack() {
  const stack   = $id('card-stack');
  const actions = $id('swipe-actions');
  const empty   = $id('empty-swipe');
  $id('remaining-count').textContent = state.swipeQueue.length;

  if (!state.swipeQueue.length) {
    stack.querySelectorAll('.swipe-card').forEach(c => c.remove());
    empty.style.display = ''; actions.style.display = 'none'; return;
  }
  empty.style.display = 'none'; actions.style.display = 'flex';

  const top3 = state.swipeQueue.slice(0, 3);

  // Which IDs are currently in the DOM?
  const domCards = Array.from(stack.querySelectorAll('.swipe-card'));
  const domIds   = new Set(domCards.map(c => parseInt(c.dataset.id)));
  const queueIds = new Set(top3.map(l => l.id));

  // Remove cards no longer in top-3
  domCards.forEach(c => {
    if (!queueIds.has(parseInt(c.dataset.id))) c.remove();
  });

  // Add missing cards (pre-rendered, initially invisible at back position)
  top3.forEach((listing, idx) => {
    if (!domIds.has(listing.id)) {
      const card = buildSwipeCard(listing);
      // Start from back position so it animates into place
      card.style.opacity = '0';
      card.style.transform = 'scale(0.88) translateY(28px)';
      stack.appendChild(card);
    }
  });

  // Now assign correct position classes with a clean transition
  // Use requestAnimationFrame to ensure DOM is updated before adding transitions
  requestAnimationFrame(() => {
    const cards = Array.from(stack.querySelectorAll('.swipe-card:not(.fly-left):not(.fly-right):not(.fly-up):not(.fly-down)'));

    // Sort cards so top of queue = last in DOM (highest z-index via position)
    // card at index 0 in queue = card-top, index 1 = card-behind-1, etc.
    top3.forEach((listing, qIdx) => {
      const card = stack.querySelector(`.swipe-card[data-id="${listing.id}"]:not(.fly-left):not(.fly-right):not(.fly-up):not(.fly-down)`);
      if (!card) return;

      const wasTop = card.classList.contains('card-top');
      card.classList.remove('card-top', 'card-behind-1', 'card-behind-2');

      if (qIdx === 0) {
        // This is the new top card
        card.style.transition = 'transform 0.32s cubic-bezier(.16,1,.3,1), opacity 0.32s ease';
        card.style.transform  = '';
        card.style.opacity    = '';
        card.classList.add('card-top');
        // Only attach drag if it's newly becoming top
        if (!wasTop) {
          // Small delay so the promote animation starts first
          setTimeout(() => attachDrag(card, listing), 50);
        } else {
          attachDrag(card, listing);
        }
      } else if (qIdx === 1) {
        card.style.transition = 'transform 0.32s cubic-bezier(.16,1,.3,1), opacity 0.32s ease';
        card.style.transform  = '';
        card.style.opacity    = '';
        card.classList.add('card-behind-1');
      } else {
        card.style.transition = 'transform 0.32s cubic-bezier(.16,1,.3,1), opacity 0.32s ease';
        card.style.transform  = '';
        card.style.opacity    = '';
        card.classList.add('card-behind-2');
      }
    });
  });
}

// Global drag state – one active drag at a time
let _dragCard     = null;
let _dragCleanup  = null;

function attachDrag(card, listing) {
  // Don't re-attach if this card is already the active drag target
  if (_dragCard === card) return;

  // Clean up previous drag
  if (_dragCleanup) { _dragCleanup(); _dragCleanup = null; }
  _dragCard = card;

  let sx = 0, sy = 0, cx = 0, cy = 0, dragging = false;
  const bl = card.querySelector('.badge-like');
  const bd = card.querySelector('.badge-dislike');
  const bs = card.querySelector('.badge-superlike');

  function start(x, y) {
    // Ignore if another card is flying
    if (document.querySelector('.fly-left, .fly-right, .fly-up, .fly-down')) return;
    sx = x; sy = y; cx = x; cy = y; dragging = true;
    card.style.transition = 'none';
    card.style.zIndex     = '10';
  }

  function move(x, y) {
    if (!dragging) return;
    cx = x; cy = y;
    const dx = cx - sx, dy = cy - sy;
    card.style.transform = `translate(${dx}px,${dy}px) rotate(${dx * 0.06}deg)`;
    if (dy < -80 && Math.abs(dx) < 80) {
      bs.style.opacity = Math.min(1, Math.abs(dy) / 100);
      bl.style.opacity = bd.style.opacity = 0;
    } else if (dx > 60) {
      bl.style.opacity = Math.min(1, dx / 100);
      bd.style.opacity = bs.style.opacity = 0;
    } else if (dx < -60) {
      bd.style.opacity = Math.min(1, Math.abs(dx) / 100);
      bl.style.opacity = bs.style.opacity = 0;
    } else {
      bl.style.opacity = bd.style.opacity = bs.style.opacity = 0;
    }
  }

  function end() {
    if (!dragging) return;
    dragging = false;
    bl.style.opacity = bd.style.opacity = bs.style.opacity = 0;
    const dx = cx - sx, dy = cy - sy;
    if      (dy < -100 && Math.abs(dx) < 100) doSwipe(listing, 'superlike');
    else if (dx >  100)                        doSwipe(listing, 'like');
    else if (dx < -100)                        doSwipe(listing, 'dislike');
    else {
      card.style.transition = 'transform 0.35s cubic-bezier(.16,1,.3,1)';
      card.style.transform  = '';
      card.style.zIndex     = '';
    }
  }

  const onMove = e => move(e.clientX, e.clientY);
  const onUp   = end;

  card.addEventListener('mousedown',  e => { if (e.button === 0) start(e.clientX, e.clientY); });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
  card.addEventListener('touchstart', e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
  card.addEventListener('touchmove',  e => { const t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  card.addEventListener('touchend',   end);

  _dragCleanup = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    _dragCard = null;
  };
}

async function doSwipe(listing, action) {
  const card = $id('card-stack').querySelector(`.swipe-card[data-id="${listing.id}"]`);
  if (!card || card.classList.contains('fly-left') || card.classList.contains('fly-right') || card.classList.contains('fly-up') || card.classList.contains('fly-down')) return;

  // Detach drag immediately
  if (_dragCleanup) { _dragCleanup(); _dragCleanup = null; }

  // Reset inline styles then trigger fly class
  card.style.transition = '';
  card.style.zIndex     = '10';

  // Force reflow so transition picks up the current (possibly translated) position
  void card.offsetWidth;

  const flyClass = { like: 'fly-right', dislike: 'fly-left', superlike: 'fly-up', skip: 'fly-down' }[action];
  card.classList.add(flyClass);

  const toastMsg = {
    like:      '💚 Gefällt dir!',
    dislike:   '✕ Abgelehnt',
    superlike: '⭐ Super-Like!',
    skip:      '⏭ Übersprungen – kommt später wieder',
  }[action];
  toast(toastMsg);

  // Fire API in background
  api('/api/listings/swipe', { method: 'POST', body: { listingId: listing.id, action } });

  // Track for the undo button (always remembers the most recent swipe in this session)
  state.lastSwipe = { listing, action };
  updateUndoButton();

  // Remove from queue immediately so renderStack knows what's next.
  // Skipped listings get pushed to the back of the queue instead of removed entirely,
  // so they resurface once everything else has been swiped (matches server-side ordering).
  state.swipeQueue = state.swipeQueue.filter(l => l.id !== listing.id);
  if (action === 'skip') {
    state.swipeQueue.push(listing);
  }

  // Trigger stack update right away – the flying card is still in DOM
  // renderStack will skip it because it has fly-* class
  renderStack();

  // Remove the card after animation completes
  setTimeout(() => { card.remove(); }, 420);
}

function updateUndoButton() {
  const btn = $id('btn-undo');
  if (!btn) return;
  btn.disabled = !state.lastSwipe;
}

async function undoLastSwipe() {
  if (!state.lastSwipe) return;
  const btn = $id('btn-undo');
  btn.disabled = true;

  const r = await api('/api/listings/swipe/undo-last', { method: 'POST' });
  if (!r.success) {
    toast('⚠️ Nichts zum Zurücknehmen');
    return;
  }

  const { listing, action } = state.lastSwipe;
  toast('↩ Zurückgenommen: ' + (listing.title || 'Inserat').substring(0, 40));

  // If it was pushed to the back of the queue as a skip, remove that duplicate
  if (action === 'skip') {
    state.swipeQueue = state.swipeQueue.filter(l => l.id !== listing.id);
  }
  // Put the listing back at the very front so the user sees it again immediately
  state.swipeQueue.unshift(r.listing || listing);

  state.lastSwipe = null;
  updateUndoButton();
  renderStack();
}

$id('btn-like').onclick      = () => state.swipeQueue[0] && doSwipe(state.swipeQueue[0], 'like');
$id('btn-dislike').onclick   = () => state.swipeQueue[0] && doSwipe(state.swipeQueue[0], 'dislike');
$id('btn-superlike').onclick = () => state.swipeQueue[0] && doSwipe(state.swipeQueue[0], 'superlike');
$id('btn-skip').onclick      = () => state.swipeQueue[0] && doSwipe(state.swipeQueue[0], 'skip');
$id('btn-undo').onclick      = () => undoLastSwipe();

document.addEventListener('keydown', e => {
  if (!state.user) return;
  if ($id('lightbox').style.display !== 'none') return;
  if (document.querySelector('.modal[style*="flex"]')) return;
  if (!$id('view-swipe').classList.contains('active')) return;

  // Undo works even if the queue looks empty (e.g. right after the last card was swiped)
  if (e.key === 'Backspace' || (e.key.toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey)) {
    if (state.lastSwipe) { e.preventDefault(); undoLastSwipe(); }
    return;
  }

  if (!state.swipeQueue.length) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); doSwipe(state.swipeQueue[0], 'dislike'); }
  if (e.key === 'ArrowRight') { e.preventDefault(); doSwipe(state.swipeQueue[0], 'like'); }
  if (e.key === 'ArrowUp')    { e.preventDefault(); doSwipe(state.swipeQueue[0], 'superlike'); }
  if (e.key === 'ArrowDown')  { e.preventDefault(); doSwipe(state.swipeQueue[0], 'skip'); }
});

// ══════════════════════════════════════════════════════════
//  ADD LISTING
// ══════════════════════════════════════════════════════════
$id('add-listing-btn').addEventListener('click', async () => {
  const url        = $id('listing-url').value.trim();
  const visibility  = $id('add-visibility').value;
  const visGrp      = $id('add-visibility-group').value;
  clr('add-error');
  if (!url.startsWith('http')) return setErr('add-error', 'Bitte eine gültige URL eingeben');
  if (visibility === 'group' && !visGrp) return setErr('add-error', 'Bitte eine Gruppe wählen');
  const btnText = $id('add-btn-text'), spinner = $id('add-btn-spinner'), btn = $id('add-listing-btn');
  btnText.style.display = 'none'; spinner.style.display = 'inline'; btn.disabled = true;
  const d = await api('/api/listings/add', { method:'POST', body:{
    url, visibility, visibility_id: visibility === 'group' ? visGrp : null,
  }});
  btnText.style.display = 'inline'; spinner.style.display = 'none'; btn.disabled = false;
  if (d.error) return setErr('add-error', d.error);
  $id('listing-url').value = '';
  $id('preview-card').innerHTML = '';
  $id('preview-card').appendChild(buildListCard(d.listing));
  $id('add-preview').style.display = '';
  toast('✅ Inserat hinzugefügt!');
  state.swipeQueue = [];
  loadMyAddedListings();
});

// Show/hide group selector based on visibility choice (manual add page)
$id('add-visibility').addEventListener('change', () => {
  const isGroup = $id('add-visibility').value === 'group';
  $id('add-visibility-group-row').style.display = isGroup ? '' : 'none';
});

function populateAddGroupSelect() {
  const sel = $id('add-visibility-group');
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  state.groups.forEach(g => {
    const o = document.createElement('option');
    o.value = g.id; o.textContent = g.name;
    sel.appendChild(o);
  });
}

// History of listings the current user has manually added
async function loadMyAddedListings() {
  populateAddGroupSelect();
  const d = await api('/api/listings/mine');
  const list  = $id('my-added-list');
  const empty = $id('my-added-empty');
  if (!list) return;
  list.innerHTML = '';
  const listings = d.listings || [];
  if (!listings.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  listings.forEach(l => list.appendChild(buildListCard(l)));
}

// ══════════════════════════════════════════════════════════
//  RATED
// ══════════════════════════════════════════════════════════
let _ratedAll = [];

async function loadRated() {
  const d = await api('/api/listings/rated');
  _ratedAll = d.listings || [];
  renderRated();
}

function renderRated() {
  const list   = $id('rated-list');
  const empty  = $id('rated-empty');
  const filter = state.ratedFilter;
  const items  = filter === 'all' ? _ratedAll : _ratedAll.filter(l => l.my_swipe === filter);
  list.innerHTML = '';
  if (!items.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  items.forEach(l => list.appendChild(buildListCard(l)));
}

document.getElementById('rated-filter').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.ratedFilter = btn.dataset.filter;
  renderRated();
});

// ══════════════════════════════════════════════════════════
//  GROUPS
// ══════════════════════════════════════════════════════════
async function loadGroups() {
  const d = await api('/api/groups/mine');
  state.groups = d.groups || [];
  renderGroups();
}

function renderGroups() {
  const grid = $id('groups-list');
  grid.innerHTML = '';
  if (!state.groups.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>Noch keine Gruppen.</p><p class="empty-sub">Erstelle eine oder tritt bei.</p></div>';
    return;
  }
  state.groups.forEach(g => {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.innerHTML = `
      <div class="group-card-name">${esc(g.name)}</div>
      <div class="group-card-meta">
        <span>${g.member_count} ${g.member_count===1?'Mitglied':'Mitglieder'}</span>
        <span class="group-code" data-code="${esc(g.invite_code)}">${esc(g.invite_code)}</span>
      </div>`;
    card.querySelector('.group-code').addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard?.writeText(g.invite_code).then(() => toast('📋 Code kopiert!'));
    });
    card.addEventListener('click', () => openGroupDetail(g));
    grid.appendChild(card);
  });
}

async function openGroupDetail(group) {
  $id('groups-main').style.display   = 'none';
  $id('group-detail').style.display  = '';

  // Load swipe status in parallel
  const [{ members = [] }, { results = [], memberCount = 0 }, { status: swipeStatus = [] }] = await Promise.all([
    api(`/api/groups/${group.id}/members`),
    api(`/api/groups/${group.id}/results`),
    api(`/api/groups/${group.id}/swipe-status`),
  ]);

  // Build members section with nudge buttons
  const myId = state.user?.userId;
  const membersHtml = members.map(m => {
    const sw = swipeStatus.find(s => s.id === m.id);
    const isMe = m.id === myId;
    const pendingCount = sw?.pending ?? '?';
    const doneCount    = sw?.swiped  ?? 0;
    const allDone      = sw && sw.pending === 0;
    const statusColor  = allDone ? 'var(--like)' : pendingCount > 10 ? 'var(--dislike)' : 'var(--accent)';

    return `
      <div class="member-card">
        <div class="member-card-avatar">${esc(m.username.charAt(0).toUpperCase())}</div>
        <div class="member-card-info">
          <span class="member-card-name">${esc(m.username)}${isMe ? ' <span class="you-badge">(du)</span>' : ''}</span>
          <span class="member-card-status" style="color:${statusColor}">
            ${allDone ? '✓ Alle geswiped' : `${pendingCount} noch offen`}
          </span>
        </div>
        ${!isMe ? `<button class="nudge-btn" data-nudge="${m.id}" data-name="${esc(m.username)}" title="${esc(m.username)} erinnern zu swipen">👋</button>` : ''}
      </div>`;
  }).join('');

  const tiers = ['einstimmig','mehrheitlich','gespalten','abgelehnt'];
  const tierLabels = {
    einstimmig:   '🎉 Volle Zustimmung',
    mehrheitlich: '👍 Mehrheitlich positiv',
    gespalten:    '🤔 Gespalten',
    abgelehnt:    '👎 Abgelehnt',
  };

  const tierSections = tiers.map(tier => {
    const items = results.filter(r => r.tier === tier);
    if (!items.length) return '';
    const cards = items.map(r => {
      const imgs    = (() => { try { return JSON.parse(r.images_json||'[]'); } catch { return []; } })();
      const hasImg  = imgs[0]?.startsWith('http');
      const cold    = (r.price_cold||'').trim();
      const total   = (r.price||'').trim();
      const voteChips = r.votes.map(v =>
        `<span class="vote-chip ${v.action}">${esc(v.username)}: ${v.action==='like'?'♥':v.action==='superlike'?'⭐':'✕'}</span>`
      ).join('');
      const myChip = r.my_swipe
        ? `<div class="swipe-badge ${r.my_swipe}" style="margin-top:5px">${{like:'♥ Dein Like',superlike:'⭐ Dein Super',dislike:'✕ Dein Nein'}[r.my_swipe]}</div>`
        : '';
      const rateLabel = { like:'♥ Like', superlike:'⭐ Super-Like', dislike:'✕ Nein', '':'Bewerten…' };
      const curRating = r.my_swipe || '';
      return `
        <div class="group-listing-card" data-listing-id="${r.id}">
          <button class="card-menu-btn group-card-menu-btn" data-menu-toggle title="Optionen">⋮</button>
          <div class="card-menu" data-menu style="display:none">
            <div class="card-menu-section-label">Bewertung ändern</div>
            <button data-rerate-action="like"      data-listing="${r.id}">♥ Like</button>
            <button data-rerate-action="superlike" data-listing="${r.id}">⭐ Super-Like</button>
            <button data-rerate-action="dislike"   data-listing="${r.id}">✕ Nein</button>
            <button data-rerate-action="remove"    data-listing="${r.id}">↩ Zurückziehen</button>
            <div class="card-menu-divider"></div>
            <button data-contact-toggle data-listing="${r.id}">
              ${r.group_contacted ? '✓ Angeschrieben (Notiz bearbeiten)' : '📬 Als angeschrieben markieren'}
            </button>
          </div>
          ${hasImg
            ? `<img class="group-listing-img" src="${esc(imgs[0])}" onclick="window.__lb && window.__lb.open(${JSON.stringify(imgs).replace(/"/g,'&quot;')})" style="cursor:pointer" />`
            : `<div class="group-listing-img-placeholder">🏠</div>`}
          <div class="group-listing-info">
            <div class="group-listing-title">${esc(r.title||'Inserat')}</div>
            <div class="group-listing-meta">
              ${cold  ? `<strong>${esc(cold)}</strong> kalt &nbsp;` : total ? `<strong>${esc(total)}</strong> &nbsp;` : ''}
              ${r.size     ? `📐 ${esc(r.size)} &nbsp;` : ''}
              ${r.rooms    ? `🚪 ${esc(r.rooms)} Zi. &nbsp;` : ''}
              ${r.location ? `📍 ${esc(r.location)}` : ''}
            </div>
            <div class="vote-chips">${voteChips}</div>
            ${myChip}
            <div class="contacted-badge" data-contacted-badge style="${r.group_contacted ? '' : 'display:none'}">
              📬 Angeschrieben<span data-contacted-note>${r.group_contact_note ? ' · ' + esc(r.group_contact_note.substring(0,40)) : ''}</span>
            </div>
            <div class="contact-note-wrap" data-note-wrap>
              <textarea class="contact-note" placeholder="Notiz (optional): Wann kontaktiert, Antwort, etc." data-note-text>${esc(r.group_contact_note || '')}</textarea>
              <div class="contact-note-actions">
                <button class="contact-note-save" data-note-save data-listing="${r.id}">Speichern</button>
                <button data-note-cancel>Abbrechen</button>
              </div>
            </div>
            <a href="${esc(r.url)}" target="_blank" rel="noopener" style="font-size:.73rem;color:var(--accent);display:block;margin-top:5px">Inserat öffnen →</a>
          </div>
        </div>`;
    }).join('');
    return `<div class="tier-section">
      <div class="tier-header tier-${tier}">${tierLabels[tier]} <span style="opacity:.6;font-size:.75rem">(${items.length})</span></div>
      ${cards}
    </div>`;
  }).join('');

  $id('group-detail-content').innerHTML = `
    <div class="group-detail-header">
      <div class="group-detail-name">${esc(group.name)}</div>
      <div class="invite-row">
        <span style="font-size:.8rem;color:var(--text2)">Einladungscode:</span>
        <span class="invite-code-big">${esc(group.invite_code)}</span>
        <button class="btn-ghost" style="padding:5px 10px;font-size:.76rem" onclick="navigator.clipboard?.writeText('${esc(group.invite_code)}').then(()=>window.__toast('📋 Kopiert!'))">📋</button>
      </div>
    </div>
    <p class="section-label">Mitglieder</p>
    <div class="members-nudge-list" style="margin-bottom:18px">${membersHtml}</div>
    ${results.length
      ? `<p class="section-label">${memberCount} Mitglieder · ${results.length} gemeinsam bewertet</p>${tierSections}`
      : '<p style="color:var(--text2);font-size:.85rem">Noch keine Bewertungen in dieser Gruppe.</p>'}
  `;
  window.__toast = toast;
  window.__lb    = lb;

  // Wire nudge buttons
  $id('group-detail-content').querySelectorAll('[data-nudge]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid  = parseInt(btn.dataset.nudge);
      const name = btn.dataset.name;
      btn.disabled = true;
      btn.textContent = '⏳';
      const r = await api(`/api/groups/${group.id}/nudge/${uid}`, { method: 'POST' });
      if (r.success) {
        toast(`👋 ${name} erinnert!`);
        btn.textContent = '✓';
        setTimeout(() => { btn.disabled = false; btn.textContent = '👋'; }, 30000);
      } else {
        toast('❌ ' + (r.error || 'Fehler'));
        btn.disabled = false; btn.textContent = '👋';
      }
    });
  });


  // IMPORTANT: openGroupDetail() can be called multiple times (after re-rate,
  // contact-mark etc.). We must remove the previous click listeners before
  // adding new ones, otherwise they accumulate and fight each other
  // (old listeners call closeAllCardMenus() and immediately close the menu
  // that the new listener just opened).
  //
  // We use an AbortController: each call aborts the previous controller,
  // which removes all listeners registered with that signal.
  if (window.__groupDetailAbort) {
    window.__groupDetailAbort.abort();
  }
  const abortCtrl = new AbortController();
  window.__groupDetailAbort = abortCtrl;
  const sig = abortCtrl.signal;

  const detailEl = $id('group-detail-content');

  detailEl.addEventListener('click', async e => {
    // Open/close the menu
    const menuToggle = e.target.closest('[data-menu-toggle]');
    if (menuToggle) {
      e.stopPropagation();
      const menu = menuToggle.nextElementSibling;
      closeAllCardMenus(menu);
      menu.style.display = menu.style.display === 'none' ? '' : 'none';
      return;
    }

    // Re-rate action chosen from the menu
    const rerateBtn = e.target.closest('[data-rerate-action]');
    if (rerateBtn) {
      e.stopPropagation();
      const action = rerateBtn.dataset.rerateAction;
      const lid    = parseInt(rerateBtn.dataset.listing);
      const menu   = rerateBtn.closest('.card-menu');
      menu.style.display = 'none';

      if (action === 'remove') {
        await api(`/api/listings/swipe/${lid}`, { method: 'DELETE' });
        toast('↩ Bewertung zurückgezogen');
      } else {
        await api('/api/listings/swipe', { method: 'POST', body: { listingId: lid, action } });
        const labels = { like:'💚 Like gesetzt', superlike:'⭐ Super-Like gesetzt', dislike:'✕ Abgelehnt' };
        toast(labels[action] || '✓ Gespeichert');
      }

      // Reload results after a short delay so tiers update
      setTimeout(() => openGroupDetail(group), 600);
      return;
    }

    // Contact toggle chosen from the menu
    const contactToggle = e.target.closest('[data-contact-toggle]');
    if (contactToggle) {
      e.stopPropagation();
      const lid    = parseInt(contactToggle.dataset.listing);
      const card   = detailEl.querySelector(`.group-listing-card[data-listing-id="${lid}"]`);
      const menu   = contactToggle.closest('.card-menu');
      const badge  = card?.querySelector('[data-contacted-badge]');
      const isContacted = badge && badge.style.display !== 'none';
      menu.style.display = 'none';

      if (!isContacted) {
        const r = await api('/api/contacts', { method: 'POST', body: { listingId: lid, groupId: group.id, note: '' } });
        if (r.success) {
          toast('📬 Als angeschrieben markiert');
          if (badge) badge.style.display = '';
          contactToggle.textContent = '✓ Angeschrieben (Notiz bearbeiten)';
          card?.querySelector('[data-note-wrap]')?.classList.add('open');
        }
      } else {
        card?.querySelector('[data-note-wrap]')?.classList.toggle('open');
      }
      return;
    }

    // Save note
    const noteSave = e.target.closest('[data-note-save]');
    if (noteSave) {
      e.stopPropagation();
      const lid     = parseInt(noteSave.dataset.listing);
      const card    = detailEl.querySelector(`.group-listing-card[data-listing-id="${lid}"]`);
      const noteVal = card?.querySelector('[data-note-text]')?.value || '';
      await api(`/api/contacts/${lid}`, { method: 'PATCH', body: { note: noteVal, groupId: group.id } });
      card?.querySelector('[data-note-wrap]')?.classList.remove('open');
      const noteSpan = card?.querySelector('[data-contacted-note]');
      if (noteSpan) noteSpan.textContent = noteVal ? ' · ' + noteVal.substring(0, 40) : '';
      toast('✓ Notiz gespeichert');
      return;
    }

    // Cancel note edit
    const noteCancel = e.target.closest('[data-note-cancel]');
    if (noteCancel) {
      e.stopPropagation();
      noteCancel.closest('[data-note-wrap]')?.classList.remove('open');
      return;
    }

    // Click elsewhere inside the panel closes any open menu
    closeAllCardMenus();
  }, { signal: sig });

  // Outside-click closes any open menu – also cleaned up via AbortController
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-menu-toggle]') && !e.target.closest('.card-menu')) {
      closeAllCardMenus();
    }
  }, { signal: sig });
}

$id('back-to-groups').addEventListener('click', () => {
  // Clean up group-detail event listeners
  if (window.__groupDetailAbort) {
    window.__groupDetailAbort.abort();
    window.__groupDetailAbort = null;
  }
  $id('group-detail').style.display = 'none';
  $id('groups-main').style.display  = '';
  $id('group-detail-content').innerHTML = '';
});

// Group modals
$id('create-group-btn').addEventListener('click', () => {
  $id('new-group-name').value = ''; clr('create-group-error');
  $id('create-group-modal').style.display = 'flex';
});
$id('cancel-create').onclick = () => { $id('create-group-modal').style.display='none'; };
$id('confirm-create').addEventListener('click', async () => {
  const name = $id('new-group-name').value.trim();
  if (!name) return setErr('create-group-error', 'Name erforderlich');
  const d = await api('/api/groups/create', { method:'POST', body:{ name } });
  if (d.error) return setErr('create-group-error', d.error);
  $id('create-group-modal').style.display = 'none';
  toast(`🎉 Gruppe erstellt! Code: ${d.group.invite_code}`);
  await loadGroups();
});

$id('join-group-btn').addEventListener('click', () => {
  $id('join-code').value = ''; clr('join-group-error');
  $id('join-group-modal').style.display = 'flex';
});
$id('cancel-join').onclick = () => { $id('join-group-modal').style.display='none'; };
$id('confirm-join').addEventListener('click', async () => {
  const code = $id('join-code').value.trim();
  if (!code) return setErr('join-group-error', 'Code eingeben');
  const d = await api('/api/groups/join', { method:'POST', body:{ code } });
  if (d.error) return setErr('join-group-error', d.error);
  $id('join-group-modal').style.display = 'none';
  toast(`✅ Gruppe "${d.group.name}" beigetreten!`);
  await loadGroups();
});

document.querySelectorAll('.modal').forEach(m =>
  m.addEventListener('click', e => { if (e.target===m) m.style.display='none'; })
);

// ══════════════════════════════════════════════════════════
//  JOBS (Suchagenten)
// ══════════════════════════════════════════════════════════
async function loadJobs() {
  const d = await api('/api/jobs');
  populateJobGroupSelect();
  renderJobs(d.jobs || []);
}

function renderJobs(jobs) {
  const list  = $id('jobs-list');
  const empty = $id('jobs-empty');
  list.innerHTML = '';
  if (!jobs.length) { empty.style.display=''; return; }
  empty.style.display = 'none';
  jobs.forEach(job => list.appendChild(buildJobCard(job)));
}

function buildJobCard(job) {
  const div = document.createElement('div');
  div.className = 'job-card' + (job.active ? '' : ' paused');
  const status = job.last_error ? 'error' : job.active ? 'active' : 'paused';
  const statusLabel = { error:'Fehler', active:'Aktiv', paused:'Pausiert' }[status];
  const visLabel = { global:'🌐 Alle', private:'🔒 Nur ich', group:'👥 Gruppe' }[job.visibility||'global'];
  const lastRun = job.last_run
    ? new Date(job.last_run+'Z').toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
    : 'noch nie';
  const nextDue = job.last_run && job.active ? (() => {
    const d = Math.round((new Date(job.last_run+'Z').getTime() + job.interval_min*60000 - Date.now()) / 60000);
    return d > 0 ? `in ${d} Min.` : 'jetzt fällig';
  })() : job.active ? 'bald' : '—';

  div.innerHTML = `
    <div class="job-card-top">
      <div class="job-card-info">
        <div class="job-card-label">${esc(job.label)}</div>
        <div class="job-card-url">${esc(job.search_url)}</div>
        <div class="job-badges">
          <span class="job-badge platform-${esc(job.platform)}">${esc(job.platform)}</span>
          <span class="job-badge status-${status}">${statusLabel}</span>
          <span class="job-badge" style="color:var(--text2)">${visLabel}</span>
        </div>
      </div>
    </div>
    ${job.last_error ? `<div class="job-error">⚠ ${esc(job.last_error)}</div>` : ''}
    <div class="job-stats">
      <span><strong>${job.last_new??0}</strong> neue beim letzten Lauf</span>
      <span><strong>${job.total_found??0}</strong> gesamt gefunden</span>
      <span>Zuletzt: <strong>${lastRun}</strong></span>
      <span>Nächster: <strong>${nextDue}</strong></span>
    </div>
    <div class="job-interval-row">
      Intervall:
      <input class="interval-input" type="number" value="${job.interval_min}" min="10" max="1440" />
      Min
      <button class="btn-ghost" style="padding:3px 8px;font-size:.72rem" data-save-iv>Speichern</button>
    </div>
    <div class="job-actions">
      <button class="btn-run"           data-run>⟳ Jetzt abrufen</button>
      <button class="btn-toggle ${job.active?'on':''}" data-toggle>${job.active?'⏸ Pausieren':'▶ Aktivieren'}</button>
      <button class="btn-vis"           data-vis>🔒 Sichtbarkeit</button>
      <button class="btn-listings"      data-listings-toggle>📋 Inserate anzeigen</button>
      <button class="btn-del"           data-del>🗑 Löschen</button>
    </div>
    <div class="job-listings-panel" style="display:none" data-listings-panel>
      <div class="job-listings-grid listings-grid" data-listings-grid></div>
    </div>
    <div class="vis-panel" style="display:none" data-vis-panel>
      <div class="vis-panel-inner">
        <span style="font-size:.78rem;color:var(--text2)">Wer sieht diese Inserate?</span>
        <div class="vis-options">
          <label class="vis-option ${(job.visibility||'global')==='global'?'active':''}">
            <input type="radio" name="vis_${job.id}" value="global" ${(job.visibility||'global')==='global'?'checked':''} /> 🌐 Alle Nutzer
          </label>
          <label class="vis-option ${job.visibility==='private'?'active':''}">
            <input type="radio" name="vis_${job.id}" value="private" ${job.visibility==='private'?'checked':''} /> 🔒 Nur ich
          </label>
          <label class="vis-option ${job.visibility==='group'?'active':''}">
            <input type="radio" name="vis_${job.id}" value="group" ${job.visibility==='group'?'checked':''} /> 👥 Gruppe
          </label>
        </div>
        <select class="vis-group-sel" style="${job.visibility==='group'?'':'display:none'}">
          <option value="">Gruppe wählen…</option>
          ${state.groups.map(g=>`<option value="${g.id}" ${job.visibility_id==g.id?'selected':''}>${esc(g.name)}</option>`).join('')}
        </select>
        <button class="btn-vis-save" data-vis-save>Speichern</button>
      </div>
    </div>`;

  div.querySelector('[data-listings-toggle]').addEventListener('click', async () => {
    const panel = div.querySelector('[data-listings-panel]');
    const grid  = div.querySelector('[data-listings-grid]');
    const btn   = div.querySelector('[data-listings-toggle]');
    const isOpen = panel.style.display !== 'none';
    if (isOpen) { panel.style.display = 'none'; return; }

    panel.style.display = '';
    btn.textContent = '⏳ Lädt…';
    const d = await api(`/api/jobs/${job.id}/listings`);
    btn.textContent = '📋 Inserate anzeigen';
    grid.innerHTML = '';
    const listings = d.listings || [];
    if (!listings.length) {
      grid.innerHTML = '<p style="font-size:.82rem;color:var(--text2);grid-column:1/-1">Noch keine Inserate von diesem Suchagenten gefunden.</p>';
      return;
    }
    listings.forEach(l => grid.appendChild(buildListCard(l)));
  });

  div.querySelector('[data-run]').addEventListener('click', async () => {
    const btn = div.querySelector('[data-run]');
    btn.disabled = true; btn.textContent = '⟳ Lädt…';
    const r = await api(`/api/jobs/${job.id}/run`, { method:'POST' });
    toast(r.message || '⟳ Job gestartet');
    btn.disabled = false; btn.textContent = '⟳ Jetzt abrufen';
    setTimeout(() => loadJobs(), 3000);
  });
  div.querySelector('[data-toggle]').addEventListener('click', async () => {
    await api(`/api/jobs/${job.id}/toggle`, { method:'PATCH' });
    toast(job.active ? '⏸ Pausiert' : '▶ Aktiviert');
    loadJobs();
  });
  // Visibility toggle
  div.querySelector('[data-vis]').addEventListener('click', () => {
    const panel = div.querySelector('[data-vis-panel]');
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
  });

  // Show/hide group select when radio changes
  div.querySelectorAll(`input[name="vis_${job.id}"]`).forEach(radio => {
    radio.addEventListener('change', () => {
      const grpSel = div.querySelector('.vis-group-sel');
      grpSel.style.display = radio.value === 'group' ? '' : 'none';
      // Update active class
      div.querySelectorAll('.vis-option').forEach(o => o.classList.remove('active'));
      radio.closest('.vis-option').classList.add('active');
    });
  });

  // Save visibility
  div.querySelector('[data-vis-save]').addEventListener('click', async () => {
    const radio  = div.querySelector(`input[name="vis_${job.id}"]:checked`);
    const vis    = radio?.value || 'global';
    const grpSel = div.querySelector('.vis-group-sel');
    const grpId  = vis === 'group' ? grpSel.value : null;
    if (vis === 'group' && !grpId) { toast('⚠️ Bitte eine Gruppe wählen'); return; }
    const r = await api(`/api/jobs/${job.id}/visibility`, { method:'PATCH', body:{ visibility:vis, visibility_id:grpId } });
    if (r.success) { toast('✅ Sichtbarkeit gespeichert'); setTimeout(loadJobs, 300); }
    else toast('❌ ' + (r.error||'Fehler'));
  });

  div.querySelector('[data-del]').addEventListener('click', async () => {
    if (!confirm(`Suchagent "${job.label}" löschen?`)) return;
    await api(`/api/jobs/${job.id}`, { method:'DELETE' });
    div.style.opacity='0'; div.style.transition='opacity .3s';
    setTimeout(() => { div.remove(); loadJobs(); }, 280);
    toast('🗑 Suchagent gelöscht');
  });
  div.querySelector('[data-save-iv]').addEventListener('click', async () => {
    const iv = parseInt(div.querySelector('.interval-input').value)||60;
    const r = await api(`/api/jobs/${job.id}/interval`, { method:'PATCH', body:{ interval_min:iv } });
    if (r.success) toast(`✅ Intervall: ${r.interval_min} Min.`);
    loadJobs();
  });
  return div;
}

$id('job-add-btn').addEventListener('click', async () => {
  const label      = $id('job-label').value.trim();
  const url        = $id('job-url').value.trim();
  const iv         = parseInt($id('job-interval').value)||60;
  const visibility = $id('job-visibility').value;
  const visGrp     = $id('job-visibility-group').value;
  clr('job-error');
  if (!label) return setErr('job-error', 'Bezeichnung erforderlich');
  if (!url.startsWith('http')) return setErr('job-error', 'Gültige Such-URL erforderlich');
  if (visibility === 'group' && !visGrp) return setErr('job-error', 'Bitte eine Gruppe wählen');
  const btnText=$id('job-add-text'), spinner=$id('job-add-spinner'), btn=$id('job-add-btn');
  btnText.style.display='none'; spinner.style.display='inline'; btn.disabled=true;
  const d = await api('/api/jobs', { method:'POST', body:{
    label, search_url:url, interval_min:iv,
    visibility, visibility_id: visibility==='group' ? visGrp : null
  }});
  btnText.style.display='inline'; spinner.style.display='none'; btn.disabled=false;
  if (d.error) return setErr('job-error', d.error);
  $id('job-label').value = ''; $id('job-url').value = '';
  toast('✅ Suchagent hinzugefügt – erster Lauf startet in Kürze');
  api(`/api/jobs/${d.job.id}/run`, { method:'POST' }).then(() => setTimeout(loadJobs, 4000));
  loadJobs();
});

// Show/hide group selector based on visibility choice
$id('job-visibility').addEventListener('change', () => {
  const isGroup = $id('job-visibility').value === 'group';
  $id('job-visibility-group-row').style.display = isGroup ? '' : 'none';
});

function populateJobGroupSelect() {
  const sel = $id('job-visibility-group');
  while (sel.options.length > 1) sel.remove(1);
  state.groups.forEach(g => {
    const o = document.createElement('option');
    o.value = g.id; o.textContent = g.name;
    sel.appendChild(o);
  });
}

// ══════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════
async function loadSettings() {
  const me = await api('/api/auth/me');
  if (!me.loggedIn) return;
  const ch = s => s.charAt(0).toUpperCase();
  $id('settings-avatar').textContent       = ch(me.username||'?');
  $id('settings-display-name').textContent  = me.username||'—';
  $id('settings-display-email').textContent = me.email||'—';
  if (me.created_at)
    $id('settings-display-since').textContent = 'Mitglied seit ' +
      new Date(me.created_at).toLocaleDateString('de-DE',{year:'numeric',month:'long',day:'numeric'});
  $id('settings-username').value  = me.username||'';
  $id('settings-email').value     = me.email||'';
  clr('settings-username-error','settings-username-ok','settings-email-error','settings-email-ok','settings-pw-error','settings-pw-ok','notify-ok','ntfy-ok');
  $id('settings-pw-current').value = $id('settings-pw-new').value = $id('settings-pw-confirm').value = '';

  // Notification toggles
  $id('notify-email').checked = !!me.notify_email;
  $id('notify-match').checked = !!me.notify_match;
  $id('notify-new').checked   = !!me.notify_new;

  // ntfy fields
  $id('ntfy-topic').value  = me.ntfy_topic  || '';
  $id('ntfy-server').value = me.ntfy_server || '';

  // Threshold
  $id('notify-threshold').value = me.notify_threshold || 1;

  // Digest interval buttons
  const interval = me.notify_digest_interval || 'instant';
  document.querySelectorAll('.digest-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.interval === interval);
  });

  // Stats
  const s = await api('/api/auth/stats');
  $id('stat-likes').textContent      = s.likes      ?? '—';
  $id('stat-superlikes').textContent = s.superlikes ?? '—';
  $id('stat-dislikes').textContent   = s.dislikes   ?? '—';
  $id('stat-groups').textContent     = s.groups     ?? '—';

  // Push button state
  await updatePushButtonState();

  // Admin section
  const adminSection = $id('admin-section');
  if (adminSection) adminSection.style.display = me.is_admin ? '' : 'none';
}

$id('save-username-btn').addEventListener('click', async () => {
  clr('settings-username-error','settings-username-ok');
  const d = await api('/api/user/username', { method:'PUT', body:{ username:$id('settings-username').value.trim() } });
  if (d.error) return setErr('settings-username-error', d.error);
  $id('nav-username').textContent = d.username;
  $id('settings-display-name').textContent = d.username;
  $id('settings-avatar').textContent = d.username.charAt(0).toUpperCase();
  setOk('settings-username-ok','✓ Gespeichert'); toast('✅ Username geändert');
});

$id('save-email-btn').addEventListener('click', async () => {
  clr('settings-email-error','settings-email-ok');
  const d = await api('/api/user/email', { method:'PUT', body:{ email:$id('settings-email').value.trim() } });
  if (d.error) return setErr('settings-email-error', d.error);
  $id('settings-display-email').textContent = $id('settings-email').value.trim();
  setOk('settings-email-ok','✓ Gespeichert'); toast('✅ E-Mail geändert');
});

$id('save-password-btn').addEventListener('click', async () => {
  clr('settings-pw-error','settings-pw-ok');
  const cur = $id('settings-pw-current').value;
  const nw  = $id('settings-pw-new').value;
  const cf  = $id('settings-pw-confirm').value;
  if (!cur)         return setErr('settings-pw-error','Aktuelles Passwort eingeben');
  if (nw.length<6)  return setErr('settings-pw-error','Neues Passwort mind. 6 Zeichen');
  if (nw !== cf)    return setErr('settings-pw-error','Passwörter stimmen nicht überein');
  const d = await api('/api/user/password', { method:'PUT', body:{ currentPassword:cur, newPassword:nw } });
  if (d.error) return setErr('settings-pw-error', d.error);
  $id('settings-pw-current').value = $id('settings-pw-new').value = $id('settings-pw-confirm').value = '';
  setOk('settings-pw-ok','✓ Passwort geändert'); toast('✅ Passwort geändert');
});

// Notification toggles save on change
['notify-email','notify-match','notify-new'].forEach(id => {
  $id(id).addEventListener('change', saveNotifySettings);
});

// Digest interval buttons
document.querySelectorAll('.digest-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.digest-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    saveNotifySettings();
  });
});

// ntfy save button
$id('save-ntfy-btn').addEventListener('click', async () => {
  clr('ntfy-ok');
  const d = await api('/api/user/notifications', { method:'PUT', body:{
    notify_email: $id('notify-email').checked ? 1 : 0,
    notify_push:  1,
    notify_match: $id('notify-match').checked ? 1 : 0,
    notify_new:   $id('notify-new').checked   ? 1 : 0,
    notify_digest_interval: document.querySelector('.digest-btn.active')?.dataset.interval || 'instant',
    ntfy_topic:       $id('ntfy-topic').value.trim(),
    ntfy_server:      $id('ntfy-server').value.trim(),
    notify_threshold: parseInt($id('notify-threshold')?.value) || 1,
  }});
  if (d.success) { setOk('ntfy-ok','✓ Gespeichert'); toast('✅ ntfy gespeichert'); }
});

async function saveNotifySettings() {
  const d = await api('/api/user/notifications', { method:'PUT', body:{
    notify_email:           $id('notify-email').checked ? 1 : 0,
    notify_push:            1,
    notify_match:           $id('notify-match').checked ? 1 : 0,
    notify_new:             $id('notify-new').checked   ? 1 : 0,
    notify_digest_interval: document.querySelector('.digest-btn.active')?.dataset.interval || 'instant',
    ntfy_topic:             $id('ntfy-topic').value.trim(),
    ntfy_server:            $id('ntfy-server').value.trim(),
    notify_threshold:       parseInt($id('notify-threshold')?.value) || 1,
  }});
  if (d.success) setOk('notify-ok','✓ Gespeichert');
}

// ── Web Push ──────────────────────────────────────────────
async function updatePushButtonState() {
  const btn = $id('push-toggle-btn');
  const txt = $id('push-status-text');
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    txt.textContent = 'Nicht unterstützt von diesem Browser'; btn.style.display='none'; return;
  }
  const reg = await navigator.serviceWorker.getRegistration().catch(()=>null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(()=>null) : null;
  if (sub) {
    txt.textContent = '✓ Aktiviert'; btn.textContent = 'Deaktivieren';
  } else {
    txt.textContent = 'Nicht aktiviert'; btn.textContent = 'Aktivieren';
  }
}

$id('push-toggle-btn').addEventListener('click', async () => {
  const { publicKey } = await api('/api/push/vapid-key');
  if (!publicKey) {
    toast('⚠️ Push-Benachrichtigungen nicht konfiguriert'); return;
  }
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription().catch(()=>null);
  if (existing) {
    await existing.unsubscribe();
    await api('/api/push/unsubscribe', { method:'POST', body:{ endpoint: existing.endpoint } });
    toast('🔕 Browser-Benachrichtigungen deaktiviert');
  } else {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('❌ Benachrichtigungen nicht erlaubt'); return; }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await api('/api/push/subscribe', { method:'POST', body:{
      endpoint: sub.endpoint,
      keys: { p256dh: arrayBufferToBase64(sub.getKey('p256dh')), auth: arrayBufferToBase64(sub.getKey('auth')) }
    }});
    toast('🔔 Browser-Benachrichtigungen aktiviert');
  }
  await updatePushButtonState();
});

function urlBase64ToUint8Array(b64) {
  const p = (b64+'='.repeat((4-b64.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');
  const r = atob(p); const o = new Uint8Array(r.length);
  for (let i=0;i<r.length;++i) o[i]=r.charCodeAt(i);
  return o;
}
function arrayBufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

// ── Service Worker (für Push) ─────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}



// (markGroupContacted prompt()-based helper removed — contact marking now
//  lives inside the unified card-menu, wired directly in openGroupDetail())

// ══════════════════════════════════════════════════════════
//  ARCHIVE
// ══════════════════════════════════════════════════════════
let _archiveAll = [];
let _archiveFilter = 'all';

async function loadArchive() {
  const d = await api('/api/archive');
  _archiveAll = d.listings || [];
  renderArchive();
}

function renderArchive() {
  const list  = $id('archive-list');
  const empty = $id('archive-empty');
  let items = _archiveAll;
  if (_archiveFilter === 'contacted') {
    items = items.filter(l => l.contacted);
  } else if (_archiveFilter !== 'all') {
    items = items.filter(l => l.my_swipe === _archiveFilter);
  }
  list.innerHTML = '';
  if (!items.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  items.forEach(l => {
    const card = buildListCard({ ...l, contact_note: l.contact_note }, { isArchive: true });
    card.classList.add('archived');
    list.appendChild(card);
  });
}

$id('archive-filter')?.addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  $id('archive-filter').querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _archiveFilter = btn.dataset.filter;
  renderArchive();
});


// ══════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════
$id('admin-users-btn')?.addEventListener('click', async () => {
  const panel = $id('admin-users-panel');
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const { users = [] } = await api('/api/admin/users');
  const list = $id('admin-users-list');
  list.innerHTML = '';
  users.forEach(u => {
    const row = document.createElement('div');
    row.className = 'admin-user-row';
    row.innerHTML = `
      <div class="admin-user-info">
        <span class="admin-user-name">${esc(u.username)}</span>
        <span class="admin-user-email">${esc(u.email)}</span>
        ${u.is_admin ? '<span class="admin-badge">Admin</span>' : ''}
      </div>
      <div class="admin-user-actions">
        ${!u.is_admin
          ? `<button class="btn-ghost" style="font-size:.75rem;padding:4px 10px" data-promote="${u.id}">↑ Admin machen</button>`
          : `<button class="btn-ghost" style="font-size:.75rem;padding:4px 10px;color:var(--dislike)" data-demote="${u.id}">↓ Entfernen</button>`}
      </div>`;

    row.querySelector('[data-promote]')?.addEventListener('click', async () => {
      const r = await api('/api/admin/promote', { method: 'POST', body: { targetUserId: u.id } });
      if (r.success) { toast('✓ ' + r.message); $id('admin-users-btn').click(); $id('admin-users-btn').click(); }
      else toast('❌ ' + (r.error || 'Fehler'));
    });
    row.querySelector('[data-demote]')?.addEventListener('click', async () => {
      const r = await api('/api/admin/demote', { method: 'POST', body: { targetUserId: u.id } });
      if (r.success) { toast('✓ Admin-Rechte entfernt'); $id('admin-users-btn').click(); $id('admin-users-btn').click(); }
      else toast('❌ ' + (r.error || 'Fehler'));
    });

    list.appendChild(row);
  });
});

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
(async () => {
  const me = await api('/api/auth/me');
  if (me.loggedIn) {
    state.user = { userId: me.id, username: me.username };
    $id('nav-username').textContent = me.username;
    showScreen('app-screen');
    await loadGroups();
    loadSwipeQueue();
  } else {
    showScreen('auth-screen');
  }
})();
