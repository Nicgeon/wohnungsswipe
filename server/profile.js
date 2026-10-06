/**
 * profile.js – Bewerberprofil: Felder, Validierung, Vollständigkeit,
 * Privatsphäre ("In Nachricht"-Schalter) und Nachrichtenbau.
 *
 * Reine Funktionen ohne Datenbankzugriff (index.js lädt/speichert die Profile
 * und gibt sie hier hinein) – dadurch ohne Server testbar.
 */

// ── Auswahlfelder ──────────────────────────────────────────
const OPTIONS = {
  household_type: [
    { value: 'single', label: 'Allein' },
    { value: 'couple', label: 'Paar' },
    { value: 'family', label: 'Familie' },
    { value: 'wg',     label: 'WG' },
  ],
  move_in_type: [
    { value: 'asap',     label: 'Schnellstmöglich' },
    { value: 'flexible', label: 'Flexibel' },
    { value: 'date',     label: 'Zu festem Datum' },
  ],
  lease_duration: [
    { value: 'long',         label: 'Langfristig' },
    { value: 'temporary_ok', label: 'Befristet okay' },
    { value: 'any',          label: 'Egal' },
  ],
  employment: [
    { value: 'employed',      label: 'Angestellt' },
    { value: 'self_employed', label: 'Selbstständig' },
    { value: 'student',       label: 'Studium' },
    { value: 'trainee',       label: 'Ausbildung' },
    { value: 'retired',       label: 'Rente' },
    { value: 'other',         label: 'Sonstiges' },
  ],
  income_range: [
    { value: 'lt2000',    label: 'unter 2.000 €' },
    { value: '2000_3000', label: '2.000 – 3.000 €' },
    { value: '3000_4000', label: '3.000 – 4.000 €' },
    { value: 'gt4000',    label: 'über 4.000 €' },
  ],
};
const optionValues = key => OPTIONS[key].map(o => o.value);
const optionLabel  = (key, value) => OPTIONS[key].find(o => o.value === value)?.label || '';

// ── Dokumente ──────────────────────────────────────────────
// Words that only exist in the plural ("Gehaltsnachweise ist beantragt" would
// be wrong) — the status verb has to follow the document, not just the count.
const PLURAL_DOC_RE = /(nachweise|unterlagen|papiere|kopien|bescheinigungen|auskünfte|verträge|belege|dokumente|zeugnisse|kontoauszüge|abrechnungen)$/i;
const isPluralDoc = name => PLURAL_DOC_RE.test((name || '').trim());

// Status a given document can be in, as shown in the applicant profile's
// document list and rendered into the guided message.
const DOC_STATUS_LABEL = {
  vorhanden:   { one: 'liegt vor',   many: 'liegen vor' },
  beantragt:   { one: 'ist beantragt', many: 'sind beantragt' },
  auf_anfrage: { one: 'kann auf Wunsch gerne bereitgestellt werden', many: 'können auf Wunsch gerne bereitgestellt werden' },
};

// Validates/cleans the {doc, status} list posted from the profile form —
// drops empty rows, caps name length, and falls back to 'vorhanden' for
// any unrecognized status so a tampered/old client can't store garbage.
function cleanDocuments(docs) {
  if (!Array.isArray(docs)) return [];
  return docs
    .map(d => ({
      doc:    (typeof d?.doc === 'string' ? d.doc : '').trim().substring(0, 80),
      status: Object.keys(DOC_STATUS_LABEL).includes(d?.status) ? d.status : 'vorhanden',
    }))
    .filter(d => d.doc)
    .slice(0, 20);
}

function parseDocuments(profile) {
  try { return JSON.parse(profile?.documents_json || '[]'); } catch (_) { return []; }
}

// Joins items German-list style: "A, B und C" (not an Oxford comma).
function germanList(items) {
  if (items.length <= 1) return items[0] || '';
  return items.slice(0, -1).join(', ') + ' und ' + items[items.length - 1];
}

// ── Privatsphäre: "In Nachricht"-Schalter ──────────────────
// Every block can be excluded from generated messages, per person (profile
// setting) and per message (Bausteine in the generator). Income defaults to
// "only on request"; everything else defaults to shared.
const SHARE_KEYS = [
  { key: 'intro',        label: 'Vorstellung (Beruf)',        default: true },
  { key: 'household',    label: 'Wohnform & Personen',        default: true },
  { key: 'movein',       label: 'Einzugstermin',              default: true },
  { key: 'lease',        label: 'Mietdauer',                  default: true },
  { key: 'smoking',      label: 'Nichtraucher',               default: true },
  { key: 'pets',         label: 'Haustiere',                  default: true },
  { key: 'employment',   label: 'Beschäftigung',              default: true },
  { key: 'income',       label: 'Einkommen',                  default: false },
  { key: 'documents',    label: 'Unterlagen',                 default: true },
  { key: 'about',        label: 'Über mich / uns',            default: true },
  { key: 'phone',        label: 'Telefonnummer',              default: true },
  { key: 'availability', label: 'Besichtigungszeiten',        default: true },
];
const SHARE_KEY_NAMES = SHARE_KEYS.map(k => k.key);

function parseShare(p) {
  let stored = {};
  try { stored = JSON.parse(p?.share_json || '{}') || {}; } catch (_) { stored = {}; }
  const out = {};
  for (const { key, default: def } of SHARE_KEYS) out[key] = typeof stored[key] === 'boolean' ? stored[key] : def;
  return out;
}

// Does this profile hold data for the given block (raw, ignoring sharing)?
function hasData(p, key) {
  switch (key) {
    case 'intro':        return !!p.occupation;
    case 'household':    return !!(p.household_type || p.household_size || parseInt(p.children) > 0 || parseInt(p.persons) > 1);
    case 'movein':       return !!movePhraseOf(p, true);
    case 'lease':        return !!(p.lease_duration && p.lease_duration !== 'any');
    case 'smoking':      return true;
    case 'pets':         return !!p.pets;
    case 'employment':   return !!p.employment;
    case 'income':       return !!p.income_range;
    case 'documents':    return parseDocuments(p).length > 0;
    case 'about':        return !!p.about_text;
    case 'phone':        return !!p.phone;
    case 'availability': return !!p.availability;
    default:             return false;
  }
}

// ── Eingabe prüfen (PUT /api/profile, Vorschau) ────────────
// Merge semantics: a field that is absent from the request keeps its stored
// value, so older clients that don't know the new fields never wipe them.
function normalizeInput(b, base) {
  b = b || {};
  const has = k => b[k] !== undefined;
  const str = (k, max, fallback) => has(k) ? (typeof b[k] === 'string' ? b[k] : '').trim().substring(0, max) : fallback;
  const oneOf = (k, allowEmpty, fallback) => {
    if (!has(k)) return fallback;
    if (b[k] === '' && allowEmpty) return '';
    return optionValues(k).includes(b[k]) ? b[k] : fallback;
  };
  const int = (k, min, max, fallback) => {
    if (!has(k)) return fallback;
    const n = parseInt(b[k], 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const bool = (k, fallback) => has(k) ? (b[k] ? 1 : 0) : fallback;

  let share = parseShare(base);
  if (b.share && typeof b.share === 'object') {
    for (const key of SHARE_KEY_NAMES) if (typeof b.share[key] === 'boolean') share[key] = b.share[key];
  }

  return {
    display_name:   str('display_name', 120, base.display_name || ''),
    occupation:     str('occupation', 120, base.occupation || ''),
    household_size: str('household_size', 60, base.household_size || ''),
    household_type: oneOf('household_type', true, base.household_type || ''),
    persons:        int('persons', 0, 12, parseInt(base.persons) || 0),
    children:       int('children', 0, 10, parseInt(base.children) || 0),
    move_in_type:   oneOf('move_in_type', true, base.move_in_type || ''),
    move_in_date:   str('move_in_date', 60, base.move_in_date || ''),
    lease_duration: oneOf('lease_duration', true, base.lease_duration || ''),
    smoker:         bool('smoker', base.smoker ? 1 : 0),
    pets:           str('pets', 120, base.pets || ''),
    employment:     oneOf('employment', true, base.employment || ''),
    employment_permanent: bool('employment_permanent', base.employment_permanent ? 1 : 0),
    income_range:   oneOf('income_range', true, base.income_range || ''),
    documents_json: has('documents') ? JSON.stringify(cleanDocuments(b.documents)) : (base.documents_json || '[]'),
    about_text:     str('about_text', 1000, base.about_text || ''),
    phone:          has('phone') ? str('phone', 40, '').replace(/[^\d+()/.\-\s]/g, '').replace(/\s+/g, ' ').trim() : (base.phone || ''),
    availability:   str('availability', 200, base.availability || ''),
    formal:         bool('formal', base.formal ? 1 : 0),
    custom_template: str('custom_template', 4000, base.custom_template || ''),
    share_json:     JSON.stringify(share),
  };
}

// ── Vollständigkeit ────────────────────────────────────────
const CHECKS = [
  { id: 'display_name',   section: 'personal',  label: 'Name',               ok: p => !!p.display_name },
  { id: 'occupation',     section: 'personal',  label: 'Beruf',              ok: p => !!p.occupation },
  { id: 'household_type', section: 'housing',   label: 'Wohnform',           ok: p => !!p.household_type },
  { id: 'move_in',        section: 'housing',   label: 'Einzug',             ok: p => !!movePhraseOf(p, true) },
  { id: 'pets',           section: 'housing',   label: 'Haustiere',          ok: p => !!p.pets },
  { id: 'employment',     section: 'income',    label: 'Beschäftigung',      ok: p => !!p.employment },
  { id: 'documents',      section: 'documents', label: 'Unterlagen',         ok: p => parseDocuments(p).length > 0 },
  { id: 'about_text',     section: 'about',     label: 'Über mich',          ok: p => !!p.about_text },
  { id: 'phone',          section: 'contact',   label: 'Telefonnummer',      ok: p => !!p.phone },
  { id: 'availability',   section: 'contact',   label: 'Besichtigungszeiten', ok: p => !!p.availability },
];
const SECTIONS = ['personal', 'housing', 'income', 'documents', 'about', 'contact'];

function completeness(p) {
  const empty = !p || p._empty;
  const results = CHECKS.map(c => ({ ...c, done: !empty && !!c.ok(p) }));
  const done = results.filter(r => r.done).length;
  const sections = {};
  for (const s of SECTIONS) {
    const rs = results.filter(r => r.section === s);
    const d = rs.filter(r => r.done).length;
    sections[s] = { done: d, total: rs.length, status: d === rs.length ? 'complete' : d === 0 ? 'empty' : 'partial' };
  }
  return {
    percent: Math.round(done / CHECKS.length * 100),
    done, total: CHECKS.length,
    missing: results.filter(r => !r.done).map(r => ({ id: r.id, section: r.section, label: r.label })),
    sections,
  };
}

// A member counts as "having a profile" only if they actually filled in
// something. Members without one must not contribute defaults to a group
// message (e.g. the unsaved default smoker=0 would otherwise be rendered as
// "wir sind alle Nichtraucher" for people who never said so).
function isFilled(p) {
  if (!p || p._empty) return false;
  return !!(p.display_name || p.occupation || p.household_size || p.household_type || p.move_in_date ||
            p.pets || p.about_text || p.employment || p.income_range || p.phone || p.availability ||
            parseDocuments(p).length);
}

// ── Einzug ─────────────────────────────────────────────────
// Move-in wording from the structured type/date. `withZum` adds the "zum"
// before a concrete date (guided sentence); the {einzug} placeholder wants
// the bare value so templates can write "ab {einzug}".
function movePhraseOf(p, withZum) {
  const type = p.move_in_type || (p.move_in_date ? 'date' : '');
  if (type === 'asap')     return 'schnellstmöglich';
  if (type === 'flexible') return 'flexibel';
  if (type === 'date' && p.move_in_date) return withZum ? `zum ${p.move_in_date}` : p.move_in_date;
  return '';
}

const personsOf = p => Math.min(12, Math.max(1, parseInt(p.persons, 10) || 1));
const childrenOf = p => Math.max(0, parseInt(p.children, 10) || 0);

// ── Sichtbares Profil ──────────────────────────────────────
// Returns a copy of the profile with everything blanked that must not end up
// in a message: switched off in the person's own privacy settings or in the
// generator's Bausteine for this message. `override` is a group-wide move-in
// agreement ("Angleichen") that replaces each member's own move-in.
function visibleProfile(p, { blocks = {}, override = null } = {}) {
  const share = parseShare(p);
  const allowed = key => share[key] !== false && blocks[key] !== false;
  const v = { ...p };
  if (!allowed('intro'))        { v.occupation = ''; v._hideIntro = true; }
  if (!allowed('household'))    { v.household_type = ''; v.household_size = ''; v.children = 0; }
  if (!allowed('movein'))       { v.move_in_type = ''; v.move_in_date = ''; }
  else if (override && override.move_in_type) {
    v.move_in_type = override.move_in_type;
    v.move_in_date = override.move_in_type === 'date' ? (override.move_in_date || '') : '';
  }
  if (!allowed('lease'))        v.lease_duration = '';
  if (!allowed('smoking'))      v._hideSmoker = true;
  if (!allowed('pets'))         v.pets = '';
  if (!allowed('employment'))   { v.employment = ''; v.employment_permanent = 0; }
  if (!allowed('income'))       v.income_range = '';
  if (!allowed('documents'))    v.documents_json = '[]';
  if (!allowed('about'))        v.about_text = '';
  if (!allowed('phone'))        v.phone = '';
  if (!allowed('availability')) v.availability = '';
  return v;
}

// Which Bausteine make sense for these (raw) profiles: does anyone have data
// for it, and does anyone with data allow sharing it? Drives the toggles in
// the generator ("Im Profil auf 'nur auf Nachfrage' gesetzt").
function blockStatus(profiles) {
  return SHARE_KEYS.map(({ key, label }) => {
    const withData = profiles.filter(p => hasData(p, key));
    return {
      key, label,
      hasData: withData.length > 0,
      shared:  withData.some(p => parseShare(p)[key] !== false),
    };
  });
}

// ── Platzhalter ────────────────────────────────────────────
const employmentText = p => {
  const base = { employed: 'angestellt', self_employed: 'selbstständig', student: 'im Studium',
                 trainee: 'in Ausbildung', retired: 'in Rente' }[p.employment] || '';
  return base && p.employment === 'employed' && p.employment_permanent ? `${base} (unbefristet)` : base;
};

// Build the {placeholder} substitution map from a listing + profile(s).
// For a group, person-related placeholders aggregate every filled member
// profile ({name} -> "Anna, Ben und Chris"); for a solo request `profiles`
// is just [profile], so behaviour is unchanged. Expects visibleProfile()
// copies so hidden fields come out empty.
function buildPlaceholders(listing, profile, profiles = [profile]) {
  const uniq = arr => [...new Set(arr.filter(Boolean))];
  const docs = new Map();
  for (const pr of profiles) for (const d of parseDocuments(pr)) {
    if (d.doc && !docs.has(d.doc.toLowerCase())) docs.set(d.doc.toLowerCase(), d);
  }
  const unterlagen = [...docs.values()]
    .map(d => `${d.doc} (${DOC_STATUS_LABEL[d.status]?.[isPluralDoc(d.doc) ? 'many' : 'one'] || d.status})`)
    .join(', ');
  const names = uniq(profiles.map(x => x.display_name));
  const namen = germanList(names);
  const persons = profiles.reduce((n, x) => n + personsOf(x), 0);
  const kinder = profiles.reduce((n, x) => n + childrenOf(x), 0);
  return {
    titel:   listing.title || '',
    preis:   listing.price_cold || listing.price || '',
    warm:    listing.price || '',
    kalt:    listing.price_cold || '',
    zimmer:  listing.rooms || '',
    groesse: listing.size || '',
    größe:   listing.size || '',
    lage:    listing.location || '',
    ort:     listing.location || '',
    name:    namen,
    namen,
    personen: String(Math.max(persons, 1)),
    kinder:  kinder ? String(kinder) : '',
    beruf:   uniq(profiles.map(x => x.occupation)).join(', '),
    einzug:  uniq(profiles.map(x => movePhraseOf(x, false))).join(' bzw. '),
    haushalt: uniq(profiles.map(x => x.household_size)).join(', ') || (persons > 1 ? `${persons} Personen` : ''),
    wohnform: uniq(profiles.map(x => optionLabel('household_type', x.household_type))).join(', '),
    mietdauer: uniq(profiles.map(x => x.lease_duration === 'any' ? '' : optionLabel('lease_duration', x.lease_duration))).join(', '),
    beschaeftigung: uniq(profiles.map(employmentText)).join(', '),
    einkommen: uniq(profiles.map(x => optionLabel('income_range', x.income_range))).join(', '),
    telefon: uniq(profiles.map(x => x.phone)).join(' oder '),
    erreichbarkeit: uniq(profiles.map(x => x.availability)).join(' bzw. '),
    unterlagen,
  };
}

// Replaces {placeholders}. Known placeholders whose value is empty are
// removed (instead of leaking a literal "{beruf}" into a message that gets
// sent to a landlord); unknown ones (typos) stay visible and are reported
// back in `unknown` so the UI can warn about them.
function applyTemplate(tpl, placeholders) {
  const unknown = [];
  const text = tpl.replace(/\{([\wäöüÄÖÜß]+)\}/g, (m, key) => {
    const k = key.toLowerCase();
    if (placeholders[k] === undefined) { if (!unknown.includes(m)) unknown.push(m); return m; }
    return placeholders[k];
  })
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/(\S)[ \t]{2,}/g, '$1 ');
  return { text, unknown };
}

// ── Geführte Nachricht ─────────────────────────────────────
// Variant A1 — guided template built from structured profile fields.
// Expects visibleProfile() copies (hidden fields already blanked).
function buildGuidedMessage(listing, profiles, formal) {
  const greet  = formal ? 'Sehr geehrte Damen und Herren,' : 'Hallo,';
  const p = profiles[0] || {};
  const totalPersons = profiles.reduce((n, x) => n + personsOf(x), 0);
  const plural = totalPersons > 1;           // "wir" instead of "ich"
  const nameOf = (x, i) => x.display_name || `Person ${i + 1}`;

  const lines = [];
  lines.push(greet);
  lines.push('');

  const titleRef = listing.title ? `Ihre Anzeige „${listing.title}"` : 'Ihre Wohnungsanzeige';
  const details = [];
  if (listing.size)  details.push(listing.size);
  if (listing.rooms) details.push(`${listing.rooms} Zimmer`);
  const detailStr = details.length ? ` (${details.join(', ')})` : '';

  const introProfiles = profiles.filter(x => !x._hideIntro);
  if (plural) {
    const whoList = introProfiles.map(x => {
      const bits = [x.display_name].filter(Boolean);
      if (x.occupation) bits.push(x.occupation);
      return bits.join(', ');
    }).filter(Boolean);
    const type = profiles.map(x => x.household_type).find(Boolean);
    const kids = profiles.reduce((n, x) => n + childrenOf(x), 0);
    const typeText = { couple: 'als Paar', family: 'als Familie', wg: 'als WG' }[type];
    const kidsText = kids ? ` (davon ${kids} ${kids === 1 ? 'Kind' : 'Kinder'})` : '';
    lines.push(`mit großem Interesse haben wir ${titleRef}${detailStr} gesehen und würden uns sehr über eine Besichtigung freuen.`);
    lines.push('');
    const head = typeText ? `Wir bewerben uns ${typeText} mit ${totalPersons} Personen${kidsText}`
                          : `Wir bewerben uns gemeinsam als ${totalPersons} Personen${kidsText}`;
    lines.push(head + (whoList.length ? `: ${whoList.join('; ')}.` : '.'));
  } else {
    const who = [];
    if (p.display_name && !p._hideIntro) who.push(`Mein Name ist ${p.display_name}`);
    if (p.occupation)                    who.push(`ich bin ${p.occupation}`);
    lines.push(`mit großem Interesse habe ich ${titleRef}${detailStr} gesehen und würde mich sehr über eine Besichtigung freuen.`);
    lines.push('');
    if (who.length) lines.push(who.join(', ') + '.');
  }

  // Shared facts — each phrased as a complete, grammatical sentence.
  const facts = [];

  // Move-in: build a grammatical phrase from the structured type/date
  // instead of just gluing a raw string after "Einzug wäre ... ab".
  const movePhrases = [...new Set(profiles.map(x => movePhraseOf(x, true)).filter(Boolean))];
  if (movePhrases.length) {
    facts.push(`${plural ? 'einziehen könnten wir' : 'einziehen könnte ich'} ${movePhrases.join(' bzw. ')}`);
  }

  // Lease duration: "langfristig" wins over "befristet okay"; "egal" says nothing.
  const leases = profiles.map(x => x.lease_duration);
  if (leases.includes('long'))              facts.push(plural ? 'wir suchen langfristig' : 'ich suche langfristig');
  else if (leases.includes('temporary_ok')) facts.push(`ein befristetes Mietverhältnis wäre für ${plural ? 'uns' : 'mich'} in Ordnung`);

  const smokerProfiles = profiles.filter(x => !x._hideSmoker && isFilled(x));
  if (smokerProfiles.length && smokerProfiles.every(x => !x.smoker)) {
    facts.push(plural ? 'wir sind alle Nichtraucher' : 'ich bin Nichtraucher');
  }

  const pets = [...new Set(profiles.map(x => x.pets).filter(Boolean))];
  if (pets.length) {
    const noPets = pets.every(x => /^(keine?|nein|-)$/i.test(x.trim()));
    if (noPets) facts.push(plural ? 'wir haben keine Haustiere' : 'ich habe keine Haustiere');
    else        facts.push(`als Haustier${pets.length > 1 ? 'e' : ''} ${plural ? 'bringen wir' : 'bringe ich'} ${pets.join(' und ')} mit`);
  }

  // Employment: "wir sind alle angestellt" when everyone matches, else per person.
  const emp = profiles.map((x, i) => ({ name: nameOf(x, i), text: employmentText(x) })).filter(e => e.text);
  if (emp.length) {
    if (!plural) {
      facts.push(`ich bin ${emp[0].text}`);
    } else if (emp.length === profiles.length && new Set(emp.map(e => e.text)).size === 1) {
      facts.push(`wir sind alle ${emp[0].text}`);
    } else {
      facts.push(germanList(emp.map(e => `${e.name} ist ${e.text}`)));
    }
  }

  // Income: only present if the person(s) chose to share it.
  const inc = profiles.map((x, i) => ({ name: nameOf(x, i), label: optionLabel('income_range', x.income_range) })).filter(e => e.label);
  if (inc.length) {
    if (inc.length === 1 && profiles.length === 1) {
      facts.push(`${plural ? 'unser' : 'mein'} monatliches Netto-Haushaltseinkommen liegt bei ${inc[0].label}`);
    } else {
      facts.push(`unser monatliches Netto-Einkommen: ${inc.map(e => `${e.name} ${e.label}`).join(', ')}`);
    }
  }

  if (facts.length) {
    lines.push('');
    // Join into flowing sentences, each capitalized.
    const sentences = facts.map(f => f.charAt(0).toUpperCase() + f.slice(1));
    lines.push(sentences.join('. ') + '.');
  }

  // Supporting documents (SCHUFA-Auskunft, Mieterselbstauskunft, …) are
  // grouped by status so they read as flowing sentences — "SCHUFA-Auskunft
  // und Mieterselbstauskunft liegen vor. Gehaltsnachweise sind beantragt."
  // — instead of a flat "Dokument: Status" label dump. Deduplicated by
  // document name across a group (first occurrence wins) so a document
  // every roommate listed is only mentioned once.
  const docsByName = new Map();
  for (const prof of profiles) {
    for (const d of parseDocuments(prof)) {
      const key = d.doc.toLowerCase();
      if (d.doc && !docsByName.has(key)) docsByName.set(key, d);
    }
  }
  const documents = [...docsByName.values()];
  if (documents.length) {
    const byStatus = {};
    for (const d of documents) (byStatus[d.status] ||= []).push(d.doc);
    const statusSentences = [];
    for (const status of Object.keys(DOC_STATUS_LABEL)) {
      const names = byStatus[status];
      if (!names?.length) continue;
      const label = DOC_STATUS_LABEL[status][(names.length > 1 || names.some(isPluralDoc)) ? 'many' : 'one'];
      statusSentences.push(`${germanList(names)} ${label}`);
    }
    if (statusSentences.length) {
      lines.push('');
      lines.push(statusSentences.map(s => s.charAt(0).toUpperCase() + s.slice(1) + '.').join(' '));
    }
  }

  // Free-text about sections
  const abouts = profiles.map(x => x.about_text).filter(Boolean);
  if (abouts.length) {
    lines.push('');
    lines.push(abouts.join('\n\n'));
  }

  // Contact: phone + viewing times, only if shared.
  const phones = [...new Set(profiles.map(x => x.phone).filter(Boolean))];
  const avails = [...new Set(profiles.map(x => x.availability).filter(Boolean))];
  if (phones.length || avails.length) {
    lines.push('');
    const contact = [];
    if (phones.length) contact.push(formal
      ? `Sie erreichen ${plural ? 'uns' : 'mich'} telefonisch unter ${phones.join(' oder ')}.`
      : `Du erreichst ${plural ? 'uns' : 'mich'} telefonisch unter ${phones.join(' oder ')}.`);
    if (avails.length) contact.push(`Besichtigungstermine sind ${plural ? 'bei uns' : 'bei mir'} ${avails.join(' bzw. ')} möglich.`);
    lines.push(contact.join(' '));
  }

  lines.push('');
  const closeVerb = plural ? 'würden wir uns' : 'würde ich mich';
  lines.push(formal
    ? `Über eine Rückmeldung ${closeVerb} sehr freuen.`
    : `Über eine kurze Rückmeldung ${closeVerb} sehr freuen.`);
  lines.push('');
  lines.push(formal ? 'Mit freundlichen Grüßen' : 'Viele Grüße');
  const sigNames = profiles.map(x => x.display_name).filter(Boolean);
  if (sigNames.length) lines.push(sigNames.join(', '));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// One line per person for the LLM prompt (visibleProfile() copies).
function summarizeForAi(profiles) {
  return profiles.map((p, i) => {
    const parts = [];
    if (p.display_name) parts.push(`Name: ${p.display_name}`);
    if (p.occupation)   parts.push(`Beruf: ${p.occupation}`);
    if (personsOf(p) > 1) parts.push(`Personen im Haushalt: ${personsOf(p)}`);
    if (p.household_type) parts.push(`Wohnform: ${optionLabel('household_type', p.household_type)}`);
    if (childrenOf(p))    parts.push(`Kinder: ${childrenOf(p)}`);
    else if (p.household_size) parts.push(`Haushalt: ${p.household_size}`);
    const move = movePhraseOf(p, false);
    if (move) parts.push(`Einzug: ${move}`);
    if (p.lease_duration && p.lease_duration !== 'any') parts.push(`Mietdauer: ${optionLabel('lease_duration', p.lease_duration)}`);
    if (!p._hideSmoker) parts.push(p.smoker ? 'Raucher' : 'Nichtraucher');
    if (p.pets) parts.push(`Haustiere: ${p.pets}`);
    const emp = employmentText(p);
    if (emp) parts.push(`Beschäftigung: ${emp}`);
    if (p.income_range) parts.push(`Netto-Einkommen: ${optionLabel('income_range', p.income_range)}`);
    const docs = parseDocuments(p);
    if (docs.length) parts.push(`Unterlagen: ${docs.map(d => `${d.doc} (${DOC_STATUS_LABEL[d.status]?.[isPluralDoc(d.doc) ? 'many' : 'one'] || d.status})`).join(', ')}`);
    if (p.about_text) parts.push(`Über: ${p.about_text}`);
    if (p.phone) parts.push(`Telefon: ${p.phone}`);
    if (p.availability) parts.push(`Besichtigung möglich: ${p.availability}`);
    return `Person ${i + 1}: ${parts.join(', ')}`;
  }).join('\n');
}

// ── Gruppen-Übersicht ──────────────────────────────────────
// entries: [{ user: {id, username}, profile }] for ALL members.
// Only data the members chose to share (visibleProfile) goes into `combined`;
// other members' completeness is exposed as a percentage only.
function groupOverview(entries, override = null) {
  const members = entries.map(({ user, profile }) => {
    const filled = isFilled(profile);
    const c = completeness(profile);
    return { id: user.id, username: user.username, hasProfile: filled,
             percent: filled ? c.percent : 0,
             display_name: filled ? profile.display_name || '' : '' };
  });

  const filledEntries = entries.filter(e => isFilled(e.profile));
  const vis = filledEntries.map(e => ({ user: e.user, p: visibleProfile(e.profile, { override }) }));
  const raw = filledEntries.map(e => ({ user: e.user, p: visibleProfile(e.profile) })); // without override

  // Distinct move-in wishes (before any override) → conflict hint.
  const moveByMember = raw
    .map(({ user, p }) => ({ id: user.id, username: user.username, label: movePhraseOf(p, false) }))
    .filter(m => m.label);
  const distinct = [...new Set(moveByMember.map(m => m.label))];

  const docs = new Map();
  for (const { p } of vis) for (const d of parseDocuments(p)) {
    if (d.doc && !docs.has(d.doc.toLowerCase())) docs.set(d.doc.toLowerCase(), d);
  }
  const smokerVis = vis.filter(({ p }) => !p._hideSmoker);
  const pets = [...new Set(vis.map(({ p }) => p.pets).filter(Boolean))];

  return {
    members,
    combined: {
      memberCount: vis.length,
      persons: vis.reduce((n, { p }) => n + personsOf(p), 0),
      children: vis.reduce((n, { p }) => n + childrenOf(p), 0),
      household_type: vis.map(({ p }) => p.household_type).find(Boolean) || '',
      names: vis.map(({ p }) => p.display_name).filter(Boolean),
      occupations: vis.map(({ user, p }) => ({ id: user.id, name: p.display_name || user.username, occupation: p.occupation })).filter(x => x.occupation),
      nonSmoker: smokerVis.length > 0 && smokerVis.every(({ p }) => !p.smoker),
      noPets: pets.length > 0 && pets.every(x => /^(keine?|nein|-)$/i.test(x.trim())),
      pets,
      documents: [...docs.values()],
      moveIn: {
        perMember: moveByMember,
        conflict: distinct.length > 1 && !(override && override.move_in_type),
        override: override && override.move_in_type
          ? { move_in_type: override.move_in_type, move_in_date: override.move_in_date || '',
              label: movePhraseOf({ move_in_type: override.move_in_type, move_in_date: override.move_in_date }, false) }
          : null,
      },
    },
  };
}

module.exports = {
  OPTIONS, SHARE_KEYS, SHARE_KEY_NAMES, SECTIONS, DOC_STATUS_LABEL,
  cleanDocuments, parseDocuments, parseShare, hasData, normalizeInput,
  completeness, isFilled, movePhraseOf, personsOf, childrenOf, visibleProfile, blockStatus,
  buildPlaceholders, applyTemplate, buildGuidedMessage, summarizeForAi, groupOverview,
  germanList, isPluralDoc, optionLabel,
};
