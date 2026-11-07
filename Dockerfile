# Spool — runs the Next.js app; the indexer runs inside it on a schedule.
# Built on the Pi itself (arm64). Node 24 = built-in TypeScript + node:sqlite.
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    PORT=3000

COPY package.json package-lock.json ./
# Full install: the build needs TypeScript; sharp ships a prebuilt linux-arm64 binary.
RUN npm ci --include=dev

COPY . .
RUN npm run build

# Runtime paths — mounted from the host by compose.yaml
ENV SPOOL_ARCHIVE=/archive \
    SPOOL_DATA=/data \
    SPOOL_BACKUP_DIR=/backups

# Run as the image's non-root "node" user (uid 1000 — usually the Pi's first user too).
RUN mkdir -p /data /backups && chown -R node:node /app /data /backups
USER node

EXPOSE 3000
CMD ["npm", "start"]
