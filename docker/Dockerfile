# Build stage
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# OCR language data, fetched ONCE here so the running product never reaches the
# network. ~7.4 MB for English, Czech, Polish, German and Spanish.
RUN node scripts/fetch-tessdata.mjs
# `npm run build` also splits OpenCV out of node_modules into static/opencv/ —
# a small loader plus a separate .wasm. Bundling the package's single 10 MB file
# hangs the browser outright; see scripts/prepare-opencv.mjs.
RUN npm run build && npm prune --omit=dev

# Runtime stage
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production

# npm is never used here — the server starts with `node build` and migrations
# run in-process through drizzle-orm — but it ships in the base image with its
# own bundled dependencies, and those carry their own advisories. Three of the
# five high-severity findings against 0.3.5 were npm's copies of
# brace-expansion and ip-address, in an image that never runs npm. Removing it
# takes them with it, and 18MB besides. Anything needing npm belongs in the
# build stage above.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/tessdata ./tessdata

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
