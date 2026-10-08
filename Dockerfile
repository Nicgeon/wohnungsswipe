FROM node:22-alpine

# su-exec: lets the entrypoint fix volume permissions as root, then drop to
# the unprivileged "node" user for the actual server process.
RUN apk add --no-cache su-exec

WORKDIR /app

# Install exactly the versions pinned in package-lock.json (no dev deps).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ ./server/
COPY public/ ./public/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# sed strips Windows line endings (CRLF) in case the repo was checked out
# on Windows — otherwise the shebang becomes "/bin/sh\r" and won't start.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data

# SESSION_SECRET is deliberately not set here: if it isn't provided at
# runtime, the server generates a random one and stores it on the volume.
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/wohnungsswipe.db
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/api/auth/me || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
