/**
 * nav.js – Navigation & Browser-History
 *
 * Damit die Zurück-Taste / -Geste des Handys (und des Browsers) sich so
 * verhält, wie man es von einer App erwartet:
 *
 *   • Seiten haben eine eigene Adresse (#/bewertet, #/suche, #/profil/…) und
 *     lassen sich darüber direkt öffnen und teilen.
 *   • "Zurück" schließt zuerst, was oben liegt (Vollbild-Foto, Nachrichten-
 *     Fenster, Detailansicht, Gruppen-Detail …), dann geht es eine Seite
 *     zurück – und von dort zur Swipe-Seite. Erst dort verlässt man die App.
 *   • Der Wechsel zwischen den Haupt-Tabs legt keine Kette von Einträgen an
 *     (sonst müsste man nach zehn Tab-Wechseln zehnmal zurück).
 *
 * Aufbau: Jeder History-Eintrag trägt den "Pfad" der Seiten
 * (z. B. ['swipe','me','settings']) und die Zahl der offenen Overlays.
 * Eigene history.go()-Aufrufe laufen über eine Warteschlange, damit auf
 * ein Zurück gewartet wird, bevor der nächste Eintrag gesetzt wird.
 */
(function () {
  'use strict';

  const ROUTES = {
    swipe:    '',
    rated:    '#/bewertet',
    groups:   '#/gruppen',
    jobs:     '#/suche',
    add:      '#/suche/hinzufuegen',
    archive:  '#/suche/archiv',
    me:       '#/profil',
    profile:  '#/profil/bewerber',
    settings: '#/profil/einstellungen',
  };
  const BY_ROUTE = Object.fromEntries(Object.entries(ROUTES).map(([v, r]) => [r, v]));
  // Unterseiten: gehören zu einer Seite, von der aus man sie öffnet
  const PARENT = { profile: 'me', settings: 'me' };
  // ?view=… aus Push-Benachrichtigungen und älteren Links
  const LEGACY = { settings: 'settings', groups: 'groups', rated: 'rated', profile: 'profile',
                   jobs: 'jobs', search: 'jobs', add: 'add', archive: 'archive', more: 'me', me: 'me' };

  const isSub = v => v in PARENT;
  const urlFor = v => location.pathname + location.search + (ROUTES[v] || '');

  let trail = ['swipe'];          // Seiten von "Start" bis zur aktuellen
  let current = 'swipe';          // sichtbare Seite
  let active = false;             // nur eingeloggt
  let render = () => {};

  const overlays = [];            // registrierte Overlays {el?, isOpen, close}
  const stack = [];               // gerade offene, in Öffnungsreihenfolge
  const silent = new Set();       // werden gerade durch "Zurück" geschlossen

  // ── Warteschlange für History-Aufrufe ─────────────────────
  const queue = [];
  let busy = false, expectPop = null, timer = null, lastOwn = 0;

  function pump() {
    while (!busy && queue.length) {
      const op = queue.shift();
      lastOwn = Date.now();
      if (op.go) {
        busy = true;
        expectPop = () => { clearTimeout(timer); busy = false; expectPop = null; pump(); };
        timer = setTimeout(() => expectPop && expectPop(), 600);   // falls kein popstate kommt
        history.go(op.go);
      } else {
        op.fn();
      }
    }
  }
  const enqueue = op => { queue.push(op); pump(); };

  const snapshot = () => ({ ws: 1, trail: trail.slice(), ov: stack.length });
  const pushEntry = view => { const s = snapshot(); enqueue({ fn: () => history.pushState(s, '', urlFor(view)) }); };
  const replaceEntry = view => { const s = snapshot(); enqueue({ fn: () => history.replaceState(s, '', urlFor(view)) }); };

  // ── Overlays ──────────────────────────────────────────────
  // Gleicht die Liste der offenen Overlays mit dem Stand im DOM ab: neu geöffnete bekommen
  // einen History-Eintrag, geschlossene geben ihn wieder her.
  function sync() {
    if (!active) return;
    for (const o of overlays) {
      const open = !!o.isOpen();
      const i = stack.indexOf(o);
      if (open && i < 0) {
        stack.push(o);
        pushEntry(current);
      } else if (!open && i >= 0) {
        stack.splice(i, 1);
        if (!silent.delete(o)) enqueue({ go: -1 });
      }
    }
  }

  function register(o) {
    overlays.push(o);
    if (o.el) new MutationObserver(sync).observe(o.el, { attributes: true, attributeFilter: ['style'] });
  }

  // Schließt alle offenen Overlays, ohne dass jedes einzeln "zurück" auslöst
  function closeAllOverlays() {
    const k = stack.length;
    if (!k) return;
    for (const o of stack.slice()) { silent.add(o); try { o.close(); } catch (_) {} }
    sync();
    silent.clear();
    stack.length = 0;
    enqueue({ go: -k });
  }

  // ── Seiten ────────────────────────────────────────────────
  function show(view, opts) {
    if (!(view in ROUTES)) view = 'swipe';
    closeAllOverlays();
    if (trail[trail.length - 1] !== view) {
      if (view === 'swipe') {
        if (trail.length > 1) enqueue({ go: -(trail.length - 1) });
        trail = ['swipe'];
      } else if (isSub(view)) {
        trail.push(view);
        pushEntry(view);
      } else {
        // Hauptseite: Unterseiten darüber verschwinden, die Hauptseite darunter wird ersetzt
        let back = 0;
        while (trail.length > 1 && isSub(trail[trail.length - 1])) { trail.pop(); back++; }
        if (back) enqueue({ go: -back });
        if (trail.length === 1) { trail.push(view); pushEntry(view); }
        else if (trail[trail.length - 1] !== view) { trail[trail.length - 1] = view; replaceEntry(view); }
      }
    }
    current = view;
    render(view, opts);
  }

  // Eine Ebene hoch ("Zurück"-Knopf in der Seite). Liegt ein Overlay oben, schließt das zuerst.
  function back() {
    if (stack.length) {
      const o = stack[stack.length - 1];
      try { o.close(); } catch (_) {}      // die Beobachtung räumt den History-Eintrag auf
      return;
    }
    if (trail.length > 1) {
      trail.pop();
      enqueue({ go: -1 });
      current = trail[trail.length - 1];
      render(current, { fromHistory: true });
    } else {
      show(PARENT[current] || 'swipe');
    }
  }

  // ── Browser-Zurück / -Vor ─────────────────────────────────
  window.addEventListener('popstate', e => {
    if (expectPop) { expectPop(); return; }          // von uns selbst ausgelöst
    const s = e.state;
    if (!active || !s || !s.ws) return;
    const want = s.ov || 0;
    while (stack.length > want) {
      const o = stack[stack.length - 1];
      silent.add(o);
      try { o.close(); } catch (_) {}
      sync();
      if (stack[stack.length - 1] === o) stack.pop();   // schließt sich nicht → trotzdem aus der Liste nehmen
      silent.delete(o);
    }
    if (want > stack.length) { enqueue({ go: -(want - stack.length) }); return; }   // Vor-Taste auf ein Overlay
    trail = s.trail.slice();
    const view = trail[trail.length - 1];
    if (view !== current) { current = view; render(view, { fromHistory: true }); }
  });

  // Adresse von Hand geändert (#/suche in die Adresszeile getippt)
  window.addEventListener('hashchange', () => {
    if (!active || Date.now() - lastOwn < 400) return;
    const v = BY_ROUTE[location.hash.toLowerCase()];
    if (v && v !== current) show(v);
  });

  // ── Start ─────────────────────────────────────────────────
  function viewFromLocation() {
    const params = new URLSearchParams(location.search);
    const legacy = params.get('view');
    if (legacy) {
      params.delete('view');
      const clean = location.pathname + (params.toString() ? `?${params}` : '') + location.hash;
      history.replaceState(history.state, '', clean);
    }
    return (legacy && LEGACY[legacy]) || BY_ROUTE[location.hash.toLowerCase()] || 'swipe';
  }

  // Nach dem Login: Einstiegsseite aus der Adresse bestimmen und den Pfad dorthin aufbauen,
  // damit "Zurück" von einer direkt geöffneten Seite zur Swipe-Seite führt.
  function start() {
    const view = viewFromLocation();
    queue.length = 0; busy = false; expectPop = null;
    stack.length = 0; silent.clear();
    trail = ['swipe'];
    history.replaceState(snapshot(), '', urlFor('swipe'));
    active = true;
    const chain = view === 'swipe' ? [] : isSub(view) ? [PARENT[view], view] : [view];
    for (const v of chain) { trail.push(v); pushEntry(v); }
    current = view;
    render(view, { initial: true });
    sync();
  }

  function stop() { active = false; }

  window.nav = {
    register, show, back, start, stop, sync,
    setRenderer(fn) { render = fn; },
    get current() { return current; },
    get depth() { return trail.length - 1; },
    routes: ROUTES,
  };
})();
