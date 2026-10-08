/**
 * mailer.js – E-Mail Benachrichtigungen für WohnungsSwipe
 *
 * Konfiguration via ENV-Variablen:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   BASE_URL  (für Links in E-Mails, z.B. http://localhost:3000)
 */

const nodemailer = require('nodemailer');

// Every value these templates interpolate — username, group name, a search
// agent's label, a listing's title/location/price — ultimately comes from a
// user (or, for a listing, from whatever page it links to) and is dropped
// straight into the email's HTML body below. Without escaping, anyone could
// put e.g. a fake "Konto gesperrt, hier klicken" link into a group name and
// have it rendered as real markup in another member's inbox. Plain text
// (.subject) only needs CR/LF stripped, since a literal newline there could
// otherwise be used to smuggle extra email headers.
const escHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeHeader = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

function createTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null; // E-Mail nicht konfiguriert
  return nodemailer.createTransport({
    host,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
    tls: { rejectUnauthorized: false },
  });
}

const BASE_URL = () => process.env.BASE_URL || 'http://localhost:3000';
const FROM     = () => process.env.SMTP_FROM || `"WohnungsSwipe" <noreply@wohnungsswipe.local>`;

// ── Template helper ───────────────────────────────────────
function template(title, body, unsubToken = '') {
  const unsubUrl = unsubToken
    ? `${BASE_URL()}/api/notify/unsubscribe-email?token=${unsubToken}`
    : `${BASE_URL()}/api/notify/unsubscribe-email`;
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', sans-serif; background:#0f0f11; color:#f0ede8; margin:0; padding:0; }
  .wrap { max-width:520px; margin:32px auto; background:#18181c; border-radius:16px; overflow:hidden; border:1px solid rgba(255,255,255,0.08); }
  .head { background:#18181c; padding:28px 32px 20px; border-bottom:1px solid rgba(255,255,255,0.08); }
  .logo { font-size:1.4rem; font-weight:700; color:#e8c97a; }
  .body { padding:28px 32px; }
  h2 { margin:0 0 16px; font-size:1.2rem; color:#f0ede8; }
  p  { color:#9b9896; line-height:1.6; margin:0 0 12px; }
  .btn { display:inline-block; background:#e8c97a; color:#0f0f11; padding:12px 28px;
         border-radius:10px; text-decoration:none; font-weight:600; margin:16px 0; }
  .listing-card { background:#222228; border-radius:10px; padding:16px; margin:16px 0; }
  .listing-card h3 { margin:0 0 6px; font-size:1rem; color:#f0ede8; }
  .listing-card .price { color:#e8c97a; font-weight:600; margin:0 0 4px; }
  .listing-card .meta  { font-size:0.82rem; color:#9b9896; }
  .foot { padding:16px 32px; font-size:0.75rem; color:#5a5855; border-top:1px solid rgba(255,255,255,0.08); }
</style></head>
<body>
<div class="wrap">
  <div class="head"><div class="logo">🏠 WohnungsSwipe</div></div>
  <div class="body">${body}</div>
  <div class="foot">Du erhältst diese Mail weil du Benachrichtigungen aktiviert hast. <a href="${unsubUrl}" style="color:#e8c97a">Abmelden</a></div>
</div>
</body></html>`;
}

// ── Send helpers ──────────────────────────────────────────
async function sendMail({ to, subject, html }) {
  const transport = createTransport();
  if (!transport) {
    console.log(`[Mailer] Nicht konfiguriert – E-Mail nicht gesendet an ${to}: ${subject}`);
    return false;
  }
  try {
    await transport.sendMail({ from: FROM(), to, subject, html });
    console.log(`[Mailer] Gesendet an ${to}: ${subject}`);
    return true;
  } catch (e) {
    console.error(`[Mailer] Fehler beim Senden an ${to}: ${e.message}`);
    return false;
  }
}

// ── Notification types ────────────────────────────────────

async function sendPasswordResetMail(email, username, token, unsubToken='') {
  const link = `${BASE_URL()}/reset-password?token=${token}`;
  return sendMail({
    to:      email,
    subject: 'WohnungsSwipe – Passwort zurücksetzen',
    html: template('Passwort zurücksetzen', `
      <h2>Passwort zurücksetzen</h2>
      <p>Hallo ${escHtml(username)},<br>du hast eine Anfrage zum Zurücksetzen deines Passworts gestellt.</p>
      <a href="${link}" class="btn">Neues Passwort festlegen</a>
      <p style="font-size:0.82rem;color:#5a5855">Dieser Link ist 1 Stunde gültig. Falls du die Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.</p>
    `, unsubToken),
  });
}

async function sendMatchMail(email, username, groupName, listing, unsubToken='') {
  const priceStr = listing.price_cold || listing.price || '';
  return sendMail({
    to:      email,
    subject: safeHeader(`Match in "${groupName}" – ${(listing.title || '').substring(0, 40)}`),
    html: template('Neues Match!', `
      <h2>🎉 Ihr habt einen Match!</h2>
      <p>Hallo ${escHtml(username)},<br>alle Mitglieder der Gruppe <strong>${escHtml(groupName)}</strong> mögen diese Wohnung:</p>
      <div class="listing-card">
        <h3>${escHtml(listing.title)}</h3>
        ${priceStr ? `<div class="price">${escHtml(priceStr)}</div>` : ''}
        <div class="meta">
          ${listing.location ? `📍 ${escHtml(listing.location)}` : ''}
          ${listing.size     ? ` &nbsp;·&nbsp; 📐 ${escHtml(listing.size)}` : ''}
          ${listing.rooms    ? ` &nbsp;·&nbsp; 🚪 ${escHtml(listing.rooms)} Zi.` : ''}
        </div>
      </div>
      <a href="${BASE_URL()}" class="btn">In WohnungsSwipe öffnen →</a>
    `, unsubToken),
  });
}

async function sendNewListingsMail(email, username, count, searchLabel, unsubToken='') {
  return sendMail({
    to:      email,
    subject: safeHeader(`📡 ${count} neue Inserate – ${searchLabel}`),
    html: template('Neue Inserate', `
      <h2>Neue Inserate verfügbar!</h2>
      <p>Hallo ${escHtml(username)},<br>der Suchagent <strong>${escHtml(searchLabel)}</strong> hat <strong>${escHtml(count)} neue Inserate</strong> gefunden.</p>
      <a href="${BASE_URL()}" class="btn">Jetzt swipen →</a>
    `, unsubToken),
  });
}

async function sendNudgeMail(email, username, senderName, groupName, unsubToken='') {
  return sendMail({
    to:      email,
    subject: safeHeader(`👋 ${senderName} erinnert dich ans Swipen`),
    html: template('Erinnerung', `
      <h2>👋 Zeit zum Swipen!</h2>
      <p>Hallo ${escHtml(username)},<br><strong>${escHtml(senderName)}</strong> aus der Gruppe <strong>${escHtml(groupName)}</strong> erinnert dich daran, die noch offenen Inserate zu bewerten.</p>
      <a href="${BASE_URL()}" class="btn">Jetzt swipen →</a>
    `, unsubToken),
  });
}

async function sendProfileReminderMail(email, username, senderName, groupName, unsubToken='') {
  return sendMail({
    to:      email,
    subject: safeHeader(`${senderName} bittet dich um dein Bewerber-Profil`),
    html: template('Erinnerung', `
      <h2>Bewerber-Profil ausfüllen</h2>
      <p>Hallo ${escHtml(username)},<br><strong>${escHtml(senderName)}</strong> aus der Gruppe <strong>${escHtml(groupName)}</strong> bittet dich, dein Bewerber-Profil auszufüllen, damit eure gemeinsamen Anfragen an Vermieter vollständig sind.</p>
      <a href="${BASE_URL()}" class="btn">Profil ausfüllen →</a>
    `, unsubToken),
  });
}

async function sendListingChangeMail(email, username, changeTitle, changeBody, unsubToken='') {
  return sendMail({
    to:      email,
    subject: safeHeader(changeTitle) || 'Inserat aktualisiert',
    html: template('Inserat aktualisiert', `
      <h2>${escHtml(changeTitle)}</h2>
      <p>Hallo ${escHtml(username)},<br>${escHtml(changeBody)}</p>
      <a href="${BASE_URL()}" class="btn">In WohnungsSwipe öffnen →</a>
    `, unsubToken),
  });
}

async function sendPasswordChangedMail(email, username, unsubToken='') {
  return sendMail({
    to:      email,
    subject: 'WohnungsSwipe – Passwort geändert',
    html: template('Passwort geändert', `
      <h2>Dein Passwort wurde geändert</h2>
      <p>Hallo ${escHtml(username)},<br>dein Passwort wurde soeben erfolgreich geändert.</p>
      <p>Falls du das nicht warst, wende dich bitte sofort an den Administrator.</p>
    `, unsubToken),
  });
}

module.exports = {
  sendPasswordResetMail,
  sendMatchMail,
  sendNewListingsMail,
  sendNudgeMail,
  sendProfileReminderMail,
  sendListingChangeMail,
  sendPasswordChangedMail,
};
