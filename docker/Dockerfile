# Build stage
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime stage
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle

# Uploaded files (property photos, documents, statements) live on this volume
RUN mkdir -p /data /backups && chown node:node /data /backups
VOLUME /data
ENV UPLOAD_DIR=/data
# Default backup destination; mount a host (cloud-synced) folder here to have
# backups leave the machine — see compose.yaml
ENV BACKUP_DIR=/backups

# adapter-node rejects request bodies over 512K by default, before any of the
# app's own code runs — so a property photo or a scanned document got a bare
# 413 with no explanation instead of the upload form's friendly error. Bank
# statements were never affected (the real ones are 1-268 KB); photos from a
# phone always are. Raise it here rather than in the app, because the limit is
# enforced by the server the app is served from.
ENV BODY_SIZE_LIMIT=32M

USER node
EXPOSE 3000
CMD ["node", "build"]
