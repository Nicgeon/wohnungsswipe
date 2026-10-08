/* profile.js – Bewerber-Profil (eigene Seite), Nachrichten-Generator und
 * Gruppen-Profil. Wird nach app.js geladen und nutzt dessen Helfer
 * ($id, api, toast, esc, state, showView, …). */

const PLACEHOLDER_LIST = ['titel','preis','kalt','warm','zimmer','groesse','lage','name','namen','personen','kinder',
  'beruf','wohnform','einzug','mietdauer','beschaeftigung','einkommen','haushalt','unterlagen','unterlagen_liste','grund','merkmale','telefon','erreichbarkeit'];
const PLACEHOLDER_HINT = {
  titel: 'Titel der Anzeige ohne Preisangaben', unterlagen: 'ganze Sätze, z. B. „A und B legen wir Ihnen gerne vor.“',
  unterlagen_liste: 'nur die Namen, z. B. „A, B und C“', grund: 'ganzer Satz: „Die Wohnung spricht uns besonders aufgrund … an.“',
  merkmale: 'z. B. „des Balkons und der Lage in Neustadt“ (nach „aufgrund“)',
};

const pfSvg = (paths, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const PF_ICON = {
  personal:  '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  housing:   '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  income:    '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/>',
  documents: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  about:     '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
  contact:   '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  template:  '<path d="M4 6h16M4 12h16M4 18h10"/>',
  members:   '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.8 0 4.5 1.9 4.5 4.5"/>',
  eye:       '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:    '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4"/><path d="M6.2 6.2C3.5 8 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 4-.9"/>',
  warn:      '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  info:      '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
};

const pfDesktop = () => window.matchMedia('(min-width: 1000px)').matches;

// ══════════════════════════════════════════════════════════
//  BEWERBER-PROFIL (eigene Seite)
// ══════════════════════════════════════════════════════════
const PF_SECTIONS = [
  { id: 'personal',  title: 'Persönliches',          desc: 'Wie sollen Vermieter dich ansprechen?' },
  { id: 'housing',   title: 'Wohnsituation',         desc: 'Wie wohnt ihr, wann wollt ihr einziehen? Mit dem Auge steuerst du, was in Nachrichten erscheint.' },
  { id: 'income',    title: 'Einkommen & Bonität',   desc: 'Beschäftigung und Einkommen – das Einkommen erscheint nur, wenn du es freigibst.' },
  { id: 'documents', title: 'Unterlagen',            desc: 'Was kannst du Vermietern direkt vorlegen?' },
  { id: 'about',     title: 'Über uns',              desc: 'Ein paar persönliche Sätze für die Nachricht.' },
  { id: 'contact',   title: 'Erreichbarkeit',        desc: 'Mit Telefonnummer und Besichtigungszeiten kann ein Vermieter dir direkt Termine anbieten.' },
  { id: 'template',  title: 'Eigene Vorlage',        desc: 'Optional: Schreib deinen eigenen Text mit Platzhaltern statt der geführten Nachricht.' },
];

// A group searches as "we": same page, own sections. "Mitglieder" replaces "Persönliches" — names and
// occupations are taken from the members' personal profiles, everything else is shared and edited here.
const PF_GROUP_SECTIONS = PF_SECTIONS.map(s => {
  if (s.id === 'personal') return { id: 'members', title: 'Mitglieder', desc: 'Wer sucht mit? Namen, Berufe und Beschäftigung holt die App aus den persönlichen Profilen der Mitglieder – dort pflegt sie jeder selbst.' };
  if (s.id === 'housing')  return { ...s, desc: 'Wie wohnt ihr, wann wollt ihr einziehen? Gilt für alle Nachrichten aus dieser Gruppe.' };
  if (s.id === 'income')   return { ...s, title: 'Einkommen', desc: 'Netto-Haushaltseinkommen der Gruppe – erscheint nur, wenn ihr es freigebt. Beruf und Beschäftigung kommen aus den Mitglieder-Profilen.' };
  if (s.id === 'about')    return { ...s, title: 'Über uns', desc: 'Ein paar Sätze, die euch als Gruppe beschreiben.' };
  if (s.id === 'template') return { ...s, desc: 'Optional: Dein eigener Text für Nachrichten aus dieser Gruppe (nur für dich).' };
  return s;
});
const pfSections = () => pf.target === 'me' ? PF_SECTIONS : PF_GROUP_SECTIONS;

const DOC_STATUS_OPTIONS = [
  { value: 'vorhanden',   label: 'vorhanden' },
  { value: 'beantragt',   label: 'beantragt' },
  { value: 'auf_anfrage', label: 'auf Wunsch bereitstellbar' },
];
const PET_TOKENS = [
  { value: 'keine', label: 'Keine' }, { value: 'Hund', label: 'Hund' },
  { value: 'Katze', label: 'Katze' }, { value: 'Kleintiere', label: 'Kleintiere' },
];

const pf = {
  target: 'me',            // 'me' = personal profile, otherwise a group id (the shared group profile)
  nextTarget: null,        // set before showView('profile') to open a specific profile
  members: [], autoPersons: 1, tplDirty: false,
  loaded: false,
  p: null,                 // editable profile (UI shape)
  options: {}, shareKeys: [], completeness: null,
  section: 'housing', mode: 'hub',
  pets: { none: false, set: new Set(), extra: '' },
  dirty: false, version: 0, saving: null, saveTimer: null, previewTimer: null, retryTimer: null,
};

const optLabel = (field, value) => (pf.options[field] || []).find(o => o.value === value)?.label || '';

// ── pets ⇄ chips ───────────────────────────────────────────
function petsParse(text) {
  const t = (text || '').trim();
  if (!t) return { none: false, set: new Set(), extra: '' };
  if (/^(keine?|nein|-)$/i.test(t)) return { none: true, set: new Set(), extra: '' };
  const known = PET_TOKENS.filter(x => x.value !== 'keine').map(x => x.value);
  const set = new Set(), extra = [];
  t.split(/\s*(?:,|\/|\bund\b)\s*/i).filter(Boolean).forEach(part => {
    const k = known.find(y => y.toLowerCase() === part.toLowerCase());
    if (k) set.add(k); else extra.push(part);
  });
  return { none: false, set, extra: extra.join(', ') };
}
const petsCompose = () => pf.pets.none ? 'keine' : [...pf.pets.set, ...(pf.pets.extra ? [pf.pets.extra] : [])].join(', ');

// ── load / save ────────────────────────────────────────────
function pfFromServer(profile) {
  let docs = [];
  try { docs = JSON.parse(profile.documents_json || '[]'); } catch (_) {}
  return {
    display_name: profile.display_name || '', occupation: profile.occupation || '',
    household_type: profile.household_type || '', persons: parseInt(profile.persons) || 0, children: parseInt(profile.children) || 0,
    move_in_type: profile.move_in_type || '', move_in_date: profile.move_in_date || '',
    lease_duration: profile.lease_duration || '', smoker: profile.smoker ? 1 : 0, pets: profile.pets || '',
    employment: profile.employment || '', employment_permanent: !!profile.employment_permanent,
    income_range: profile.income_range || '', documents: docs,
    about_text: profile.about_text || '', phone: profile.phone || '', availability: profile.availability || '',
    formal: !!profile.formal, custom_template: profile.custom_template || '',
    share: { ...(profile.share || {}) },
  };
}

function pfPayload() {
  const p = pf.p;
  if (pf.target !== 'me') {                 // group profile: no personal name/occupation/employment/tone/template
    return {
      household_type: p.household_type, persons: p.persons, children: p.children,
      move_in_type: p.move_in_type, move_in_date: p.move_in_date, lease_duration: p.lease_duration,
      smoker: !!p.smoker, pets: p.pets, income_range: p.income_range,
      documents: p.documents.filter(d => d.doc.trim()), about_text: p.about_text, phone: p.phone,
      availability: p.availability, share: p.share,
    };
  }
  return {
    display_name: p.display_name, occupation: p.occupation, household_type: p.household_type,
    persons: p.persons, children: p.children, move_in_type: p.move_in_type, move_in_date: p.move_in_date,
    lease_duration: p.lease_duration, smoker: !!p.smoker, pets: p.pets, employment: p.employment,
    employment_permanent: !!p.employment_permanent, income_range: p.income_range,
    documents: p.documents.filter(d => d.doc.trim()), about_text: p.about_text, phone: p.phone,
    availability: p.availability, formal: !!p.formal, custom_template: p.custom_template, share: p.share,
  };
}

function pfSetStatus(state) {
  const el = $id('pf-status'); if (!el) return;
  el.dataset.state = state;
  $id('pf-status-text').textContent = {
    saved:  'Alle Änderungen gespeichert',
    pending:'Änderungen werden gespeichert …',
    saving: 'Speichert …',
    error:  'Speichern fehlgeschlagen – neuer Versuch folgt',
  }[state];
}

function pfSchedule() {
  pf.dirty = true; pf.version++;
  pfSetStatus('pending');
  clearTimeout(pf.saveTimer);
  pf.saveTimer = setTimeout(pfSave, 800);
}

async function pfSave() {
  clearTimeout(pf.saveTimer); pf.saveTimer = null;
  if (!pf.loaded || !pf.dirty) return;
  if (pf.saving) return pf.saving;              // a save is already in flight; the next change re-triggers
  const sentVersion = pf.version;
  pfSetStatus('saving');
  pf.saving = (async () => {
    try {
      const url = pf.target === 'me' ? '/api/profile' : `/api/groups/${pf.target}/profile`;
      const r = await api(url, { method: 'PUT', body: pfPayload() });
      if (!r.success) throw new Error(r.error || 'Fehler');
      if (pf.target !== 'me' && pf.tplDirty) {          // the per-user group template is stored separately
        const t = await api(`/api/groups/${pf.target}/template`, { method: 'PUT', body: { template: pf.p.custom_template } });
        if (!t.success) throw new Error(t.error || 'Fehler');
        if (pf.version === sentVersion) pf.tplDirty = false;
      }
      if (pf.version === sentVersion) { pf.dirty = false; pfSetStatus('saved'); }
      else { pfSetStatus('pending'); pf.saveTimer = setTimeout(pfSave, 300); }
      pf.completeness = r.completeness; pfRenderHero(); pfRenderNav(); pfRenderMissing();
    } catch (e) {
      pfSetStatus('error');
      clearTimeout(pf.retryTimer);
      pf.retryTimer = setTimeout(pfSave, 5000);
    } finally { pf.saving = null; }
  })();
  return pf.saving;
}

// Make sure everything typed so far is stored (before leaving the page / opening the generator).
async function pfFlush() {
  if (!pf.loaded) return;
  if (pf.saving) await pf.saving;
  if (pf.dirty) await pfSave();
}
window.pfFlush = pfFlush;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && pf.loaded && pf.dirty) {
    fetch(pf.target === 'me' ? '/api/profile' : `/api/groups/${pf.target}/profile`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pfPayload()), keepalive: true }).catch(() => {});
  }
});

async function loadProfilePage() {
  if (pf.dirty) await pfFlush();
  let target = pf.nextTarget ?? 'me';
  pf.nextTarget = null;
  let d, tpl = null;
  if (target === 'me') d = await api('/api/profile');
  else {
    [d, tpl] = await Promise.all([api(`/api/groups/${target}/profile`), api(`/api/groups/${target}/template`)]);
    if (d.error) { target = 'me'; d = await api('/api/profile'); tpl = null; }   // group gone / no access
  }
  if (!d.profile) return;
  pf.target = target;
  pf.options = d.options || {}; pf.shareKeys = d.shareKeys || [];
  pf.p = pfFromServer(d.profile);
  if (target !== 'me') pf.p.custom_template = tpl?.template || '';
  pf.members = d.members || []; pf.autoPersons = d.autoPersons || 1; pf.tplDirty = false;
  pf.pets = petsParse(pf.p.pets);
  pf.completeness = d.completeness;
  pf.loaded = true; pf.dirty = false;
  // Desktop opens on the first unfinished section, mobile starts on the overview.
  const first = pfSections().find(s => d.completeness.sections[s.id] && d.completeness.sections[s.id].status !== 'complete');
  pf.section = first ? first.id : pfSections()[0].id;
  pf.mode = 'hub';
  $id('pf-title').textContent = target === 'me' ? 'Bewerber-Profil' : 'Gruppen-Profil';
  $id('pf-layout').dataset.target = target === 'me' ? 'me' : 'group';
  pfSetStatus('saved');
  pfBuildEditor(); pfRenderHero(); pfRenderNav(); pfRenderMissing(); pfRenderSwitch(); pfRenderGroupCard(); pfApplyMode();
  pfPreviewNow();
}
// Open the profile page on a specific profile: 'me' or a group id.
function openProfilePage(target = 'me') { pf.nextTarget = target; showView('profile', true); }
window.openProfilePage = openProfilePage;
async function pfSwitchTarget(target) { await pfFlush(); pf.nextTarget = target; await loadProfilePage(); }
window.loadProfilePage = loadProfilePage;

// ── rendering: editor ──────────────────────────────────────
const pfShareBtn = key => `<button type="button" class="pf-share" data-share="${key}" aria-pressed="true"></button>`;
const pfFieldHtml = (label, inner, shareKey) =>
  `<div class="pf-field"><div class="pf-field-head"><label class="pf-label">${label}</label>${shareKey ? pfShareBtn(shareKey) : ''}</div>${inner}</div>`;
const pfChipsHtml = (field, options, cls = '') =>
  `<div class="pf-chips ${cls}">${options.map(o => `<button type="button" class="pf-chip" data-chip data-field="${field}" data-value="${esc(o.value)}" aria-pressed="false">${esc(o.label)}</button>`).join('')}</div>`;
const pfInputHtml = (field, ph = '', type = 'text', extra = '') =>
  `<input class="pf-input" type="${type}" data-input="${field}" placeholder="${esc(ph)}" ${extra}>`;
const pfStepperHtml = (field, label) => `
  <div class="pf-stepper">
    <div class="pf-stepper-label">${label}</div>
    <div class="pf-stepper-row">
      <button type="button" class="pf-step" data-step="${field}" data-delta="-1" aria-label="${label} weniger">−</button>
      <span class="pf-step-val" data-val="${field}">0</span>
      <button type="button" class="pf-step" data-step="${field}" data-delta="1" aria-label="${label} mehr">+</button>
    </div>
  </div>`;
const pfToggleHtml = (field, label, hint = '') => `
  <label class="toggle-row pf-toggle">
    <span>${label}${hint ? `<small>${hint}</small>` : ''}</span>
    <input type="checkbox" class="toggle-cb" data-check="${field}">
    <span class="toggle-switch"></span>
  </label>`;

function pfSectionBody(id) {
  const o = pf.options;
  switch (id) {
    case 'members': return `
      <div id="pf-members" class="gp-members pf-card"></div>
      <p class="pf-hint">Wer hier fehlt, hat noch kein persönliches Profil: Die Nachricht nennt dann nur die Mitglieder mit Profil. Die Personenzahl legst du unter „Wohnsituation“ fest.</p>`;
    case 'personal': return `
      ${pfFieldHtml('Name', pfInputHtml('display_name', 'Vor- und Nachname', 'text', 'autocomplete="name"'))}
      ${pfFieldHtml('Beruf / Tätigkeit', pfInputHtml('occupation', 'z.B. Ingenieurin'), 'intro')}
      ${pfToggleHtml('formal', 'Förmliche Anrede (Sie)', 'Gilt als Standard für Nachrichten – im Generator änderbar')}`;
    case 'housing': return `
      ${pfFieldHtml('Wir sind', pfChipsHtml('household_type', o.household_type || [], 'pf-chips-grid4'), 'household')}
      <div class="pf-steppers">${pfStepperHtml('persons', 'Personen')}${pfStepperHtml('children', 'Davon Kinder')}</div>
      <p class="pf-hint" style="margin-top:-10px" data-pf-persons-hint></p>
      ${pfFieldHtml('Einzug', `${pfChipsHtml('move_in_type', o.move_in_type || [], 'pf-seg')}
        <div data-show-if="move_in_type=date">${pfInputHtml('move_in_date', 'z.B. 01.12.2026')}</div>`, 'movein')}
      ${pfFieldHtml('Gewünschte Mietdauer', pfChipsHtml('lease_duration', o.lease_duration || []), 'lease')}
      ${pfFieldHtml('Haustiere', `${pfChipsHtml('pets', PET_TOKENS)}
        <div data-show-if="pets!=keine">${pfInputHtml('pets_extra', 'Anderes Tier (optional)')}</div>`, 'pets')}
      ${pfFieldHtml('Rauchen', pfToggleHtml('nonsmoker', 'Nichtraucher'), 'smoking')}`;
    case 'income': return `
      ${pf.target !== 'me' ? '' : `${pfFieldHtml('Beschäftigung', pfChipsHtml('employment', o.employment || []), 'employment')}
      <div data-show-if="employment=employed">${pfToggleHtml('employment_permanent', 'Unbefristetes Arbeitsverhältnis')}</div>`}
      ${pfFieldHtml('Netto-Haushaltseinkommen', pfChipsHtml('income_range', o.income_range || [], 'pf-chips-grid2'), 'income')}
      <p class="pf-hint">Das Einkommen steht nur in der Nachricht, wenn du „In Nachricht“ aktivierst. Sonst bleibt es privat in deinem Profil.</p>`;
    case 'documents': return `
      ${pfFieldHtml('Unterlagen', `<p class="pf-hint" style="margin:0 0 8px">Dokument links, Status rechts – z.B. „SCHUFA-Auskunft“ / „beantragt“.</p>
        <div id="pf-docs" class="doc-list"></div>
        <button type="button" class="btn-secondary" id="pf-doc-add" style="width:auto">+ Dokument hinzufügen</button>
        <datalist id="doc-suggestions">${['SCHUFA-Auskunft','Gehaltsnachweise','Mieterselbstauskunft','Ausweiskopie','Bürgschaft','Mietschuldenfreiheitsbescheinigung','Arbeitsvertrag'].map(x => `<option value="${x}"></option>`).join('')}</datalist>`, 'documents')}`;
    case 'about': return `
      ${pfFieldHtml(pf.target === 'me' ? 'Über mich / uns' : 'Über uns', `<textarea class="pf-input" rows="5" data-input="about_text" placeholder="${pf.target === 'me' ? 'Kurzer Text über dich als Mieter:in' : 'Ein paar Sätze, die euch als Gruppe beschreiben'}"></textarea>`, 'about')}`;
    case 'contact': return `
      ${pfFieldHtml('Telefonnummer', pfInputHtml('phone', '+49 …', 'tel', 'autocomplete="tel"'), 'phone')}
      ${pfFieldHtml('Besichtigungszeiten', pfInputHtml('availability', 'z.B. Mo–Fr ab 17 Uhr, am Wochenende ganztägig'), 'availability')}`;
    case 'template': return `
      ${pfFieldHtml('Vorlage', `<p class="pf-hint" style="margin:0 0 6px">Platzhalter anklicken zum Einfügen:</p>
        <div class="placeholder-chips">${PLACEHOLDER_LIST.map(ph => `<button type="button" class="ph-chip" data-ph="${ph}"${PLACEHOLDER_HINT[ph] ? ` title="${esc(PLACEHOLDER_HINT[ph])}"` : ''}>{${ph}}</button>`).join('')}</div>
        <textarea class="pf-input" rows="8" data-input="custom_template" placeholder="Leer lassen, um die geführte Nachricht zu nutzen. Beispiel: Hallo, ich interessiere mich für {titel} für {preis}…"></textarea>`)}`;
  }
  return '';
}

function pfBuildEditor() {
  const secs = pfSections();
  $id('pf-editor').innerHTML = secs.map((s, i) => `
    <section class="pf-section" data-pf-section="${s.id}" aria-labelledby="pf-h-${s.id}">
      <div class="pf-section-head">
        <h3 id="pf-h-${s.id}">${s.title}</h3>
        <p>${s.desc}</p>
      </div>
      <div class="pf-section-body">${pfSectionBody(s.id)}</div>
      <div class="pf-section-foot">
        ${i > 0 ? `<button type="button" class="btn-ghost" data-goto-section="${secs[i - 1].id}">${icon('back', 'sm')}${secs[i - 1].title}</button>` : '<span></span>'}
        ${i < secs.length - 1 ? `<button type="button" class="btn-primary" data-goto-section="${secs[i + 1].id}">Weiter: ${secs[i + 1].title}${icon('next', 'sm')}</button>` : '<span></span>'}
      </div>
    </section>`).join('');
  pfRenderDocs();
  pfRenderMembers();
  pfSyncEditor();
  pfShowSection();
}

// "Mitglieder" (group profile): who is in, how complete their personal profile is, remind the missing ones.
function pfRenderMembers() {
  const el = $id('pf-members'); if (!el) return;
  const me = state.user?.userId;
  el.innerHTML = pf.members.map(m => {
    const isMe = m.id === me, name = m.display_name || m.username;
    const action = isMe ? `<button type="button" class="gp-btn" data-pf-edit-me>Mein Profil</button>`
      : (!m.hasProfile ? `<button type="button" class="gp-btn warn" data-pf-remind="${m.id}">Erinnern</button>` : '');
    return `<div class="gp-member">
      <span class="gp-av${m.hasProfile ? '' : ' none'}">${esc(pfInitials(name))}</span>
      <div class="gp-member-main">
        <div class="gp-member-name">${esc(m.username)}${isMe ? ' <span class="you-badge">· du</span>' : ''}</div>
        ${m.hasProfile ? `<div class="gp-bar"><div style="width:${m.percent}%;background:${m.percent === 100 ? 'var(--like)' : 'var(--accent)'}"></div></div>`
                       : '<div class="gp-member-sub">Noch kein Profil angelegt</div>'}
      </div>
      ${m.hasProfile ? `<span class="gp-pct${m.percent === 100 ? ' full' : ''}">${m.percent} %</span>` : ''}
      ${action}
    </div>`;
  }).join('');
}

function pfRenderDocs() {
  const wrap = $id('pf-docs'); if (!wrap) return;
  wrap.innerHTML = pf.p.documents.map((d, i) => `
    <div class="doc-row" data-doc-row="${i}">
      <input type="text" class="doc-name" value="${esc(d.doc)}" placeholder="z.B. SCHUFA-Auskunft" list="doc-suggestions" aria-label="Dokument">
      <select class="doc-status" aria-label="Status">
        ${DOC_STATUS_OPTIONS.map(o => `<option value="${o.value}"${o.value === d.status ? ' selected' : ''}>${o.label}</option>`).join('')}
      </select>
      <button type="button" class="doc-remove" title="Entfernen" aria-label="Dokument entfernen">${icon('x', 'sm')}</button>
    </div>`).join('');
}

const pfChipOn = (field, value) => field === 'pets'
  ? (value === 'keine' ? pf.pets.none : pf.pets.set.has(value))
  : pf.p[field] === value;

// Pushes the state into the already-built editor controls (no re-render, so focus is kept).
function pfSyncEditor() {
  const ed = $id('pf-editor'); if (!ed || !pf.p) return;
  const p = pf.p;
  ed.querySelectorAll('[data-chip]').forEach(b => {
    const on = pfChipOn(b.dataset.field, b.dataset.value);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
  ed.querySelectorAll('[data-input]').forEach(el => {
    if (document.activeElement === el) return;
    const f = el.dataset.input;
    const v = f === 'pets_extra' ? pf.pets.extra : p[f];
    if (el.value !== v) el.value = v ?? '';
  });
  ed.querySelectorAll('[data-check]').forEach(el => {
    const f = el.dataset.check;
    el.checked = f === 'nonsmoker' ? !p.smoker : !!p[f];
  });
  const group = pf.target !== 'me';
  ed.querySelectorAll('[data-val]').forEach(el => {
    if (el.dataset.val === 'persons') {
      const auto = group && !p.persons;                     // group: 0 = "automatisch" (one per member)
      el.textContent = auto ? 'auto' : Math.max(1, p.persons || 1);
      el.classList.toggle('auto', auto);
    } else el.textContent = p.children || 0;
  });
  ed.querySelectorAll('[data-pf-persons-hint]').forEach(el => {
    el.textContent = !group ? 'Gilt für Suchen ohne Gruppe. Für Gruppen gibt es ein eigenes Gruppenprofil (Schalter oben).'
      : p.persons ? 'Diese Zahl gilt für alle Nachrichten aus dieser Gruppe.'
      : `Automatisch: ${pf.autoPersons} (eine Person pro Mitglied). Mit + / − legst du die Zahl selbst fest.`;
  });
  ed.querySelectorAll('[data-show-if]').forEach(el => {
    const [cond, neg] = el.dataset.showIf.includes('!=') ? [el.dataset.showIf.split('!='), true] : [el.dataset.showIf.split('='), false];
    const cur = cond[0] === 'pets' ? (pf.pets.none ? 'keine' : '') : p[cond[0]];
    el.style.display = (neg ? cur !== cond[1] : cur === cond[1]) ? '' : 'none';
  });
  ed.querySelectorAll('[data-share]').forEach(b => {
    const key = b.dataset.share, shared = p.share[key] !== false;   // server always sends explicit booleans
    b.classList.toggle('on', shared); b.setAttribute('aria-pressed', shared);
    b.setAttribute('aria-label', `In Nachricht erwähnen: ${shared ? 'an' : 'aus'}`);
    b.innerHTML = `${pfSvg(shared ? PF_ICON.eye : PF_ICON.eyeOff, 14)}${shared ? 'In Nachricht' : (key === 'income' ? 'Nur auf Nachfrage' : 'Nicht in Nachricht')}`;
  });
}

function pfShowSection() {
  document.querySelectorAll('.pf-section').forEach(el => el.classList.toggle('active', el.dataset.pfSection === pf.section));
}

// ── rendering: hero / nav / aside ──────────────────────────
function pfInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

function pfRenderHero() {
  const el = $id('pf-hero'); if (!el || !pf.p) return;
  const c = pf.completeness || { percent: 0, missing: [] };
  const group = pf.target !== 'me';
  const g = group ? (state.groups || []).find(x => String(x.id) === String(pf.target)) : null;
  const name = group ? (g?.name || 'Gruppe') : (pf.p.display_name || state.user?.username || '');
  const persons = pf.p.persons || pf.autoPersons;
  const sub = group
    ? [optLabel('household_type', pf.p.household_type), `${persons} Person${persons === 1 ? '' : 'en'}`].filter(Boolean).join(' · ')
    : [pf.p.occupation, optLabel('household_type', pf.p.household_type)].filter(Boolean).join(' · ') || 'Noch keine Angaben';
  const dash = 232.5, off = dash * (1 - c.percent / 100);
  el.innerHTML = `
    <div class="pf-ring">
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r="37" fill="none" stroke="var(--bg3)" stroke-width="6"/>
        <circle cx="42" cy="42" r="37" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${dash}" stroke-dashoffset="${off}" transform="rotate(-90 42 42)"/>
      </svg>
      <span class="pf-ring-avatar">${esc(pfInitials(name))}</span>
    </div>
    <div class="pf-hero-text">
      <div class="pf-hero-name">${esc(name)}</div>
      <div class="pf-hero-sub">${esc(sub)}</div>
      <div class="pf-hero-pct">${c.percent} % vollständig${c.missing.length ? ` · ${c.missing.length} Angabe${c.missing.length === 1 ? '' : 'n'} fehlen` : ''}</div>
    </div>`;
}

function pfSummary(id) {
  const p = pf.p;
  const yes = p.share;
  switch (id) {
    case 'members': { const n = pf.members.length, w = pf.members.filter(m => m.hasProfile).length;
        return `${n} Mitglied${n === 1 ? '' : 'er'} · ${w} mit Profil`; }
    case 'personal': return [p.display_name || 'Name fehlt', p.occupation, p.formal ? 'förmliche Anrede' : 'lockere Anrede'].filter(Boolean).join(' · ');
    case 'housing': return [optLabel('household_type', p.household_type), pf.target !== 'me' ? `${p.persons || pf.autoPersons} Person${(p.persons || pf.autoPersons) === 1 ? '' : 'en'}` : '', (() => {
        const t = p.move_in_type === 'date' ? (p.move_in_date && `Einzug ${p.move_in_date}`) : p.move_in_type ? `Einzug ${optLabel('move_in_type', p.move_in_type).toLowerCase()}` : '';
        return t; })(), p.smoker ? '' : 'Nichtraucher', pf.pets.none ? 'keine Haustiere' : p.pets].filter(Boolean).join(' · ') || 'Wohnform, Einzug, Haustiere …';
    case 'income': return [pf.target !== 'me' ? '' : optLabel('employment', p.employment) && (optLabel('employment', p.employment) + (p.employment === 'employed' && p.employment_permanent ? ', unbefristet' : '')),
        p.income_range ? (yes.income === true ? optLabel('income_range', p.income_range) : 'Einkommen nur auf Nachfrage') : ''].filter(Boolean).join(' · ') || (pf.target !== 'me' ? 'Netto-Haushaltseinkommen' : 'Beschäftigung und Einkommen');
    case 'documents': { const n = p.documents.filter(d => d.doc.trim()), ok = n.filter(d => d.status === 'vorhanden').length;
        return n.length ? `${ok} von ${n.length} sofort verfügbar` : 'Noch keine Unterlagen'; }
    case 'about': return p.about_text ? p.about_text.replace(/\s+/g, ' ').slice(0, 70) + (p.about_text.length > 70 ? ' …' : '') : 'Kurzer Text über dich';
    case 'contact': return [p.phone, p.availability].filter(Boolean).join(' · ') || 'Telefon & Besichtigungszeiten ergänzen';
    case 'template': return p.custom_template.trim() ? 'Eigene Vorlage ist hinterlegt' : 'Nicht verwendet – geführte Nachricht';
  }
  return '';
}

function pfRenderNav() {
  const nav = $id('pf-nav'); if (!nav || !pf.p) return;
  const secs = pf.completeness?.sections || {};
  nav.innerHTML = pfSections().map(s => {
    const st = secs[s.id];
    const status = st ? st.status : 'none';
    const missing = st ? st.total - st.done : 0;
    const chip = !st ? '' : status === 'complete' ? '<span class="pf-nav-chip ok">Fertig</span>'
      : status === 'empty' ? '<span class="pf-nav-chip empty">Fehlt</span>' : `<span class="pf-nav-chip part">${missing} offen</span>`;
    const docChips = s.id === 'documents' ? `<span class="pf-doc-chips">${pf.p.documents.filter(d => d.doc.trim()).map(d =>
      `<span class="pf-doc-chip ${d.status}">${esc(d.doc)}${d.status === 'vorhanden' ? '' : d.status === 'beantragt' ? ' · beantragt' : ' · auf Wunsch'}</span>`).join('')}</span>` : '';
    return `<button type="button" class="pf-nav-item st-${status}${s.id === pf.section ? ' cur' : ''}" data-section="${s.id}" ${s.id === pf.section ? 'aria-current="true"' : ''}>
      <span class="pf-nav-icon">${pfSvg(PF_ICON[s.id])}</span>
      <span class="pf-nav-text"><span class="pf-nav-title">${s.title}</span><span class="pf-nav-sum">${esc(pfSummary(s.id))}</span>${docChips}</span>
      ${chip}
    </button>`;
  }).join('');
}

function pfRenderMissing() {
  const card = $id('pf-missing-card'), box = $id('pf-missing');
  const miss = pf.completeness?.missing || [];
  card.style.display = miss.length ? '' : 'none';
  box.innerHTML = miss.map(m => `<button type="button" class="pf-missing-item" data-section="${m.section}"><span>${esc(m.label)}</span><small>${pfSections().find(s => s.id === m.section)?.title} →</small></button>`).join('');
}

function pfRenderSwitch() {
  const sw = $id('pf-switch'); if (!sw) return;
  const groups = state.groups || [];
  if (!groups.length) { sw.style.display = 'none'; return; }
  sw.style.display = '';
  const meOn = pf.target === 'me';
  const grpBtns = groups.length <= 2
    ? groups.map(g => `<button type="button" class="${String(pf.target) === String(g.id) ? 'on' : ''}" data-target="${g.id}">Als Gruppe „${esc(g.name)}“</button>`).join('')
    : `<select aria-label="Als Gruppe bearbeiten" class="${meOn ? '' : 'on'}"><option value="">Als Gruppe …</option>${groups.map(g => `<option value="${g.id}"${String(pf.target) === String(g.id) ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`;
  sw.innerHTML = `<button type="button" class="${meOn ? 'on' : ''}" data-target="me">Mein Profil</button>${grpBtns}`;
}

// Group mode: a card with the "take over my answers" action (fills only empty fields by default).
function pfRenderGroupCard() {
  const card = $id('pf-group-card'); if (!card) return;
  card.style.display = pf.target === 'me' ? 'none' : '';
}

function pfApplyMode() {
  const layout = $id('pf-layout'); if (!layout) return;
  layout.dataset.mode = pfDesktop() ? 'desktop' : pf.mode;
  pfShowSection();
}
window.matchMedia('(min-width: 1000px)').addEventListener('change', pfApplyMode);

function pfGoto(section, { fromMissing = false } = {}) {
  pf.section = section;
  pfShowSection(); pfRenderNav();
  if (!pfDesktop()) { pf.mode = 'edit'; $id('pf-layout').dataset.mode = 'edit'; $id('view-profile').querySelector('.view-content').scrollTop = 0; }
  if (pfDesktop() && fromMissing) $id('pf-editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  pfPreviewSoon();
}

// ── live preview ───────────────────────────────────────────
function pfPreviewSoon() { clearTimeout(pf.previewTimer); pf.previewTimer = setTimeout(pfPreviewNow, 400); }
async function pfPreviewNow() {
  if (!pf.loaded) return;
  const useTpl = pf.section === 'template' && pf.p.custom_template.trim();
  const body = { ...pfPayload(), mode: useTpl ? 'template' : 'guided' };
  if (pf.target !== 'me') body.template = pf.p.custom_template;
  const d = await api(pf.target === 'me' ? '/api/message/preview' : `/api/groups/${pf.target}/profile/preview`, { method: 'POST', body });
  if (d.error) return;
  const warn = d.unknownPlaceholders?.length ? `\n\nHinweis – unbekannte Platzhalter: ${d.unknownPlaceholders.join(' ')}` : '';
  $id('pf-preview').textContent = (d.message || '—') + warn;
  if (d.completeness) { pf.completeness = d.completeness; pfRenderHero(); pfRenderNav(); pfRenderMissing(); }
}

// ── events ─────────────────────────────────────────────────
function pfChanged({ nav = true } = {}) {
  pf.p.pets = petsCompose();
  pfSyncEditor();
  if (nav) pfRenderNav();
  pfRenderHero();
  pfSchedule(); pfPreviewSoon();
}

function pfChipClick(field, value) {
  const p = pf.p;
  if (field === 'pets') {
    if (value === 'keine') { pf.pets.none = !pf.pets.none; if (pf.pets.none) { pf.pets.set.clear(); pf.pets.extra = ''; } }
    else { pf.pets.none = false; pf.pets.set.has(value) ? pf.pets.set.delete(value) : pf.pets.set.add(value); }
  } else if (field === 'move_in_type') {
    p.move_in_type = value;
  } else {
    p[field] = p[field] === value ? '' : value;
    if (field === 'household_type') {                       // sensible defaults for the person count
      const min = { single: 1, couple: 2, family: 2 }[p.household_type];
      if (p.household_type === 'single') { p.persons = 1; p.children = 0; }
      else if (min && (p.persons || 1) < min) p.persons = min;
    }
  }
  pfChanged();
}

function pfBindEditor() {
  const ed = $id('pf-editor');
  ed.addEventListener('click', e => {
    const chip = e.target.closest('[data-chip]');
    if (chip) return pfChipClick(chip.dataset.field, chip.dataset.value);
    const step = e.target.closest('[data-step]');
    if (step) {
      const f = step.dataset.step, d = parseInt(step.dataset.delta);
      const group = pf.target !== 'me';
      const eff = () => pf.p.persons || (group ? pf.autoPersons : 1);   // group: 0 = automatic
      if (f === 'persons') {
        const n = eff() + d;
        pf.p.persons = group ? (n < 1 ? 0 : Math.min(30, n)) : Math.min(12, Math.max(1, n));
        pf.p.children = Math.min(pf.p.children, Math.max(0, eff() - 1));
      } else pf.p.children = Math.min(Math.max(0, eff() - 1), Math.max(0, pf.p.children + d));
      return pfChanged();
    }
    const share = e.target.closest('[data-share]');
    if (share) {
      const k = share.dataset.share;
      pf.p.share[k] = pf.p.share[k] === false;
      return pfChanged({ nav: false });
    }
    const go = e.target.closest('[data-goto-section]');
    if (go) return pfGoto(go.dataset.gotoSection);
    if (e.target.closest('[data-pf-edit-me]')) return pfSwitchTarget('me');
    const rem = e.target.closest('[data-pf-remind]');
    if (rem) {
      rem.disabled = true;
      return api(`/api/groups/${pf.target}/remind-profile/${rem.dataset.pfRemind}`, { method: 'POST' }).then(r => {
        toast(r.success ? '👋 Erinnerung gesendet' : '❌ ' + (r.error || 'Fehler'));
        if (r.success) rem.textContent = 'Erinnert ✓'; else rem.disabled = false;
      });
    }
    const ph = e.target.closest('.ph-chip');
    if (ph) {
      const ta = ed.querySelector('[data-input="custom_template"]'), token = `{${ph.dataset.ph}}`;
      const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, s) + token + ta.value.slice(en);
      ta.focus(); ta.selectionStart = ta.selectionEnd = s + token.length;
      pf.p.custom_template = ta.value; pf.tplDirty = true; return pfChanged({ nav: false });
    }
    if (e.target.closest('#pf-doc-add')) {
      pf.p.documents.push({ doc: '', status: 'vorhanden' }); pfRenderDocs();
      ed.querySelector('#pf-docs .doc-row:last-child .doc-name')?.focus(); return pfChanged();
    }
    const rm = e.target.closest('.doc-remove');
    if (rm) { pf.p.documents.splice(parseInt(rm.closest('[data-doc-row]').dataset.docRow), 1); pfRenderDocs(); return pfChanged(); }
  });
  ed.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.input) {
      if (el.dataset.input === 'pets_extra') pf.pets.extra = el.value.trim();
      else pf.p[el.dataset.input] = el.value;
      if (el.dataset.input === 'custom_template') pf.tplDirty = true;
      return pfChanged({ nav: false });
    }
    const row = el.closest('[data-doc-row]');
    if (row && el.classList.contains('doc-name')) { pf.p.documents[parseInt(row.dataset.docRow)].doc = el.value; pfChanged({ nav: false }); }
  });
  ed.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.check) {
      const f = el.dataset.check;
      if (f === 'nonsmoker') pf.p.smoker = el.checked ? 0 : 1; else pf.p[f] = el.checked;
      return pfChanged();
    }
    const row = el.closest('[data-doc-row]');
    if (row && el.classList.contains('doc-status')) { pf.p.documents[parseInt(row.dataset.docRow)].status = el.value; pfChanged(); }
  });
  // nav items (hub cards / desktop section list) and "Noch offen" links
  $id('pf-nav').addEventListener('click', e => { const b = e.target.closest('[data-section]'); if (b) pfGoto(b.dataset.section); });
  $id('pf-missing').addEventListener('click', e => { const b = e.target.closest('[data-section]'); if (b) pfGoto(b.dataset.section, { fromMissing: true }); });
  $id('pf-back').addEventListener('click', () => {
    if (!pfDesktop() && pf.mode === 'edit') { pf.mode = 'hub'; pfApplyMode(); } else showView(window.innerWidth >= 900 ? 'swipe' : 'more', true);
  });
  $id('pf-switch').addEventListener('click', e => { const b = e.target.closest('[data-target]'); if (b && String(b.dataset.target) !== String(pf.target)) pfSwitchTarget(b.dataset.target === 'me' ? 'me' : b.dataset.target); });
  $id('pf-switch').addEventListener('change', e => { if (e.target.tagName === 'SELECT' && e.target.value) pfSwitchTarget(e.target.value); });
  $id('pf-adopt').addEventListener('click', () => pfAdopt(false));
  $id('pf-adopt-all').addEventListener('click', () => pfAdopt(true));
  $id('pf-try').addEventListener('click', pfTryMessage);
}

// "Aus meinem Profil übernehmen": copies the caller's personal answers into the group profile.
async function pfAdopt(overwrite) {
  if (overwrite && !confirm('Alle Angaben des Gruppenprofils mit deinen persönlichen Angaben überschreiben?')) return;
  await pfFlush();
  const r = await api(`/api/groups/${pf.target}/profile/adopt`, { method: 'POST', body: { overwrite } });
  if (!r.success) return toast('❌ ' + (r.error || 'Fehler'));
  toast(r.adopted ? `✅ ${r.adopted} Angabe${r.adopted === 1 ? '' : 'n'} übernommen` : 'Nichts zu übernehmen – alle Felder sind schon ausgefüllt');
  pf.nextTarget = pf.target; await loadProfilePage();
}

// "Nachricht ausprobieren": use one of the user's own rated listings so the text is real.
async function pfTryMessage() {
  await pfFlush();
  const d = await api('/api/listings/rated');
  const list = d.listings || [];
  const l = list.find(x => x.my_swipe === 'like' || x.my_swipe === 'superlike') || list[0];
  if (!l) return toast('Bewerte zuerst ein Inserat – dann kannst du hier eine echte Nachricht ausprobieren');
  messageModal.open(l, { groupId: pf.target === 'me' ? null : pf.target });
}

pfBindEditor();

// ══════════════════════════════════════════════════════════
//  NACHRICHTEN-GENERATOR (Modal)
// ══════════════════════════════════════════════════════════
// Related blocks are toggled together in the generator (the API keeps them separate).
const MSG_BLOCK_GROUPS = [
  { label: 'Vorstellung (Beruf)',        keys: ['intro'] },
  { label: 'Wohnform & Personen',        keys: ['household'] },
  { label: 'Einzugstermin & Mietdauer',  keys: ['movein', 'lease'] },
  { label: 'Nichtraucher & Haustiere',   keys: ['smoking', 'pets'] },
  { label: 'Beschäftigung',              keys: ['employment'] },
  { label: 'Einkommen',                  keys: ['income'] },
  { label: 'Unterlagen',                 keys: ['documents'] },
  { label: 'Über uns',                   keys: ['about'] },
  { label: 'Erreichbarkeit',             keys: ['phone', 'availability'] },
];

const messageModal = {
  listing: null, groupId: null, aiAvailable: false,
  members: [],            // group members: {id, username, hasProfile}
  selected: new Set(),    // member ids the message speaks for
  blocks: [],             // capabilities: {key,label,hasData,shared}
  off: new Set(),         // blocks the user switched off for this message
  tone: 'formal',         // formal | informal | template | ai
  edited: false,          // text typed in since the last generate
  ownProfileEmpty: false,

  async open(listing, opts = {}) {
    this.listing = listing; this.groupId = opts.groupId || null;
    this.edited = false; this.off = new Set();
    await window.pfFlush?.();                       // generate from the latest saved profile
    $id('message-context').textContent = this.groupId
      ? 'Anfrage für die Gruppe – das Gruppenprofil bestimmt die Angaben, Namen und Berufe kommen aus den Profilen der Mitglieder.'
      : `Anfrage für: ${listing.title || 'Inserat'}`;
    $id('message-open-link').href = safeHref(listing.url);
    clr('message-error');
    $id('message-listing').innerHTML = this.listingHtml(listing);

    let cap = {}, profile = {};
    try {
      [cap, profile] = await Promise.all([
        api('/api/message/capabilities' + (this.groupId ? `?groupId=${this.groupId}` : '')),
        api('/api/profile'),
      ]);
    } catch (_) {}
    this.aiAvailable = !!cap.ai;
    this.members = cap.members || [];
    this.selected = new Set(this.members.filter(m => m.hasProfile).map(m => m.id));
    this.blocks = cap.blocks || [];
    this.ownProfileEmpty = !!cap.ownProfileEmpty;
    this.groupProfileEmpty = !!cap.groupProfileEmpty;
    $id('msg-mode-ai').style.display = this.aiAvailable ? '' : 'none';
    // Start on the user's own template when this group has one; else their saved tone.
    this.tone = cap.hasGroupTemplate ? 'template' : (profile.profile && !profile.profile.formal ? 'informal' : 'formal');
    this.renderControls();
    $id('message-blocks-block').open = pfDesktop();   // collapsed on phones so the text stays within reach
    $id('message-modal').style.display = 'flex';
    this._contact?.destroy();
    this._contact = mountContactBar($id('message-contact'), listing.id, this.groupId);
    await this.generate(this.tone, { force: true });
  },

  close() { this._contact?.destroy(); this._contact = null; $id('message-modal').style.display = 'none'; this.listing = null; },

  listingHtml(l) {
    const bits = [(l.price_cold || '').trim() && `${esc(l.price_cold)} kalt`, (l.price || '').trim() && `${esc(l.price)} warm`,
      l.size && esc(l.size), l.rooms && `${esc(l.rooms)} Zimmer`, l.location && esc(l.location)].filter(Boolean);
    return `<div class="msg-listing-title">${esc(l.title || 'Inserat')}</div>${bits.length ? `<div class="msg-listing-meta">${bits.join(' · ')}</div>` : ''}`;
  },

  renderControls() {
    document.querySelectorAll('.msg-mode-tab').forEach(t => {
      const on = t.dataset.msgmode === this.tone;
      t.classList.toggle('active', on); t.setAttribute('aria-pressed', on);
    });
    this.renderMembers();
    this.renderBlocks();
  },

  // Chips: which group members the message speaks for.
  renderMembers() {
    const blockEl = $id('message-members-block'), wrap = $id('message-members');
    if (!this.groupId || this.members.length < 2) { blockEl.style.display = 'none'; wrap.innerHTML = ''; return; }
    blockEl.style.display = '';
    wrap.innerHTML = this.members.map(m => {
      const on = this.selected.has(m.id);
      return `<label class="msg-member ${m.hasProfile ? (on ? 'on' : '') : 'off'}" title="${m.hasProfile ? '' : 'Kein Bewerber-Profil'}">
        <input type="checkbox" data-member="${m.id}" ${on ? 'checked' : ''} ${m.hasProfile ? '' : 'disabled'}>
        <span class="msg-member-av">${esc(pfInitials(m.username))}</span>${esc(m.username)}${m.hasProfile ? '' : ' · kein Profil'}
      </label>`;
    }).join('');
  },

  // Bausteine: related blocks share one switch (9 rows instead of 12). Only blocks with data are
  // listed; blocks the profile keeps private are shown but locked.
  renderBlocks() {
    const blockEl = $id('message-blocks-block'), wrap = $id('message-blocks');
    if (!this.blocks.length) { blockEl.style.display = 'none'; return; }
    blockEl.style.display = '';
    const byKey = Object.fromEntries(this.blocks.map(b => [b.key, b]));
    const rows = [];
    for (const g of MSG_BLOCK_GROUPS) {
      const parts = g.keys.map(k => byKey[k]).filter(b => b && b.hasData);
      if (!parts.length) continue;
      const free = parts.filter(b => b.shared), locked = parts.filter(b => !b.shared);
      const allLocked = !free.length;
      const on = !allLocked && free.some(b => !this.off.has(b.key));
      const hint = allLocked ? 'Im Profil auf „nur auf Nachfrage“ gesetzt'
        : locked.length ? `${locked.map(b => b.label).join(', ')}: im Profil nicht freigegeben` : '';
      rows.push({ g, keys: (allLocked ? parts : free).map(b => b.key), allLocked, on, hint });
    }
    wrap.innerHTML = rows.map(({ g, keys, allLocked, on, hint }) => `
      <div class="msg-block-row${allLocked ? ' locked' : ''}">
        <div><span>${esc(g.label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</div>
        <label class="msg-switch"><input type="checkbox" data-block="${keys.join(',')}" ${on ? 'checked' : ''} ${allLocked ? 'disabled' : ''} aria-label="${esc(g.label)}"><span></span></label>
      </div>`).join('');
    const active = rows.filter(r => r.on).length;
    $id('message-blocks-count').textContent = `· ${active} von ${rows.length} aktiv`;
    const missing = this.blocks.filter(b => !b.hasData);
    $id('message-blocks-hint').innerHTML = missing.length
      ? `Noch nicht im Profil: ${missing.map(b => esc(b.label)).join(', ')} – <a href="#" data-goto-profile>jetzt ergänzen</a>` : '';
  },

  // Returns false if the user declined to discard manual edits.
  async generate(tone, { force = false } = {}) {
    if (!this.listing) return true;
    const ta = $id('message-text');
    if (this.edited && !force && ta.value.trim() &&
        !confirm('Du hast den Text bearbeitet. Neu generieren überschreibt deine Änderungen – fortfahren?')) return false;
    this.tone = tone; this.renderControls();
    clr('message-error');
    ta.value = 'Wird erstellt …'; this.edited = false;
    const body = { listingId: this.listing.id, groupId: this.groupId,
      mode: tone === 'template' ? 'template' : tone === 'ai' ? 'ai' : 'guided' };
    if (tone === 'formal' || tone === 'informal') body.tone = tone;
    if (this.groupId && this.selected.size) body.memberIds = [...this.selected];
    const blocks = {}; this.off.forEach(k => { blocks[k] = false; });
    if (Object.keys(blocks).length) body.blocks = blocks;

    const r = await api('/api/message/generate', { method: 'POST', body });
    if (r.error) {
      ta.value = '';
      setErr('message-error', r.error);
      if (tone === 'ai') {                            // fall back to the guided text so the box isn't empty
        const fb = await api('/api/message/generate', { method: 'POST', body: { ...body, mode: 'guided' } });
        if (fb.message) ta.value = fb.message;
      }
      this.updateWords(); this.renderWarnings(r); return true;
    }
    ta.value = r.message || '';
    this.updateWords(); this.renderWarnings(r);
    return true;
  },

  updateWords() {
    const n = ($id('message-text').value.trim().match(/\S+/g) || []).length;
    $id('message-words').textContent = n ? `${n} Wörter` : '';
  },

  // Non-blocking hints with actions: missing profiles (+ remind), own empty profile, bad placeholders, fallback.
  renderWarnings(r) {
    const items = [];
    if (this.groupId && this.groupProfileEmpty) items.push(`<span>Das Gruppenprofil ist noch leer.</span> <button type="button" class="msg-link" data-goto-profile="group">Gruppenprofil ausfüllen →</button>`);
    if (this.ownProfileEmpty) items.push(`<span>${this.groupId ? 'Dein persönliches Profil ist noch leer – dein Name fehlt in der Nachricht.' : 'Dein Bewerber-Profil ist noch leer.'}</span> <button type="button" class="msg-link" data-goto-profile="me">Profil ausfüllen →</button>`);
    (r.missingProfiles || []).forEach(name => {
      const m = this.members.find(x => x.username === name);
      items.push(`<span>${esc(name)} hat noch kein Bewerber-Profil und fehlt deshalb in der Nachricht.</span>` +
        (m && m.id !== state.user?.userId ? ` <button type="button" class="msg-link" data-remind="${m.id}">Erinnern</button>` : ''));
    });
    if (r.unknownPlaceholders?.length) items.push(`<span>Unbekannte Platzhalter in der Vorlage: ${esc(r.unknownPlaceholders.join(' '))}</span>`);
    if (r.info) items.push(`<span>${esc(r.info)}</span>`);
    const box = $id('message-warn');
    box.style.display = items.length ? '' : 'none';
    box.innerHTML = items.map(i => `<div class="msg-warning">${pfSvg(PF_ICON.warn, 18)}<div>${i}</div></div>`).join('');
  },
};

document.querySelectorAll('.msg-mode-tab').forEach(tab => {
  tab.addEventListener('click', () => { if (tab.dataset.msgmode !== messageModal.tone) messageModal.generate(tab.dataset.msgmode); });
});
$id('message-members').addEventListener('change', async e => {
  const cb = e.target.closest('input[data-member]'); if (!cb) return;
  const id = parseInt(cb.dataset.member), had = messageModal.selected.has(id);
  if (cb.checked) messageModal.selected.add(id); else messageModal.selected.delete(id);
  if (!messageModal.selected.size) { messageModal.selected.add(id); messageModal.renderMembers(); return toast('Mindestens eine Person muss ausgewählt sein'); }
  const ok = await messageModal.generate(messageModal.tone);
  if (ok === false) { had ? messageModal.selected.add(id) : messageModal.selected.delete(id); }
  messageModal.renderMembers();
});
$id('message-blocks').addEventListener('change', async e => {
  const cb = e.target.closest('input[data-block]'); if (!cb) return;
  const keys = cb.dataset.block.split(','), had = keys.map(k => messageModal.off.has(k));
  keys.forEach(k => cb.checked ? messageModal.off.delete(k) : messageModal.off.add(k));
  const ok = await messageModal.generate(messageModal.tone);
  if (ok === false) keys.forEach((k, i) => had[i] ? messageModal.off.add(k) : messageModal.off.delete(k));
  messageModal.renderBlocks();
});
$id('message-text').addEventListener('input', () => { messageModal.edited = true; messageModal.updateWords(); });
$id('message-regen').addEventListener('click', () => messageModal.generate(messageModal.tone));
$id('message-close').addEventListener('click', () => messageModal.close());
$id('message-modal').addEventListener('click', async e => {
  if (e.target.id === 'message-modal') return messageModal.close();
  const gotoProfile = e.target.closest('[data-goto-profile]');
  if (gotoProfile) {
    e.preventDefault();
    const which = gotoProfile.dataset.gotoProfile || (messageModal.groupId ? 'group' : 'me');   // blocks hint → the profile that feeds them
    const target = which === 'group' ? messageModal.groupId : 'me';
    messageModal.close(); detailView.close?.(); openProfilePage(target);
    return;
  }
  const rem = e.target.closest('[data-remind]');
  if (rem && messageModal.groupId) {
    rem.disabled = true;
    const r = await api(`/api/groups/${messageModal.groupId}/remind-profile/${rem.dataset.remind}`, { method: 'POST' });
    toast(r.success ? '👋 Erinnerung gesendet' : '❌ ' + (r.error || 'Fehler'));
    rem.textContent = r.success ? 'Erinnert ✓' : 'Erinnern'; rem.disabled = !!r.success;
  }
});
$id('message-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($id('message-text').value);
    toast('📋 Nachricht kopiert – danach hier als angeschrieben markieren');
    messageModal._contact?.nudge();
  }
  catch (e) { toast('❌ Kopieren fehlgeschlagen'); }
});

// ══════════════════════════════════════════════════════════
//  GRUPPEN-PROFIL (Tab im Gruppen-Detail)
// ══════════════════════════════════════════════════════════
// Tab "Gruppen-Profil" in the group detail: a compact overview. Editing happens on the profile page
// (same UI as the personal profile, switched to this group).
async function renderGroupProfile(group, el) {
  el.innerHTML = '<p class="notify-sub">Wird geladen …</p>';
  const [d, pv] = await Promise.all([
    api(`/api/groups/${group.id}/profile`),
    api(`/api/groups/${group.id}/profile/preview`, { method: 'POST', body: { mode: 'guided' } }),
  ]);
  if (d.error) { el.innerHTML = `<p class="form-error">${esc(d.error)}</p>`; return; }
  const pct = d.completeness.percent, me = d.me;
  const rows = d.members.map(m => {
    const isMe = m.id === me, name = m.display_name || m.username;
    const action = isMe ? `<button type="button" class="gp-btn" data-gp-edit-me>Mein Profil</button>`
      : (!m.hasProfile ? `<button type="button" class="gp-btn warn" data-gp-remind="${m.id}">Erinnern</button>` : '');
    return `<div class="gp-member">
      <span class="gp-av${m.hasProfile ? '' : ' none'}">${esc(pfInitials(name))}</span>
      <div class="gp-member-main">
        <div class="gp-member-name">${esc(m.username)}${isMe ? ' <span class="you-badge">· du</span>' : ''}</div>
        ${m.hasProfile ? `<div class="gp-bar"><div style="width:${m.percent}%;background:${m.percent === 100 ? 'var(--like)' : 'var(--accent)'}"></div></div>`
                       : '<div class="gp-member-sub">Noch kein Profil angelegt</div>'}
      </div>
      ${m.hasProfile ? `<span class="gp-pct${m.percent === 100 ? ' full' : ''}">${m.percent} %</span>` : ''}
      ${action}
    </div>`;
  }).join('');
  const notes = [];
  if (pv.missingProfiles?.length) notes.push(`Kein persönliches Profil von: ${pv.missingProfiles.join(', ')} – sie fehlen in der Nachricht.`);

  el.innerHTML = `
    <div class="gp-layout">
      <div class="gp-left">
        <span class="pf-label">Gruppenprofil</span>
        <div class="pf-card">
          <div class="gp-sum-row"><strong>${pct} % vollständig</strong>
            <span class="gp-pct${pct === 100 ? ' full' : ''}">${d.completeness.missing.length ? `${d.completeness.missing.length} offen` : 'alles da'}</span></div>
          <div class="gp-bar" style="margin:8px 0 14px"><div style="width:${pct}%;background:${pct === 100 ? 'var(--like)' : 'var(--accent)'}"></div></div>
          <button type="button" class="btn-primary" data-gp-edit-group>Gruppenprofil bearbeiten</button>
          <p class="pf-hint">Wohnform, Einzug, Haustiere, Unterlagen und Kontakt gelten für die ganze Gruppe – einmal ausfüllen, jeder profitiert.</p>
        </div>
        <span class="pf-label">Mitglieder</span>
        <div class="pf-card gp-members">${rows}</div>
      </div>
      <div class="pf-card gp-right">
        <div class="gp-right-head"><h3>So liest sich eure Nachricht</h3><span class="gp-active">Beispiel-Inserat</span></div>
        <div class="gp-preview" id="gp-preview"></div>
        ${notes.length ? `<p class="pf-hint pf-hint-warn">${icon('alert', 'sm')}<span>${esc(notes.join(' '))}</span></p>` : ''}
      </div>
    </div>`;
  $id('gp-preview').textContent = pv.message || '—';

  el.querySelector('[data-gp-edit-group]')?.addEventListener('click', () => openProfilePage(group.id));
  el.querySelector('[data-gp-edit-me]')?.addEventListener('click', () => openProfilePage('me'));
  el.querySelectorAll('[data-gp-remind]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const r = await api(`/api/groups/${group.id}/remind-profile/${b.dataset.gpRemind}`, { method: 'POST' });
    toast(r.success ? '👋 Erinnerung gesendet' : '❌ ' + (r.error || 'Fehler'));
    if (r.success) b.textContent = 'Erinnert ✓'; else b.disabled = false;
  }));
}
window.renderGroupProfile = renderGroupProfile;
