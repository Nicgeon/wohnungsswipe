FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server/ ./server/
COPY public/ ./public/
RUN mkdir -p /data
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/wohnungsswipe.db
ENV SESSION_SECRET=change-me-in-production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/api/auth/me || exit 1
CMD ["node", "server/index.js"]
