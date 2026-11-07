# Spool — runs the Next.js app; the indexer runs inside it on a schedule.
# Built on the Pi itself (arm64). Node 24 = built-in TypeScript + node:sqlite.
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    PORT=3000 \
    SPOOL_ARCHIVE=/archive \
    SPOOL_DATA=/data \
    SPOOL_BACKUP_DIR=/backups

# Only empty folders get chowned here. Everything below is copied in already owned by
# the non-root "node" user (uid 1000), so there's no slow `chown -R` over node_modules.
RUN mkdir -p /app /data /backups && chown node:node /app /data /backups
WORKDIR /app
USER node

# Dependencies: cached until package-lock.json changes. The build needs dev deps (TypeScript);
# sharp ships a prebuilt linux-arm64 binary.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

# App code: only this layer and the build re-run on a normal code update.
COPY --chown=node:node . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
