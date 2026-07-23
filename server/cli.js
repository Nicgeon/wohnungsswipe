#!/usr/bin/env node
/**
 * WohnungsSwipe Admin CLI
 *
 * Verwendung:
 *   docker exec wohnungsswipe node cli.js <befehl> [optionen]
 *
 * Befehle:
 *   users                          – alle Nutzer auflisten
 *   promote <username|email>       – Admin-Rechte vergeben
 *   demote  <username|email>       – Admin-Rechte entziehen
 *   password <username|email> <neues-passwort>  – Passwort setzen
 *   delete  <username|email>       – Nutzer löschen (mit Bestätigung)
 *   info    <username|email>       – Nutzerdetails anzeigen
 */

const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');
const initSqlJs = require('sql.js');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/wohnungsswipe.db');

// ── Colours ──────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};
const ok   = msg => console.log(`${c.green}✓${c.reset} ${msg}`);
const err  = msg => console.error(`${c.red}✗ ${msg}${c.reset}`);
const info = msg => console.log(`${c.cyan}→${c.reset} ${msg}`);
const warn = msg => console.log(`${c.yellow}⚠${c.reset}  ${msg}`);
const bold = msg => `${c.bold}${msg}${c.reset}`;

// ── DB helpers ────────────────────────────────────────────
async function openDb() {
  if (!fs.existsSync(DB_PATH)) {
    err(`Datenbank nicht gefunden: ${DB_PATH}`);
    err('Läuft der Server? Ist DB_PATH korrekt gesetzt?');
    process.exit(1);
  }
  const SQL = await initSqlJs();
  return new SQL.Database(fs.readFileSync(DB_PATH));
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function dbAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbGet(db, sql, params = []) {
  return dbAll(db, sql, params)[0] || null;
}

function dbRun(db, sql, params = []) {
  db.run(sql, params);
}

function findUser(db, identifier) {
  return dbGet(db,
    'SELECT * FROM users WHERE username=? OR email=? COLLATE NOCASE',
    [identifier, identifier]
  );
}

// ── Commands ──────────────────────────────────────────────
async function cmdUsers(db) {
  const users = dbAll(db, 'SELECT id,username,email,is_admin,created_at FROM users ORDER BY id');
  if (!users.length) { warn('Keine Nutzer in der Datenbank.'); return; }

  const colW = { id: 4, user: 20, email: 30, admin: 7, created: 20 };
  const line = `${c.gray}${'─'.repeat(85)}${c.reset}`;
  const header =
    bold('ID  ').padEnd(colW.id + 10) +
    bold('Username').padEnd(colW.user) +
    bold('E-Mail').padEnd(colW.email) +
    bold('Admin').padEnd(colW.admin) +
    bold('Registriert');

  console.log(`\n${c.bold}${c.cyan}WohnungsSwipe – Nutzer (${users.length})${c.reset}`);
  console.log(line);
  console.log(header);
  console.log(line);

  users.forEach(u => {
    const adminStr = u.is_admin ? `${c.yellow}✓ Ja${c.reset}` : `${c.gray}Nein${c.reset}`;
    const dateStr  = u.created_at ? u.created_at.substring(0, 16) : '—';
    const idStr    = String(u.id).padEnd(4);
    const userStr  = u.username.padEnd(colW.user);
    const emailStr = u.email.padEnd(colW.email);
    console.log(`${c.gray}${idStr}${c.reset}  ${userStr}${emailStr}${adminStr.padEnd(colW.admin + 14)}${c.gray}${dateStr}${c.reset}`);
  });
  console.log(line);
  console.log(`${c.gray}${users.length} Nutzer insgesamt${c.reset}\n`);
}

async function cmdPromote(db, identifier) {
  if (!identifier) { err('Bitte Username oder E-Mail angeben.\n  Beispiel: node cli.js promote nicgeon'); process.exit(1); }
  const user = findUser(db, identifier);
  if (!user) { err(`Nutzer nicht gefunden: "${identifier}"`); process.exit(1); }
  if (user.is_admin) { warn(`${user.username} ist bereits Admin.`); return; }
  dbRun(db, 'UPDATE users SET is_admin=1 WHERE id=?', [user.id]);
  saveDb(db);
  ok(`${bold(user.username)} (${user.email}) hat jetzt Admin-Rechte.`);
}

async function cmdDemote(db, identifier) {
  if (!identifier) { err('Bitte Username oder E-Mail angeben.'); process.exit(1); }
  const user = findUser(db, identifier);
  if (!user) { err(`Nutzer nicht gefunden: "${identifier}"`); process.exit(1); }
  if (!user.is_admin) { warn(`${user.username} ist kein Admin.`); return; }
  dbRun(db, 'UPDATE users SET is_admin=0 WHERE id=?', [user.id]);
  saveDb(db);
  ok(`Admin-Rechte von ${bold(user.username)} (${user.email}) wurden entfernt.`);
}

async function cmdPassword(db, identifier, newPassword) {
  if (!identifier || !newPassword) {
    err('Verwendung: node cli.js password <username|email> <neues-passwort>');
    process.exit(1);
  }
  if (newPassword.length < 6) {
    err('Passwort muss mindestens 6 Zeichen lang sein.');
    process.exit(1);
  }
  const user = findUser(db, identifier);
  if (!user) { err(`Nutzer nicht gefunden: "${identifier}"`); process.exit(1); }
  const hash = await bcrypt.hash(newPassword, 10);
  dbRun(db, 'UPDATE users SET password_hash=? WHERE id=?', [hash, user.id]);
  saveDb(db);
  ok(`Passwort für ${bold(user.username)} (${user.email}) wurde geändert.`);
  warn('Der Nutzer wird beim nächsten Login aufgefordert, sich erneut anzumelden.');
}

async function cmdDelete(db, identifier) {
  if (!identifier) { err('Bitte Username oder E-Mail angeben.'); process.exit(1); }
  const user = findUser(db, identifier);
  if (!user) { err(`Nutzer nicht gefunden: "${identifier}"`); process.exit(1); }

  // Count their data
  const swipeCount   = dbGet(db, 'SELECT COUNT(*) as c FROM swipes WHERE user_id=?',   [user.id])?.c || 0;
  const groupCount   = dbGet(db, 'SELECT COUNT(*) as c FROM group_members WHERE user_id=?', [user.id])?.c || 0;
  const jobCount     = dbGet(db, 'SELECT COUNT(*) as c FROM search_jobs WHERE added_by=?',  [user.id])?.c || 0;

  warn(`Du bist dabei, folgenden Nutzer zu löschen:`);
  console.log(`  ID:       ${user.id}`);
  console.log(`  Username: ${bold(user.username)}`);
  console.log(`  E-Mail:   ${user.email}`);
  console.log(`  Admin:    ${user.is_admin ? 'Ja' : 'Nein'}`);
  console.log(`  Daten:    ${swipeCount} Swipes · ${groupCount} Gruppen · ${jobCount} Suchagenten`);
  console.log('');
  warn(`${c.red}${c.bold}Diese Aktion kann nicht rückgängig gemacht werden!${c.reset}`);
  console.log('');
  info('Zum Bestätigen: Führe den Befehl mit --confirm aus:');
  console.log(`  node cli.js delete ${identifier} --confirm`);
}

async function cmdDeleteConfirmed(db, identifier) {
  const user = findUser(db, identifier);
  if (!user) { err(`Nutzer nicht gefunden: "${identifier}"`); process.exit(1); }
  dbRun(db, 'DELETE FROM swipes            WHERE user_id=?', [user.id]);
  dbRun(db, 'DELETE FROM group_members     WHERE user_id=?', [user.id]);
  dbRun(db, 'DELETE FROM push_subscriptions WHERE user_id=?', [user.id]);
  dbRun(db, 'DELETE FROM contacts          WHERE user_id=?', [user.id]);
  dbRun(db, 'DELETE FROM notification_queue WHERE user_id=?', [user.id]);
  dbRun(db, 'UPDATE search_jobs SET added_by=NULL WHERE added_by=?', [user.id]);
  dbRun(db, 'DELETE FROM users             WHERE id=?',      [user.id]);
  saveDb(db);
  ok(`Nutzer ${bold(user.username)} wurde gelöscht.`);
}

async function cmdInfo(db, identifier) {
  if (!identifier) { err('Bitte Username oder E-Mail angeben.'); process.exit(1); }
  const user = findUser(db, identifier);
  if (!user) { err(`Nutzer nicht gefunden: "${identifier}"`); process.exit(1); }

  const swipes   = dbAll(db, 'SELECT action, COUNT(*) as c FROM swipes WHERE user_id=? GROUP BY action', [user.id]);
  const groups   = dbAll(db, 'SELECT g.name FROM groups_table g JOIN group_members gm ON g.id=gm.group_id WHERE gm.user_id=?', [user.id]);
  const jobs     = dbAll(db, 'SELECT label, visibility FROM search_jobs WHERE added_by=?', [user.id]);
  const queueLen = dbGet(db, 'SELECT COUNT(*) as c FROM notification_queue WHERE user_id=?', [user.id])?.c || 0;

  console.log(`\n${c.bold}${c.cyan}Nutzer: ${user.username}${c.reset}`);
  console.log(`${'─'.repeat(40)}`);
  console.log(`  ID:           ${user.id}`);
  console.log(`  Username:     ${bold(user.username)}`);
  console.log(`  E-Mail:       ${user.email}`);
  console.log(`  Admin:        ${user.is_admin ? `${c.yellow}Ja${c.reset}` : 'Nein'}`);
  console.log(`  Registriert:  ${user.created_at || '—'}`);
  console.log(`  Digest:       ${user.notify_digest_interval || 'instant'} | Schwellenwert: ${user.notify_threshold || 1}`);
  console.log(`  ntfy-Topic:   ${user.ntfy_topic || '(nicht gesetzt)'}`);
  console.log('');
  console.log(`  Swipes:`);
  swipes.forEach(s => console.log(`    ${s.action.padEnd(10)} ${s.c}x`));
  console.log(`  Gruppen:      ${groups.map(g => g.name).join(', ') || '(keine)'}`);
  console.log(`  Suchagenten:  ${jobs.map(j => `${j.label} [${j.visibility}]`).join(', ') || '(keine)'}`);
  console.log(`  Queue:        ${queueLen} ausstehende Benachrichtigungen`);
  console.log('');
}

function printHelp() {
  console.log(`
${c.bold}${c.cyan}WohnungsSwipe Admin CLI${c.reset}
${'─'.repeat(50)}

${c.bold}Verwendung:${c.reset}
  docker exec wohnungsswipe node cli.js <befehl> [optionen]

${c.bold}Befehle:${c.reset}
  ${c.yellow}users${c.reset}
      Alle Nutzer auflisten

  ${c.yellow}info <username|email>${c.reset}
      Detaillierte Nutzerinformationen

  ${c.yellow}promote <username|email>${c.reset}
      Admin-Rechte vergeben

  ${c.yellow}demote <username|email>${c.reset}
      Admin-Rechte entziehen

  ${c.yellow}password <username|email> <neues-passwort>${c.reset}
      Passwort eines Nutzers zurücksetzen

  ${c.yellow}delete <username|email>${c.reset}
      Nutzer löschen (zeigt Vorschau + Bestätigungsbefehl)

  ${c.yellow}delete <username|email> --confirm${c.reset}
      Nutzer endgültig löschen

${c.bold}Beispiele:${c.reset}
  docker exec wohnungsswipe node cli.js users
  docker exec wohnungsswipe node cli.js promote nicgeon
  docker exec wohnungsswipe node cli.js password nicgeon geheimespasswort123
  docker exec wohnungsswipe node cli.js info nicgeon
  docker exec wohnungsswipe node cli.js delete altnutzer --confirm
`);
}

// ── Main ──────────────────────────────────────────────────
(async () => {
  const [,, cmd, arg1, arg2] = process.argv;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    process.exit(0);
  }

  const db = await openDb();

  try {
    switch (cmd) {
      case 'users':    await cmdUsers(db);                            break;
      case 'promote':  await cmdPromote(db, arg1);                    break;
      case 'demote':   await cmdDemote(db, arg1);                     break;
      case 'password': await cmdPassword(db, arg1, arg2);             break;
      case 'info':     await cmdInfo(db, arg1);                       break;
      case 'delete':
        if (arg2 === '--confirm') await cmdDeleteConfirmed(db, arg1);
        else                      await cmdDelete(db, arg1);
        break;
      default:
        err(`Unbekannter Befehl: "${cmd}"`);
        info('Verfügbare Befehle: users, promote, demote, password, info, delete');
        info('Hilfe:              node cli.js help');
        process.exit(1);
    }
  } catch (e) {
    err(`Unerwarteter Fehler: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  }
})();
