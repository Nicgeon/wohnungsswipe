const express    = require('express');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const initSqlJs  = require('sql.js');
const fetch      = require('node-fetch');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const MemoryStore = require('memorystore')(session);
const webpush    = require('web-push');
const { pollSearchJob, checkExistingListings, detectPlatform, scrapeListing } = require('./poller');
const mailer     = require('./mailer');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Web Push VAPID setup ──────────────────────────────────
let VAPID_PUBLIC, VAPID_PRIVATE;
const vapidFile = process.env.VAPID_FILE || path.join(__dirname, '../data/vapid.json');

function initVapid() {
  try {
    if (fs.existsSync(vapidFile)) {
      const keys = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
      VAPID_PUBLIC  = keys.publicKey;
      VAPID_PRIVATE = keys.privateKey;
    } else {
      const keys = webpush.generateVAPIDKeys();
      VAPID_PUBLIC  = keys.publicKey;
      VAPID_PRIVATE = keys.privateKey;
      fs.mkdirSync(path.dirname(vapidFile), { recursive: true });
      fs.writeFileSync(vapidFile, JSON.stringify(keys));
    }
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@wohnungsswipe.local',
      VAPID_PUBLIC,
      VAPID_PRIVATE
    );
    console.log('[Push] VAPID initialisiert');
  } catch (e) {
    console.error('[Push] VAPID-Fehler:', e.message);
  }
}

// ── Database ──────────────────────────────────────────────
const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/wohnungsswipe.db');
const dbDir  = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let db;

async function initDb() {
  const SQL = await initSqlJs();
  db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      reset_token   TEXT,
      reset_expires DATETIME,
      notify_email  INTEGER DEFAULT 1,
      notify_push   INTEGER DEFAULT 1,
      notify_match  INTEGER DEFAULT 1,
      notify_new    INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS groups_table (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      created_by  INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id  INTEGER,
      user_id   INTEGER,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS listings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      url         TEXT UNIQUE NOT NULL,
      title       TEXT,
      price       TEXT,
      price_cold  TEXT,
      size        TEXT,
      location    TEXT,
      rooms       TEXT,
      image_url   TEXT,
      images_json TEXT DEFAULT '[]',
      tags_json   TEXT DEFAULT '[]',
      description TEXT,
      platform    TEXT DEFAULT 'unbekannt',
      status      TEXT DEFAULT 'active',
      added_by    INTEGER,
      added_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS swipes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      listing_id INTEGER,
      action     TEXT CHECK(action IN ('like','dislike','superlike','skip')),
      swiped_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, listing_id)
    );
    CREATE TABLE IF NOT EXISTS search_jobs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      label        TEXT NOT NULL,
      search_url   TEXT UNIQUE NOT NULL,
      platform     TEXT DEFAULT 'unbekannt',
      interval_min INTEGER DEFAULT 60,
      active       INTEGER DEFAULT 1,
      last_run     DATETIME,
      last_error   TEXT,
      last_new     INTEGER DEFAULT 0,
      total_found  INTEGER DEFAULT 0,
      added_by        INTEGER,
      visibility      TEXT DEFAULT 'global',
      visibility_id   INTEGER,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      endpoint   TEXT UNIQUE NOT NULL,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id   INTEGER NOT NULL,
      user_id      INTEGER,
      group_id     INTEGER,
      note         TEXT DEFAULT '',
      contacted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(listing_id, user_id, group_id)
    );
    CREATE TABLE IF NOT EXISTS archive_notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id  INTEGER UNIQUE NOT NULL,
      reason      TEXT DEFAULT 'offline',
      archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrations
  const migrate = (sql) => { try { db.run(sql); } catch(_) {} };
  migrate("ALTER TABLE listings ADD COLUMN price_cold  TEXT");
  migrate("ALTER TABLE listings ADD COLUMN images_json TEXT DEFAULT '[]'");
  migrate("ALTER TABLE listings ADD COLUMN tags_json   TEXT DEFAULT '[]'");
  migrate("ALTER TABLE listings ADD COLUMN status      TEXT DEFAULT 'active'");
  migrate("ALTER TABLE users    ADD COLUMN reset_token   TEXT");
  migrate("ALTER TABLE users    ADD COLUMN reset_expires DATETIME");
  migrate("ALTER TABLE users    ADD COLUMN notify_email  INTEGER DEFAULT 1");
  migrate("ALTER TABLE users    ADD COLUMN notify_push   INTEGER DEFAULT 1");
  migrate("ALTER TABLE users    ADD COLUMN notify_match  INTEGER DEFAULT 1");
  migrate("ALTER TABLE users    ADD COLUMN notify_new    INTEGER DEFAULT 1");
  migrate("ALTER TABLE search_jobs ADD COLUMN visibility    TEXT DEFAULT 'global'");
  migrate("ALTER TABLE search_jobs ADD COLUMN visibility_id INTEGER");

  // Migrate swipes table CHECK constraint to allow 'skip' (SQLite needs table rebuild for this)
  try {
    const tableInfo = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='swipes'");
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes("'skip'")) {
      db.run(`
        CREATE TABLE swipes_new (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER,
          listing_id INTEGER,
          action     TEXT CHECK(action IN ('like','dislike','superlike','skip')),
          swiped_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, listing_id)
        );
        INSERT INTO swipes_new SELECT * FROM swipes;
        DROP TABLE swipes;
        ALTER TABLE swipes_new RENAME TO swipes;
      `);
      console.log('[Migration] swipes-Tabelle auf "skip"-Aktion erweitert');
    }
  } catch (e) { console.error('[Migration] swipes table:', e.message); }

  saveDb();
}

function saveDb() {
  try { fs.writeFileSync(dbPath, Buffer.from(db.export())); }
  catch (e) { console.error('DB save:', e.message); }
}
setInterval(saveDb, 30000);
['exit','SIGINT','SIGTERM'].forEach(sig =>
  process.on(sig, () => { saveDb(); if (sig !== 'exit') process.exit(0); })
);

// ── DB helpers ─────────────────────────────────────────────
function dbAll(sql, p = []) {
  try {
    const s = db.prepare(sql); s.bind(p);
    const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free();
    return rows;
  } catch (e) { console.error('dbAll:', e.message); return []; }
}
function dbGet(sql, p = []) { return dbAll(sql, p)[0] || null; }
function dbRun(sql, p = []) {
  try {
    db.run(sql, p);
    const r = db.exec('SELECT last_insert_rowid() as id');
    return { lastInsertRowid: r[0] ? r[0].values[0][0] : null };
  } catch (e) { console.error('dbRun:', e.message); throw e; }
}

function insertListing(data, addedBy = null) {
  const ex = dbGet('SELECT id FROM listings WHERE url=?', [data.url]);
  if (ex) return { id: ex.id, isNew: false };
  const r = dbRun(
    'INSERT INTO listings (url,title,price,price_cold,size,location,rooms,image_url,images_json,tags_json,description,platform,status,added_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [data.url, data.title||'', data.price||'', data.price_cold||'', data.size||'',
     data.location||'', data.rooms||'', data.image_url||'', data.images_json||'[]',
     data.tags_json||'[]', data.description||'', data.platform||'unbekannt',
     data.status||'active', addedBy]
  );
  return { id: r.lastInsertRowid, isNew: true };
}

// ── Middleware ─────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
  store:             new MemoryStore({ checkPeriod: 86400000 }),
  secret:            process.env.SESSION_SECRET || 'wohnungsswipe-dev-secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
const requireAuth = (req, res, next) =>
  req.session.userId ? next() : res.status(401).json({ error: 'Nicht eingeloggt' });

// ── Auth ───────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Alle Felder erforderlich' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Passwort mindestens 6 Zeichen' });
  if (dbGet('SELECT id FROM users WHERE email=? OR username=?', [email.toLowerCase(), username]))
    return res.status(409).json({ error: 'Username oder E-Mail bereits vergeben' });
  const hash = await bcrypt.hash(password, 10);
  const r    = dbRun('INSERT INTO users (username,email,password_hash) VALUES (?,?,?)',
    [username.trim(), email.trim().toLowerCase(), hash]);
  saveDb();
  req.session.userId   = r.lastInsertRowid;
  req.session.username = username.trim();
  res.json({ success: true, username: username.trim(), userId: r.lastInsertRowid });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
  const user = dbGet('SELECT * FROM users WHERE email=?', [email.trim().toLowerCase()]);
  if (!user || !await bcrypt.compare(password, user.password_hash))
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  req.session.userId   = user.id;
  req.session.username = user.username;
  res.json({ success: true, username: user.username, userId: user.id });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const user = dbGet('SELECT id,username,email,created_at,notify_email,notify_push,notify_match,notify_new FROM users WHERE id=?', [req.session.userId]);
  res.json(user ? { loggedIn: true, ...user } : { loggedIn: false });
});

app.get('/api/auth/stats', requireAuth, (req, res) => {
  const rows = dbAll('SELECT action, COUNT(*) as cnt FROM swipes WHERE user_id=? GROUP BY action', [req.session.userId]);
  const s = { likes: 0, superlikes: 0, dislikes: 0 };
  rows.forEach(r => {
    if (r.action === 'like')      s.likes      = r.cnt;
    if (r.action === 'superlike') s.superlikes = r.cnt;
    if (r.action === 'dislike')   s.dislikes   = r.cnt;
  });
  s.groups = dbGet('SELECT COUNT(*) as c FROM group_members WHERE user_id=?', [req.session.userId])?.c || 0;
  res.json(s);
});

// ── Password reset ─────────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-Mail erforderlich' });
  const user = dbGet('SELECT * FROM users WHERE email=?', [email.trim().toLowerCase()]);
  // Always return success to avoid user enumeration
  res.json({ success: true, message: 'Falls ein Account existiert, wurde eine E-Mail gesendet.' });
  if (!user) return;
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h
  dbRun("UPDATE users SET reset_token=?, reset_expires=? WHERE id=?", [token, expires, user.id]);
  saveDb();
  await mailer.sendPasswordResetMail(user.email, user.username, token);
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 6)
    return res.status(400).json({ error: 'Ungültige Anfrage' });
  const user = dbGet("SELECT * FROM users WHERE reset_token=?", [token]);
  if (!user) return res.status(400).json({ error: 'Ungültiger oder abgelaufener Token' });
  if (new Date(user.reset_expires + 'Z') < new Date())
    return res.status(400).json({ error: 'Token abgelaufen – bitte erneut anfordern' });
  const hash = await bcrypt.hash(password, 10);
  dbRun("UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL WHERE id=?", [hash, user.id]);
  saveDb();
  await mailer.sendPasswordChangedMail(user.email, user.username);
  res.json({ success: true });
});

// ── User settings ──────────────────────────────────────────
app.put('/api/user/username', requireAuth, (req, res) => {
  const { username } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'Username darf nicht leer sein' });
  if (dbGet('SELECT id FROM users WHERE username=? AND id!=?', [username.trim(), req.session.userId]))
    return res.status(409).json({ error: 'Username bereits vergeben' });
  dbRun('UPDATE users SET username=? WHERE id=?', [username.trim(), req.session.userId]);
  req.session.username = username.trim();
  saveDb();
  res.json({ success: true, username: username.trim() });
});

app.put('/api/user/email', requireAuth, (req, res) => {
  const { email } = req.body;
  if (!email?.includes('@')) return res.status(400).json({ error: 'Gültige E-Mail erforderlich' });
  if (dbGet('SELECT id FROM users WHERE email=? AND id!=?', [email.toLowerCase(), req.session.userId]))
    return res.status(409).json({ error: 'E-Mail bereits vergeben' });
  dbRun('UPDATE users SET email=? WHERE id=?', [email.trim().toLowerCase(), req.session.userId]);
  saveDb();
  res.json({ success: true });
});

app.put('/api/user/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Ungültige Anfrage' });
  const user = dbGet('SELECT * FROM users WHERE id=?', [req.session.userId]);
  if (!await bcrypt.compare(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
  const hash = await bcrypt.hash(newPassword, 10);
  dbRun('UPDATE users SET password_hash=? WHERE id=?', [hash, req.session.userId]);
  saveDb();
  await mailer.sendPasswordChangedMail(user.email, user.username);
  res.json({ success: true });
});

app.put('/api/user/notifications', requireAuth, (req, res) => {
  const { notify_email, notify_push, notify_match, notify_new } = req.body;
  dbRun('UPDATE users SET notify_email=?,notify_push=?,notify_match=?,notify_new=? WHERE id=?', [
    notify_email ? 1 : 0, notify_push ? 1 : 0,
    notify_match ? 1 : 0, notify_new  ? 1 : 0,
    req.session.userId,
  ]);
  saveDb();
  res.json({ success: true });
});

// ── Web Push ───────────────────────────────────────────────
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC || null });
});

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth)
    return res.status(400).json({ error: 'Ungültige Subscription' });
  try {
    dbRun('INSERT OR REPLACE INTO push_subscriptions (user_id,endpoint,p256dh,auth) VALUES (?,?,?,?)',
      [req.session.userId, endpoint, keys.p256dh, keys.auth]);
    saveDb();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  dbRun('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?', [req.session.userId, endpoint]);
  saveDb();
  res.json({ success: true });
});

// ── Push sender helper ─────────────────────────────────────
async function sendPushToUser(userId, payload) {
  const subs = dbAll('SELECT * FROM push_subscriptions WHERE user_id=?', [userId]);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) {
        // Subscription expired – remove it
        dbRun('DELETE FROM push_subscriptions WHERE id=?', [sub.id]);
        saveDb();
      } else {
        console.warn(`[Push] Fehler für user ${userId}:`, e.message);
      }
    }
  }
}

// ── Notify on group match ──────────────────────────────────
async function checkAndNotifyMatch(listingId, groupId) {
  const memberIds = dbAll('SELECT user_id FROM group_members WHERE group_id=?', [groupId]).map(m => m.user_id);
  if (!memberIds.length) return;

  // Check if ALL members liked/superliked
  const likeCount = dbGet(
    `SELECT COUNT(*) as c FROM swipes WHERE listing_id=? AND user_id IN (${memberIds.map(()=>'?').join(',')}) AND action IN ('like','superlike')`,
    [listingId, ...memberIds]
  )?.c || 0;

  if (likeCount < memberIds.length) return; // not a full match yet

  const listing = dbGet('SELECT * FROM listings WHERE id=?', [listingId]);
  const group   = dbGet('SELECT * FROM groups_table WHERE id=?', [groupId]);
  if (!listing || !group) return;

  console.log(`[Notify] Match! Gruppe "${group.name}" für Inserat "${listing.title}"`);

  for (const uid of memberIds) {
    const user = dbGet('SELECT * FROM users WHERE id=?', [uid]);
    if (!user) continue;

    // Push notification
    if (user.notify_push && user.notify_match) {
      await sendPushToUser(uid, {
        title:  `🎉 Match in "${group.name}"!`,
        body:   listing.title.substring(0, 80),
        url:    '/?view=groups',
        icon:   '/icon-192.png',
      });
    }
    // Email notification
    if (user.notify_email && user.notify_match) {
      await mailer.sendMatchMail(user.email, user.username, group.name, listing);
    }
  }
}

// ── Listings ───────────────────────────────────────────────
app.post('/api/listings/add', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL erforderlich' });
  let listing = dbGet('SELECT * FROM listings WHERE url=?', [url]);
  if (!listing) {
    const scraped = await scrapeListing(url);
    const { id } = insertListing(scraped, req.session.userId);
    listing = dbGet('SELECT * FROM listings WHERE id=?', [id]);
  }
  saveDb();
  res.json({ success: true, listing });
});

app.get('/api/listings/swipe', requireAuth, (req, res) => {
  const uid = req.session.userId;
  // Listings are visible if:
  //  (a) added manually by any user  (no job source → always global)
  //  (b) added by a job with visibility='global'
  //  (c) added by a job with visibility='private' AND added_by = this user
  //  (d) added by a job with visibility='group'   AND user is member of that group
  // Skipped listings ('skip' action) stay in the queue but are sorted to the end,
  // so they resurface after everything else has been swiped.
  const listings = dbAll(`
    SELECT DISTINCT l.*, sw.action as _skip_marker FROM listings l
    LEFT JOIN swipes sw ON sw.listing_id = l.id AND sw.user_id = ? AND sw.action = 'skip'
    LEFT JOIN search_jobs j ON l.added_by = j.added_by AND j.id = (
      SELECT id FROM search_jobs WHERE added_by = l.added_by
        AND visibility != 'global' LIMIT 1
    )
    WHERE l.status = 'active'
    AND l.id NOT IN (SELECT listing_id FROM swipes WHERE user_id=? AND action != 'skip')
    AND (
      -- manually added or job is global (default)
      l.id IN (
        SELECT id FROM listings WHERE added_by IS NULL OR added_by = 0
      )
      OR l.id IN (
        SELECT li.id FROM listings li
        JOIN search_jobs sj ON li.added_by = sj.added_by
        WHERE sj.visibility = 'global'
      )
      -- private: only the job owner
      OR l.id IN (
        SELECT li.id FROM listings li
        JOIN search_jobs sj ON li.added_by = sj.added_by
        WHERE sj.visibility = 'private' AND sj.added_by = ?
      )
      -- group: user must be member
      OR l.id IN (
        SELECT li.id FROM listings li
        JOIN search_jobs sj ON li.added_by = sj.added_by
        JOIN group_members gm ON gm.group_id = sj.visibility_id AND gm.user_id = ?
        WHERE sj.visibility = 'group'
      )
      -- manually added by this user or no job restriction
      OR l.added_by = ?
      OR l.id NOT IN (
        SELECT li.id FROM listings li
        JOIN search_jobs sj ON li.added_by = sj.added_by
        WHERE sj.visibility != 'global'
      )
    )
    ORDER BY (CASE WHEN sw.action = 'skip' THEN 1 ELSE 0 END), l.added_at DESC
  `, [uid, uid, uid, uid, uid]);
  res.json({ listings });
});

app.post('/api/listings/swipe', requireAuth, async (req, res) => {
  const { listingId, action } = req.body;
  if (!['like','dislike','superlike','skip'].includes(action))
    return res.status(400).json({ error: 'Ungültige Aktion' });
  try { dbRun('INSERT OR REPLACE INTO swipes (user_id,listing_id,action) VALUES (?,?,?)',
    [req.session.userId, listingId, action]); }
  catch(e) {}
  saveDb();

  // Check for group matches if this was a positive action
  if (action === 'like' || action === 'superlike') {
    const groups = dbAll(`
      SELECT DISTINCT gm.group_id FROM group_members gm
      WHERE gm.user_id=?
    `, [req.session.userId]);
    for (const { group_id } of groups) {
      await checkAndNotifyMatch(listingId, group_id).catch(()=>{});
    }
  }
  res.json({ success: true });
});

// Undo the most recent swipe action by this user (for "Sofort-Undo" button)
app.post('/api/listings/swipe/undo-last', requireAuth, (req, res) => {
  const last = dbGet('SELECT * FROM swipes WHERE user_id=? ORDER BY swiped_at DESC, id DESC LIMIT 1', [req.session.userId]);
  if (!last) return res.status(404).json({ error: 'Keine letzte Aktion vorhanden' });
  dbRun('DELETE FROM swipes WHERE id=?', [last.id]);
  saveDb();
  const listing = dbGet('SELECT * FROM listings WHERE id=?', [last.listing_id]);
  res.json({ success: true, listing, undoneAction: last.action });
});

app.delete('/api/listings/swipe/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM swipes WHERE user_id=? AND listing_id=?', [req.session.userId, req.params.id]);
  saveDb();
  res.json({ success: true });
});

app.get('/api/listings/rated', requireAuth, (req, res) => {
  const listings = dbAll(`
    SELECT l.*, s.action as my_swipe,
      CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as contacted,
      c.note as contact_note
    FROM listings l
    JOIN swipes s ON l.id=s.listing_id AND s.user_id=?
    LEFT JOIN contacts c ON c.listing_id=l.id AND c.user_id=? AND c.group_id IS NULL
    WHERE l.status != 'offline'
    ORDER BY s.swiped_at DESC
  `, [req.session.userId, req.session.userId]);
  res.json({ listings });
});

app.get('/api/listings/liked', requireAuth, (req, res) => {
  const { groupId } = req.query;
  let liked;
  if (groupId) {
    const members = dbAll('SELECT user_id FROM group_members WHERE group_id=?', [groupId]);
    if (!members.length) return res.json({ listings: [] });
    const ids = members.map(m => m.user_id);
    const ph  = ids.map(()=>'?').join(',');
    liked = dbAll(`
      SELECT l.*,
        COUNT(CASE WHEN s.action IN ('like','superlike') THEN 1 END) as like_count,
        GROUP_CONCAT(CASE WHEN s.action IN ('like','superlike') THEN u.username END) as liked_by
      FROM listings l
      JOIN swipes s ON l.id=s.listing_id AND s.user_id IN (${ph})
      JOIN users u ON s.user_id=u.id
      GROUP BY l.id HAVING like_count > 0
      ORDER BY like_count DESC, l.added_at DESC
    `, ids);
  } else {
    liked = dbAll(`SELECT l.* FROM listings l JOIN swipes s ON l.id=s.listing_id
      WHERE s.user_id=? AND s.action IN ('like','superlike') ORDER BY s.swiped_at DESC`,
      [req.session.userId]);
  }
  res.json({ listings: liked || [] });
});

// ── Archive ───────────────────────────────────────────────
// Returns offline listings that this user has swiped on
app.get('/api/archive', requireAuth, (req, res) => {
  const listings = dbAll(`
    SELECT l.*, s.action as my_swipe,
      an.archived_at, an.reason as archive_reason,
      CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as contacted,
      c.note as contact_note
    FROM listings l
    JOIN swipes s ON l.id=s.listing_id AND s.user_id=?
    LEFT JOIN archive_notes an ON an.listing_id=l.id
    LEFT JOIN contacts c ON c.listing_id=l.id AND c.user_id=? AND c.group_id IS NULL
    WHERE l.status = 'offline'
    ORDER BY an.archived_at DESC, s.swiped_at DESC
  `, [req.session.userId, req.session.userId]);
  res.json({ listings });
});

// ── Contacts ───────────────────────────────────────────────
// Mark a listing as "contacted" for current user or a group
app.post('/api/contacts', requireAuth, (req, res) => {
  const { listingId, groupId, note } = req.body;
  if (!listingId) return res.status(400).json({ error: 'listingId erforderlich' });
  if (groupId) {
    // verify user is in group
    if (!dbGet('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', [groupId, req.session.userId]))
      return res.status(403).json({ error: 'Kein Zugriff auf diese Gruppe' });
    try {
      dbRun('INSERT OR REPLACE INTO contacts (listing_id,user_id,group_id,note,contacted_at) VALUES (?,NULL,?,?,datetime("now"))',
        [listingId, groupId, note||'']);
    } catch(e) { return res.status(500).json({ error: e.message }); }
  } else {
    try {
      dbRun('INSERT OR REPLACE INTO contacts (listing_id,user_id,group_id,note,contacted_at) VALUES (?,?,NULL,?,datetime("now"))',
        [listingId, req.session.userId, note||'']);
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  saveDb();
  res.json({ success: true });
});

app.delete('/api/contacts/:listingId', requireAuth, (req, res) => {
  const { groupId } = req.query;
  if (groupId) {
    dbRun('DELETE FROM contacts WHERE listing_id=? AND group_id=?', [req.params.listingId, groupId]);
  } else {
    dbRun('DELETE FROM contacts WHERE listing_id=? AND user_id=? AND group_id IS NULL', [req.params.listingId, req.session.userId]);
  }
  saveDb();
  res.json({ success: true });
});

// Update note on contact
app.patch('/api/contacts/:listingId', requireAuth, (req, res) => {
  const { note, groupId } = req.body;
  if (groupId) {
    dbRun('UPDATE contacts SET note=? WHERE listing_id=? AND group_id=?', [note||'', req.params.listingId, groupId]);
  } else {
    dbRun('UPDATE contacts SET note=? WHERE listing_id=? AND user_id=? AND group_id IS NULL', [note||'', req.params.listingId, req.session.userId]);
  }
  saveDb();
  res.json({ success: true });
});

// Get contact status for a listing (used by group results)
app.get('/api/contacts/:listingId', requireAuth, (req, res) => {
  const { groupId } = req.query;
  let contact;
  if (groupId) {
    contact = dbGet('SELECT * FROM contacts WHERE listing_id=? AND group_id=?', [req.params.listingId, groupId]);
  } else {
    contact = dbGet('SELECT * FROM contacts WHERE listing_id=? AND user_id=? AND group_id IS NULL', [req.params.listingId, req.session.userId]);
  }
  res.json({ contact: contact || null });
});

// ── Groups ─────────────────────────────────────────────────
app.get('/api/groups/mine', requireAuth, (req, res) => {
  res.json({ groups: dbAll(`
    SELECT g.*, COUNT(m2.user_id) as member_count
    FROM groups_table g
    JOIN group_members m  ON g.id=m.group_id  AND m.user_id=?
    LEFT JOIN group_members m2 ON g.id=m2.group_id
    GROUP BY g.id ORDER BY g.created_at DESC
  `, [req.session.userId]) });
});

app.post('/api/groups/create', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Gruppenname erforderlich' });
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  const r    = dbRun('INSERT INTO groups_table (name,invite_code,created_by) VALUES (?,?,?)',
    [name.trim(), code, req.session.userId]);
  dbRun('INSERT INTO group_members (group_id,user_id) VALUES (?,?)', [r.lastInsertRowid, req.session.userId]);
  saveDb();
  res.json({ success: true, group: dbGet('SELECT * FROM groups_table WHERE id=?', [r.lastInsertRowid]) });
});

app.post('/api/groups/join', requireAuth, (req, res) => {
  const group = dbGet('SELECT * FROM groups_table WHERE invite_code=?', [(req.body.code||'').toUpperCase()]);
  if (!group) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
  try { dbRun('INSERT OR IGNORE INTO group_members (group_id,user_id) VALUES (?,?)', [group.id, req.session.userId]); } catch(_) {}
  saveDb();
  res.json({ success: true, group });
});

app.get('/api/groups/:id/members', requireAuth, (req, res) => {
  res.json({ members: dbAll(`
    SELECT u.id,u.username,gm.joined_at FROM users u
    JOIN group_members gm ON u.id=gm.user_id WHERE gm.group_id=?
  `, [req.params.id]) });
});

// Group results with consensus tiers
app.get('/api/groups/:id/results', requireAuth, (req, res) => {
  const gid = req.params.id;
  if (!dbGet('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', [gid, req.session.userId]))
    return res.status(403).json({ error: 'Kein Zugriff' });

  const memberIds = dbAll('SELECT user_id FROM group_members WHERE group_id=?', [gid]).map(m => m.user_id);
  if (!memberIds.length) return res.json({ results: [], memberCount: 0 });
  const ph = memberIds.map(()=>'?').join(',');

  const rows = dbAll(`
    SELECT l.id,l.title,l.price,l.price_cold,l.size,l.location,l.rooms,
           l.image_url,l.images_json,l.tags_json,l.url,l.platform,l.status,
           s.user_id,s.action,u.username,
           CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as group_contacted,
           c.note as group_contact_note, c.contacted_at as group_contacted_at
    FROM listings l
    JOIN swipes s ON l.id=s.listing_id AND s.user_id IN (${ph})
    JOIN users u ON s.user_id=u.id
    LEFT JOIN contacts c ON c.listing_id=l.id AND c.group_id=?
    WHERE l.status != 'offline'
    ORDER BY l.id
  `, [...memberIds, gid]);

  const byId = {};
  rows.forEach(r => {
    if (!byId[r.id]) byId[r.id] = {
      id: r.id, title: r.title, price: r.price, price_cold: r.price_cold,
      size: r.size, location: r.location, rooms: r.rooms, status: r.status,
      image_url: r.image_url, images_json: r.images_json, tags_json: r.tags_json,
      url: r.url, platform: r.platform, votes: [], score: 0,
      group_contacted: r.group_contacted, group_contact_note: r.group_contact_note,
      group_contacted_at: r.group_contacted_at,
    };
    const pts = r.action === 'superlike' ? 2 : r.action === 'like' ? 1 : -1;
    byId[r.id].votes.push({ username: r.username, action: r.action, pts });
    byId[r.id].score += pts;
  });

  const myVotes = Object.fromEntries(
    dbAll('SELECT listing_id,action FROM swipes WHERE user_id=?', [req.session.userId])
      .map(v => [v.listing_id, v.action])
  );

  const tierOf = (item) => {
    const pos      = item.votes.filter(v => v.action !== 'dislike').length;
    const neg      = item.votes.filter(v => v.action === 'dislike').length;
    const voted    = item.votes.length;
    // Einstimmig: alle Mitglieder haben abgestimmt UND alle positiv
    if (neg === 0 && pos === memberIds.length) return 'einstimmig';
    // Mehrheitlich: mehr positive als negative Stimmen
    if (pos > neg)                             return 'mehrheitlich';
    // Gespalten: gleich viele positive und negative
    if (pos === neg)                           return 'gespalten';
    return 'abgelehnt';
  };

  const order = { einstimmig: 0, mehrheitlich: 1, gespalten: 2, abgelehnt: 3 };
  const results = Object.values(byId)
    .map(item => ({ ...item, tier: tierOf(item), my_swipe: myVotes[item.id] || null }))
    .sort((a, b) => order[a.tier] - order[b.tier] || b.score - a.score);

  res.json({ results, memberCount: memberIds.length });
});

// ── Search Jobs ────────────────────────────────────────────
app.get('/api/jobs', requireAuth, (req, res) =>
  res.json({ jobs: dbAll('SELECT * FROM search_jobs ORDER BY created_at DESC') })
);

app.post('/api/jobs', requireAuth, (req, res) => {
  const { label, search_url, interval_min = 60 } = req.body;
  if (!label?.trim())                  return res.status(400).json({ error: 'Bezeichnung erforderlich' });
  if (!search_url?.startsWith('http')) return res.status(400).json({ error: 'Gültige Such-URL erforderlich' });
  if (dbGet('SELECT id FROM search_jobs WHERE search_url=?', [search_url]))
    return res.status(409).json({ error: 'Diese Suche ist bereits vorhanden' });
  const iv = Math.max(10, Math.min(1440, parseInt(interval_min)||60));
  const vis   = ['global','private','group'].includes(req.body.visibility) ? req.body.visibility : 'global';
  const visId = vis === 'group' ? (parseInt(req.body.visibility_id)||null) : null;
  if (vis === 'group' && visId) {
    const member = dbGet('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', [visId, req.session.userId]);
    if (!member) return res.status(403).json({ error: 'Nicht Mitglied dieser Gruppe' });
  }
  const r  = dbRun('INSERT INTO search_jobs (label,search_url,platform,interval_min,added_by,visibility,visibility_id) VALUES (?,?,?,?,?,?,?)',
    [label.trim(), search_url.trim(), detectPlatform(search_url), iv, req.session.userId, vis, visId]);
  saveDb();
  res.json({ success: true, job: dbGet('SELECT * FROM search_jobs WHERE id=?', [r.lastInsertRowid]) });
});

app.patch('/api/jobs/:id/toggle', requireAuth, (req, res) => {
  const job = dbGet('SELECT * FROM search_jobs WHERE id=?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });
  dbRun('UPDATE search_jobs SET active=? WHERE id=?', [job.active ? 0 : 1, job.id]);
  saveDb();
  res.json({ success: true, active: !job.active });
});

app.patch('/api/jobs/:id/interval', requireAuth, (req, res) => {
  const iv = Math.max(10, Math.min(1440, parseInt(req.body.interval_min)||60));
  dbRun('UPDATE search_jobs SET interval_min=? WHERE id=?', [iv, req.params.id]);
  saveDb();
  res.json({ success: true, interval_min: iv });
});

app.patch('/api/jobs/:id/visibility', requireAuth, (req, res) => {
  const { visibility, visibility_id } = req.body;
  if (!['global','private','group'].includes(visibility))
    return res.status(400).json({ error: 'Ungültige Sichtbarkeit' });
  const visId = visibility === 'group' ? (parseInt(visibility_id)||null) : null;
  if (visibility === 'group' && visId) {
    const member = dbGet('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', [visId, req.session.userId]);
    if (!member) return res.status(403).json({ error: 'Nicht Mitglied dieser Gruppe' });
  }
  dbRun('UPDATE search_jobs SET visibility=?, visibility_id=? WHERE id=? AND added_by=?',
    [visibility, visId, req.params.id, req.session.userId]);
  saveDb();
  res.json({ success: true });
});

app.delete('/api/jobs/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM search_jobs WHERE id=?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

app.post('/api/jobs/:id/run', requireAuth, async (req, res) => {
  const job = dbGet('SELECT * FROM search_jobs WHERE id=?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });
  res.json({ success: true, message: 'Job gestartet…' });
  runJob(job);
});

// ── Job runner ─────────────────────────────────────────────
async function runJob(job) {
  console.log(`[Poller] Job: ${job.label}`);
  try {
    const { newCount, totalFound } = await pollSearchJob(
      job,
      (url) => !!dbGet('SELECT id FROM listings WHERE url=?', [url]),
      (data) => { insertListing(data, job.added_by); }
    );
    dbRun(`UPDATE search_jobs SET last_run=datetime('now'),last_error=NULL,last_new=?,total_found=total_found+? WHERE id=?`,
      [newCount, newCount, job.id]);
    saveDb();
    console.log(`[Poller] ${job.label}: ${newCount} neue (${totalFound} auf Seite)`);

    // Notify subscribed users about new listings
    if (newCount > 0) {
      const users = dbAll('SELECT * FROM users WHERE notify_new=1');
      for (const user of users) {
        if (user.notify_push) {
          await sendPushToUser(user.id, {
            title: `📡 ${newCount} neue Inserate`,
            body:  job.label,
            url:   '/',
            icon:  '/icon-192.png',
          });
        }
        if (user.notify_email) {
          await mailer.sendNewListingsMail(user.email, user.username, newCount, job.label);
        }
      }
    }
  } catch (err) {
    console.error(`[Poller] Fehler bei ${job.label}: ${err.message}`);
    dbRun(`UPDATE search_jobs SET last_run=datetime('now'),last_error=? WHERE id=?`, [err.message, job.id]);
    saveDb();
  }
}

// ── Status checker (runs every 6h) ────────────────────────
async function runStatusCheck() {
  const listings = dbAll("SELECT id,url,platform FROM listings WHERE status='active'");
  if (!listings.length) return;
  console.log(`[Status] Prüfe ${listings.length} aktive Inserate…`);
  const { offline, reserved } = await checkExistingListings(listings, (id, status) => {
    dbRun("UPDATE listings SET status=? WHERE id=?", [status, id]);
    if (status === 'offline') {
      try { dbRun("INSERT OR IGNORE INTO archive_notes (listing_id,reason) VALUES (?,?)", [id, 'offline']); } catch(_){}
    }
    saveDb();
    console.log(`[Status] Inserat ${id} → ${status}`);
  });
  console.log(`[Status] ${offline||0} offline, ${reserved||0} reserviert`);
}

// ── Scheduler ─────────────────────────────────────────────
function startScheduler() {
  // Search jobs: check every 60s
  async function pollTick() {
    const jobs = dbAll('SELECT * FROM search_jobs WHERE active=1');
    for (const job of jobs) {
      const last = job.last_run ? new Date(job.last_run + 'Z').getTime() : 0;
      if (Date.now() >= last + job.interval_min * 60000) runJob(job);
    }
  }
  setTimeout(() => { pollTick(); setInterval(pollTick, 60000); }, 15000);

  // Status check: every 6 hours
  setTimeout(() => { runStatusCheck(); setInterval(runStatusCheck, 6 * 60 * 60 * 1000); }, 5 * 60 * 1000);

  console.log('[Scheduler] Gestartet (erster Poll in 15s, erster Status-Check in 5min)');
}

// ── Password reset page ────────────────────────────────────
app.get('/reset-password', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Passwort zurücksetzen – WohnungsSwipe</title>
  <style>
    body{font-family:sans-serif;background:#0f0f11;color:#f0ede8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .box{background:#18181c;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:32px;width:100%;max-width:380px}
    h2{color:#e8c97a;margin:0 0 20px;font-size:1.3rem}
    input{width:100%;background:#222228;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:11px 14px;color:#f0ede8;font-size:.95rem;box-sizing:border-box;margin-bottom:12px;outline:none}
    input:focus{border-color:#e8c97a}
    button{width:100%;background:#e8c97a;color:#0f0f11;border:none;border-radius:10px;padding:12px;font-weight:600;cursor:pointer;font-size:.95rem}
    .msg{font-size:.85rem;margin-top:12px;min-height:1.2em}
    .ok{color:#5bdc8a}.err{color:#f05060}
  </style></head><body>
  <div class="box">
    <h2>🏠 Neues Passwort</h2>
    <input type="password" id="pw1" placeholder="Neues Passwort" />
    <input type="password" id="pw2" placeholder="Passwort wiederholen" />
    <button onclick="submit()">Passwort setzen</button>
    <div class="msg" id="msg"></div>
  </div>
  <script>
    const token = new URLSearchParams(location.search).get('token');
    async function submit() {
      const pw1 = document.getElementById('pw1').value;
      const pw2 = document.getElementById('pw2').value;
      const msg = document.getElementById('msg');
      if (!pw1 || pw1.length < 6) { msg.className='msg err'; msg.textContent='Mindestens 6 Zeichen'; return; }
      if (pw1 !== pw2)             { msg.className='msg err'; msg.textContent='Passwörter stimmen nicht überein'; return; }
      const r = await fetch('/api/auth/reset-password', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token, password: pw1 })
      }).then(r=>r.json());
      if (r.success) {
        msg.className='msg ok'; msg.textContent='✓ Passwort geändert – du kannst dich jetzt einloggen.';
        setTimeout(()=>location.href='/', 2000);
      } else {
        msg.className='msg err'; msg.textContent=r.error||'Fehler';
      }
    }
  </script>
  </body></html>`);
});

// ── Start ──────────────────────────────────────────────────
initDb().then(() => {
  initVapid();
  startScheduler();
  app.listen(PORT, () => {
    console.log(`🏠 WohnungsSwipe läuft auf Port ${PORT}`);
    console.log(`   → http://localhost:${PORT}`);
  });
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
