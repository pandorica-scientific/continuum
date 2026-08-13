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

USER node
EXPOSE 3000
CMD ["node", "build"]
