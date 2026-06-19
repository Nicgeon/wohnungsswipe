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