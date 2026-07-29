# 🏠 Flatswipe
_also known as Wohnungsswipe_

**This app is completley vibe coded...**

Runs in a docker compose :>

Basicly this app helps you (and your friends) to find a new flat or anything you find on german sites like Kleinanzeigen, Immoscout or similar.
_It's not as fledged as id wish it to be but its not bad._

## Setup
Just install the docker compose and lets goo.

```docker
services:
  wohnungsswipe:
    image: nicgeon/wohnungsswipe:latest
    container_name: wohnungsswipe
    ports:
      - "3000:3000"
    volumes:
      - wohnungsswipe_data:/data
    environment:
      - PORT=3000
      - DB_PATH=/data/wohnungsswipe.db
      - SESSION_SECRET=changeme

      # ── E-Mail (optional) ─────────────────────────────
      # Ohne diese Einstellungen werden E-Mails nur geloggt, nicht gesendet.
      # Beispiel für Gmail:
      #   SMTP_HOST=smtp.gmail.com
      #   SMTP_PORT=587
      #   SMTP_USER=deine@gmail.com
      #   SMTP_PASS=dein-app-passwort
      #   SMTP_FROM="WohnungsSwipe" <deine@gmail.com>
      - SMTP_HOST=
      - SMTP_PORT=587
      - SMTP_USER=
      - SMTP_PASS=
      - SMTP_FROM=

      # ── Basis-URL (für Links in E-Mails & Push) ────────
      - BASE_URL=http://localhost:3000

    restart: unless-stopped

volumes:
  wohnungsswipe_data:
```

### What you should change:
- SESSION_SECRET 
    - would reccomend changing it to something long and funny

# WohnungsSwipe Admin CLI

A command-line tool for managing WohnungsSwipe directly inside the Docker container — no server restart required.

## Usage

```bash
docker exec wohnungsswipe node server/cli.js <command> [options]
```

---

## Commands

### `users`
List all registered users with their ID, username, email, admin status and registration date.

```bash
docker exec wohnungsswipe node server/cli.js users
```

---

### `info <username|email>`
Show detailed information about a specific user, including swipe stats, group memberships, search agents and pending notifications.

```bash
docker exec wohnungsswipe node server/cli.js info nicgeon
docker exec wohnungsswipe node server/cli.js info nicgeon@example.com
```

---

### `promote <username|email>`
Grant admin privileges to a user. Admins can see all search agents regardless of visibility, manage other users via the in-app admin panel, and access all admin CLI commands.

```bash
docker exec wohnungsswipe node server/cli.js promote nicgeon
docker exec wohnungsswipe node server/cli.js promote nicgeon@example.com
```

> **Note:** If no admins exist yet (fresh install), any user can be promoted without restrictions. After the first admin is set, only existing admins can promote others.

---

### `demote <username|email>`
Remove admin privileges from a user. You cannot demote yourself.

```bash
docker exec wohnungsswipe node server/cli.js demote nicgeon
```

---

### `password <username|email> <new-password>`
Reset a user's password directly. The new password must be at least 6 characters. The user's active sessions are not immediately invalidated, but they will need to log in again once the session expires.

```bash
docker exec wohnungsswipe node server/cli.js password nicgeon newSecurePassword123
docker exec wohnungsswipe node server/cli.js password nicgeon@example.com newSecurePassword123
```

---

### `delete <username|email>`
Preview a user deletion. Shows the user's details and the volume of data that would be removed (swipes, group memberships, search agents). Does **not** delete anything — use `--confirm` to actually delete.

```bash
docker exec wohnungsswipe node server/cli.js delete olduser
```

### `delete <username|email> --confirm`
Permanently delete a user and all their associated data. This includes swipes, group memberships, push subscriptions, contacts, notification queue entries and contact notes. Search agents created by the user are kept but their owner reference is cleared.

```bash
docker exec wohnungsswipe node server/cli.js delete olduser --confirm
```

> ⚠️ **This action cannot be undone.**

---

### `help`
Print the help message with all available commands and examples.

```bash
docker exec wohnungsswipe node server/cli.js help
```

---

## Notes

- Commands accept both **username** and **email address** as identifier — whichever is more convenient.
- The CLI reads and writes the SQLite database file directly (`/data/wohnungsswipe.db`). It works even if the server is down.
- Because the CLI bypasses the running server's in-memory state, avoid running write commands (password, promote, demote, delete) while the server is under heavy load — the server saves the database periodically and could theoretically overwrite a concurrent CLI write. For safety, run CLI commands during low-traffic periods or after stopping the server with `docker compose stop`.
- The `DB_PATH` environment variable is respected if you have a non-default database location configured.

---

## Examples

```bash
# See who is registered and who has admin rights
docker exec wohnungsswipe node server/cli.js users

# Check what a specific user has been up to
docker exec wohnungsswipe node server/cli.js info nicgeon

# Someone forgot their password
docker exec wohnungsswipe node server/cli.js password nicgeon temporaryPassword42

# Make a trusted user an admin
docker exec wohnungsswipe node server/cli.js promote kate

# Remove admin rights after someone leaves the group
docker exec wohnungsswipe node server/cli.js demote formerAdmin

# Clean up a test account
docker exec wohnungsswipe node server/cli.js delete testuser
docker exec wohnungsswipe node server/cli.js delete testuser --confirm
```