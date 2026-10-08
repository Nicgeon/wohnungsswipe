#!/bin/sh
set -e

# Runs the server as the unprivileged "node" user. When started as root
# (the default), first hand the data directory to that user — volumes
# created by older images are owned by root, and the server must be able
# to write its database, VAPID keys and session secret there.
if [ "$(id -u)" = "0" ]; then
  DATA_DIR="$(dirname "${DB_PATH:-/data/wohnungsswipe.db}")"
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su-exec node "$@"
fi

exec "$@"
