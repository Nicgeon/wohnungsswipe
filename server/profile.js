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

// Keeps digits and phone punctuation only; "(x)" left over after stripping letters is dropped.
const cleanPhone = v => v.replace(/[^\d+()/.\-\s]/g, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();

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
    phone:          has('phone') ? cleanPhone(str('phone', 40, '')) : (base.phone || ''),
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

function completenessFrom(checks, p, sectionIds) {
  const empty = !p || p._empty;
  const results = checks.map(c => ({ ...c, done: !empty && !!c.ok(p) }));
  const done = results.filter(r => r.done).length;
  const sections = {};
  for (const sec of sectionIds) {
    const rs = results.filter(r => r.section === sec);
    const d = rs.filter(r => r.done).length;
    sections[sec] = { done: d, total: rs.length, status: d === rs.length ? 'complete' : d === 0 ? 'empty' : 'partial' };
  }
  return {
    percent: Math.round(done / checks.length * 100),
    done, total: checks.length,
    missing: results.filter(r => !r.done).map(r => ({ id: r.id, section: r.section, label: r.label })),
    sections,
  };
}
const completeness = p => completenessFrom(CHECKS, p, SECTIONS);

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

// ── Haushalt ───────────────────────────────────────────────
// Who is searching, and how many? Always read from ONE profile: the personal
// profile for a search without a group, the group profile (see groupAsProfile)
// for a group search. Profiles are never summed — a couple has one group profile.
function householdOf(profiles) {
  return {
    persons:  profiles.reduce((n, x) => n + personsOf(x), 0),
    children: profiles.reduce((n, x) => n + childrenOf(x), 0),
    type:     profiles.map(x => x.household_type).find(Boolean) || '',
  };
}

// ── Gruppenprofil ──────────────────────────────────────────
// A group searches as "we": its own profile holds everything that is shared
// (household, move-in, pets, documents, contact …). Names and occupations are
// not stored there — they come from the members' personal profiles.
// Personal facts (name, occupation, employment) belong to the person: they come from the members' profiles,
// never from the group profile — otherwise the job would show up twice.
const MEMBER_FED_KEYS = ['intro', 'employment'];
const GROUP_SHARE_KEY_NAMES = SHARE_KEY_NAMES.filter(k => !MEMBER_FED_KEYS.includes(k));

function normalizeGroupProfile(b, base = {}) {
  b = b || {};
  const has = k => b[k] !== undefined;
  const str = (k, max, fallback) => has(k) ? (typeof b[k] === 'string' ? b[k] : '').trim().substring(0, max) : fallback;
  const oneOf = (k, fallback) => {
    if (!has(k)) return fallback;
    return b[k] === '' || optionValues(k).includes(b[k]) ? b[k] : fallback;
  };
  const int = (k, max, fallback) => {
    if (!has(k)) return fallback;
    const n = parseInt(b[k], 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : fallback;
  };
  const persons = int('persons', 30, parseInt(base.persons) || 0);
  let children = int('children', 30, parseInt(base.children) || 0);
  if (persons > 0) children = Math.min(children, persons - 1);     // at least one adult
  const share = parseShare(base);
  if (b.share && typeof b.share === 'object') {
    for (const key of GROUP_SHARE_KEY_NAMES) if (typeof b.share[key] === 'boolean') share[key] = b.share[key];
  }
  return {
    household_type: oneOf('household_type', base.household_type || ''),
    persons, children,
    move_in_type:   oneOf('move_in_type', base.move_in_type || ''),
    move_in_date:   str('move_in_date', 60, base.move_in_date || ''),
    lease_duration: oneOf('lease_duration', base.lease_duration || ''),
    smoker:         has('smoker') ? (b.smoker ? 1 : 0) : (base.smoker ? 1 : 0),
    pets:           str('pets', 120, base.pets || ''),
    income_range:   oneOf('income_range', base.income_range || ''),
    documents_json: has('documents') ? JSON.stringify(cleanDocuments(b.documents)) : (base.documents_json || '[]'),
    about_text:     str('about_text', 1000, base.about_text || ''),
    phone:          has('phone') ? cleanPhone(str('phone', 40, '')) : (base.phone || ''),
    availability:   str('availability', 200, base.availability || ''),
    share_json:     JSON.stringify(share),
  };
}

// Group profile row → the profile shape the message builders understand.
// persons = 0 means "automatic": one person per group member.
function groupAsProfile(gp, memberCount = 0) {
  const n = parseInt(gp.persons, 10) || 0;
  return {
    ...gp, _empty: false,
    display_name: '', occupation: '', household_size: '', formal: 1, employment: '', employment_permanent: 0,
    persons: n > 0 ? n : Math.max(memberCount, 1),
  };
}

const GROUP_CHECKS = [
  { id: 'household_type', section: 'housing',   label: 'Wohnform',            ok: p => !!p.household_type },
  { id: 'move_in',        section: 'housing',   label: 'Einzug',              ok: p => !!movePhraseOf(p, true) },
  { id: 'pets',           section: 'housing',   label: 'Haustiere',           ok: p => !!p.pets },
  { id: 'documents',      section: 'documents', label: 'Unterlagen',          ok: p => parseDocuments(p).length > 0 },
  { id: 'about_text',     section: 'about',     label: 'Über uns',            ok: p => !!p.about_text },
  { id: 'phone',          section: 'contact',   label: 'Telefonnummer',       ok: p => !!p.phone },
  { id: 'availability',   section: 'contact',   label: 'Besichtigungszeiten', ok: p => !!p.availability },
];
function completenessGroup(gp) {
  return completenessFrom(GROUP_CHECKS, gp, ['housing', 'income', 'documents', 'about', 'contact']);
}

// ── Sichtbares Profil ──────────────────────────────────────
// Returns a copy of the profile with everything blanked that must not end up
// in a message: switched off in the person's own privacy settings or in the
// generator's Bausteine for this message.
function visibleProfile(p, { blocks = {} } = {}) {
  const share = parseShare(p);
  const allowed = key => share[key] !== false && blocks[key] !== false;
  const v = { ...p };
  if (!allowed('intro'))        { v.occupation = ''; v._hideIntro = true; }
  if (!allowed('household'))    { v.household_type = ''; v.household_size = ''; v.children = 0; }
  if (!allowed('movein'))       { v.move_in_type = ''; v.move_in_date = ''; }
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
function blockStatus(profiles, members = null) {
  return SHARE_KEYS.map(({ key, label }) => {
    // group search: "Vorstellung" and "Beschäftigung" are fed by the members' personal profiles
    const withData = (members && MEMBER_FED_KEYS.includes(key) ? members : profiles).filter(p => hasData(p, key));
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
  return base && p.employment === 'employed' && p.employment_permanent ? `unbefristet ${base}` : base;
};

// Free sentence for the group profile's "Berufliche Situation" when adopting a personal profile.

// Build the {placeholder} substitution map from a listing + profile(s).
// For a group, person-related placeholders aggregate every filled member
// profile ({name} -> "Anna, Ben und Chris"); for a solo request `profiles`
// is just [profile], so behaviour is unchanged. Expects visibleProfile()
// copies so hidden fields come out empty.
function buildPlaceholders(listing, profile, profiles = [profile], members = null) {
  const uniq = arr => [...new Set(arr.filter(Boolean))];
  const docs = new Map();
  for (const pr of profiles) for (const d of parseDocuments(pr)) {
    if (d.doc && !docs.has(d.doc.toLowerCase())) docs.set(d.doc.toLowerCase(), d);
  }
  const unterlagen = [...docs.values()]
    .map(d => `${d.doc} (${DOC_STATUS_LABEL[d.status]?.[isPluralDoc(d.doc) ? 'many' : 'one'] || d.status})`)
    .join(', ');
  const people = members || profiles;               // group search: names/jobs come from the members
  const names = uniq(people.map(x => x.display_name));
  const namen = germanList(names);
  const { persons, children: kinder } = householdOf(profiles);
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
    beruf:   uniq(people.map(x => x.occupation)).join(', '),
    einzug:  uniq(profiles.map(x => movePhraseOf(x, false))).join(' bzw. '),
    haushalt: uniq(profiles.map(x => x.household_size)).join(', ') || (persons > 1 ? `${persons} Personen` : ''),
    wohnform: uniq(profiles.map(x => optionLabel('household_type', x.household_type))).join(', '),
    mietdauer: uniq(profiles.map(x => x.lease_duration === 'any' ? '' : optionLabel('lease_duration', x.lease_duration))).join(', '),
    beschaeftigung: uniq(people.map(employmentText)).join(', '),
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
// Number words for running text ("zwei Personen", "zu dritt", "ein Kind").
const NUM_WORDS = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];
const numWord = n => (n >= 1 && n <= 12) ? NUM_WORDS[n] : String(n);
const ZU_WORD = { 2: 'zu zweit', 3: 'zu dritt', 4: 'zu viert', 5: 'zu fünft', 6: 'zu sechst', 7: 'zu siebt', 8: 'zu acht' };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const NO_PETS_RE = /^(keine?|nein|-)$/i;

// "Hund, Katze" → ["einen Hund", "eine Katze"]; free text keeps its own article if it has one.
function petItems(profiles) {
  const known = { hund: 'einen Hund', hunde: 'Hunde', katze: 'eine Katze', katzen: 'Katzen', kleintier: 'ein Kleintier', kleintiere: 'Kleintiere' };
  const seen = new Set(), items = [], others = [];
  let none = false;
  for (const x of profiles) {
    for (const raw of (x.pets || '').split(/\s*(?:,|\/|;|\bund\b)\s*/i).map(t => t.trim()).filter(Boolean)) {
      if (NO_PETS_RE.test(raw)) { none = true; continue; }
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (known[key]) items.push(known[key]);
      else if (/^(ein|eine|einen|zwei|drei|vier)\b/i.test(raw)) items.push(raw);
      else others.push(raw);
    }
  }
  if (others.length) items.push(`weitere Haustiere (${others.join(', ')})`);
  return { none: none && !items.length, items };
}

// Does the free-text occupation already express the employment status? ("Duale Studentin" says
// "im Studium", "Fachinformatiker in Ausbildung" says "in Ausbildung".) Then we don't repeat it.
const EMPLOYMENT_HINTS = { trainee: /ausbild|azubi|auszubild/i, student: /stud/i, self_employed: /selbst|freiberuf|gründ/i,
                           retired: /rent|pension/i, employed: /angestellt/i };
const employmentIsRedundant = p => !!(p.employment && p.occupation && EMPLOYMENT_HINTS[p.employment]?.test(p.occupation)
                                       && !(p.employment === 'employed' && p.employment_permanent));

// Variant A1 — guided template built from structured profile fields. Written as flowing
// German: related facts share a sentence, subjects vary, grammar follows tone and head count
// ("beide"/"alle", "zu zweit", "Ihre"/"deine"). Expects visibleProfile() copies (hidden
// fields already blanked). For a group search `profiles` is [group profile] and `members`
// the visible member profiles that supply names and occupations.
function buildGuidedMessage(listing, profiles, formal, members = null) {
  const { persons, children: kids, type } = householdOf(profiles);
  const people = members || profiles;            // who is named in the intro and the signature
  const plural = persons > 1;                 // "wir" instead of "ich"
  const Wir = plural ? 'Wir' : 'Ich';
  const wir = plural ? 'wir' : 'ich';
  const uns = plural ? 'uns' : 'mich';
  const both = persons === 2 ? 'beide' : 'alle';

  // First names are enough once introduced — unless they collide (two Philipps).
  const first = x => (x.display_name || '').trim().split(/\s+/)[0];
  const nameOf = (x, i) => {
    if (!x.display_name) return x._username ? cap(x._username) : `Person ${i + 1}`;
    return people.filter(y => first(y) === first(x)).length > 1 ? x.display_name.trim() : first(x);
  };

  const paragraphs = [];
  paragraphs.push(formal ? 'Sehr geehrte Damen und Herren,' : 'Hallo,');

  const titleRef = listing.title ? `${formal ? 'Ihre' : 'deine'} Anzeige „${listing.title}“` : `${formal ? 'Ihre' : 'deine'} Wohnungsanzeige`;
  const details = [];
  if (listing.size)  details.push(listing.size);
  if (listing.rooms) details.push(`${listing.rooms} Zimmer`);
  const detailStr = details.length ? ` (${details.join(', ')})` : '';
  paragraphs.push(`mit großem Interesse ${plural ? 'haben wir' : 'habe ich'} ${titleRef}${detailStr} gesehen und ${plural ? 'würden uns' : 'würde mich'} sehr über eine Besichtigung freuen.`);

  // ── Who we are ──
  const introProfiles = people.filter(x => !x._hideIntro);
  const who = introProfiles.map(x => {
    if (!x.display_name && !x.occupation) return '';
    return x.occupation ? `${x.display_name || 'eine Person'} (${x.occupation})` : x.display_name;
  }).filter(Boolean);
  if (plural) {
    const kidsText = kids ? ` (davon ${kids === 1 ? 'ein Kind' : `${numWord(kids)} Kinder`})` : '';
    let head;
    if (type === 'couple' && persons === 2) head = 'als Paar';
    else if (type === 'couple')             head = `als Paar mit ${numWord(persons)} Personen${kidsText}`;
    else if (type === 'family')             head = `als Familie mit ${numWord(persons)} Personen${kidsText}`;
    else if (type === 'wg')                 head = ZU_WORD[persons] ? `als WG ${ZU_WORD[persons]}` : `als WG mit ${numWord(persons)} Personen`;
    else                                    head = ZU_WORD[persons] || `als ${numWord(persons)} Personen`;
    let intro = `Wir bewerben uns ${head}${type === 'couple' && persons === 2 ? kidsText : ''}`;
    if (who.length >= 2)      intro += `: ${germanList(who)}.`;
    else if (who.length === 1) intro += `. Ansprechperson ist ${who[0]}.`;
    else                       intro += '.';
    paragraphs.push(intro);
  } else if (who.length || people[0]?.display_name) {
    const p = people[0];
    const name = !p._hideIntro && p.display_name;
    const job = p.occupation;
    if (name && job)      paragraphs.push(`Mein Name ist ${name} und ich bin ${job}.`);
    else if (name)        paragraphs.push(`Mein Name ist ${name}.`);
    else if (job)         paragraphs.push(`Ich bin ${job}.`);
  }

  // ── Facts: a few sentences instead of a chain of "Wir …" fragments ──
  const facts = [];

  // Move-in (+ lease): one agreed wish is a clause, differing wishes are named per person.
  const mv = profiles.map((x, i) => ({ name: nameOf(x, i), kind: x.move_in_type || (x.move_in_date ? 'date' : ''), text: movePhraseOf(x, true) })).filter(m => m.text);
  const leases = profiles.map(x => x.lease_duration);
  const lease = leases.includes('long') ? 'long' : leases.includes('temporary_ok') ? 'temporary_ok' : '';
  let leaseDone = false;
  if (mv.length) {
    const texts = [...new Set(mv.map(m => m.text))];
    if (texts.length === 1) {
      const m = mv[0];
      let sentence = m.kind === 'flexible' ? `${Wir} ${plural ? 'sind' : 'bin'} beim Einzug flexibel`
        : `${Wir} ${plural ? 'könnten' : 'könnte'} ${m.text} einziehen`;
      if (lease === 'long') { sentence += ` und ${plural ? 'suchen' : 'suche'} langfristig`; leaseDone = true; }
      facts.push(sentence + '.');
    } else {
      const parts = mv.map(m => m.kind === 'flexible' ? `${m.name} ist beim Einzug flexibel`
        : m.kind === 'asap' ? `${m.name} kann schnellstmöglich einziehen` : `${m.name} kann ${m.text} einziehen`);
      facts.push(cap(germanList(parts)) + '.');
    }
  }
  if (lease && !leaseDone) {
    facts.push(lease === 'long' ? `${Wir} ${plural ? 'suchen' : 'suche'} langfristig.`
                                : `Ein befristetes Mietverhältnis wäre für ${uns} in Ordnung.`);
  }

  // Smoking + pets share one sentence.
  const smokerProfiles = profiles.filter(x => !x._hideSmoker && isFilled(x));
  const nonSmoker = smokerProfiles.length > 0 && smokerProfiles.every(x => !x.smoker);
  const pets = petItems(profiles);
  const smokeClause = nonSmoker ? (plural ? `sind ${both} Nichtraucher` : 'bin Nichtraucher') : '';
  const petClause = pets.items.length ? `${plural ? 'haben' : 'habe'} ${germanList(pets.items)}`
                  : pets.none ? `${plural ? 'haben' : 'habe'} keine Haustiere` : '';
  if (smokeClause && petClause) facts.push(`${Wir} ${smokeClause} und ${petClause}.`);
  else if (smokeClause || petClause) facts.push(`${Wir} ${smokeClause || petClause}.`);

  // Employment comes from the people themselves (their personal profiles). It is left out when the
  // occupation already says it ("Duale Studentin" + "im Studium"), so nothing is stated twice.
  // One statement if everyone matches, otherwise per person.
  const emp = people.map((x, i) => ({ name: nameOf(x, i), text: employmentText(x), redundant: employmentIsRedundant(x) }))
                    .filter(e => e.text && !e.redundant);
  // "Wir sind beide …" only when the profiles cover every person (a family of six with one
  // profile must not claim that the children are employed).
  if (emp.length) {
    const everyoneCovered = emp.length === people.length && people.length === persons;
    if (!plural || people.length === 1) facts.push(`Ich bin ${emp[0].text}.`);
    else if (everyoneCovered && new Set(emp.map(e => e.text)).size === 1) facts.push(`Wir sind ${both} ${emp[0].text}.`);
    else facts.push(cap(germanList(emp.map(e => `${e.name} ist ${e.text}`))) + '.');
  }

  // Income — only present if the person(s) chose to share it.
  const inc = profiles.map((x, i) => ({ name: nameOf(x, i), label: optionLabel('income_range', x.income_range) })).filter(e => e.label);
  if (inc.length) {
    if (inc.length === 1 && profiles.length === 1) facts.push(`${plural ? 'Unser' : 'Mein'} monatliches Netto-Haushaltseinkommen liegt bei ${inc[0].label}.`);
    else facts.push(`Unser monatliches Nettoeinkommen liegt bei ${germanList(inc.map(e => `${e.label} (${e.name})`))}.`);
  }
  if (facts.length) paragraphs.push(facts.join(' '));

  // ── Supporting documents, grouped by status: "A und B liegen vor. C ist beantragt." ──
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
    if (statusSentences.length) paragraphs.push(statusSentences.map(x => cap(x) + '.').join(' '));
  }

  // Free-text about sections
  const abouts = profiles.map(x => x.about_text).filter(Boolean);
  if (abouts.length) paragraphs.push(abouts.join('\n\n'));

  // ── Contact: phone (whose number, when there are several) + viewing times ──
  const phoneOwners = profiles.filter(x => x.phone).map((x, i) => ({ phone: x.phone, name: nameOf(x, profiles.indexOf(x)) }));
  const phones = [...new Map(phoneOwners.map(o => [o.phone, o])).values()];
  const avails = [...new Set(profiles.map(x => x.availability).filter(Boolean))];
  const contact = [];
  if (phones.length) {
    const list = phones.length > 1 && profiles.length > 1
      ? phones.map(o => `${o.phone} (${o.name})`).join(' oder ') : phones.map(o => o.phone).join(' oder ');
    contact.push(formal ? `Sie erreichen ${uns} telefonisch unter ${list}.` : `Du erreichst ${uns} telefonisch unter ${list}.`);
  }
  if (avails.length) contact.push(`Besichtigungstermine sind ${plural ? 'bei uns' : 'bei mir'} ${avails.join(' bzw. ')} möglich.`);
  if (contact.length) paragraphs.push(contact.join(' '));

  paragraphs.push(formal
    ? `Über eine Rückmeldung ${plural ? 'würden wir uns' : 'würde ich mich'} sehr freuen.`
    : `Über eine kurze Rückmeldung ${plural ? 'würden wir uns' : 'würde ich mich'} sehr freuen.`);
  const sigNames = people.map(x => x.display_name).filter(Boolean);
  paragraphs.push([formal ? 'Mit freundlichen Grüßen' : 'Viele Grüße', sigNames.join(', ')].filter(Boolean).join('\n'));

  return paragraphs.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Facts for the LLM prompt (visibleProfile() copies). Group search: `profiles` is [group profile],
// `members` supplies the people.
function summarizeForAi(profiles, members = null) {
  const lines = [];
  const people = members || profiles;
  if (members) {
    lines.push(...members.map((p, i) => `Person ${i + 1}: ${[p.display_name && `Name: ${p.display_name}`, p.occupation && `Beruf: ${p.occupation}`].filter(Boolean).join(', ') || '–'}`));
  }
  profiles.forEach((p, i) => {
    const parts = [];
    if (!members) {
      if (p.display_name) parts.push(`Name: ${p.display_name}`);
      if (p.occupation)   parts.push(`Beruf: ${p.occupation}`);
    }
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
    lines.push(`${members ? 'Gemeinsame Angaben der Gruppe' : `Person ${i + 1}`}: ${parts.join(', ')}`);
  });
  return (members ? 'Suche als Gruppe (Wir-Form).\n' : '') + lines.join('\n');
}

// ── Gruppen-Mitglieder ─────────────────────────────────────
// entries: [{ user: {id, username}, profile }] for ALL members. Other members'
// completeness is exposed as a percentage only.
function groupMembersStatus(entries) {
  return entries.map(({ user, profile }) => {
    const filled = isFilled(profile);
    return { id: user.id, username: user.username, hasProfile: filled,
             percent: filled ? completeness(profile).percent : 0,
             display_name: filled ? profile.display_name || '' : '' };
  });
}

module.exports = {
  OPTIONS, SHARE_KEYS, SHARE_KEY_NAMES, SECTIONS, DOC_STATUS_LABEL,
  householdOf, normalizeGroupProfile, groupAsProfile, completenessGroup, GROUP_SHARE_KEY_NAMES, MEMBER_FED_KEYS, cleanDocuments, parseDocuments, parseShare, hasData, normalizeInput,
  completeness, isFilled, movePhraseOf, personsOf, childrenOf, visibleProfile, blockStatus,
  buildPlaceholders, applyTemplate, buildGuidedMessage, summarizeForAi, groupMembersStatus,
  germanList, isPluralDoc, optionLabel,
};
