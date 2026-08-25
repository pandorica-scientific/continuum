<!-- release-image-footer -->

---

### 🐳 Image

Published for `linux/amd64` and `linux/arm64`, as this version and as `latest`:

- Docker Hub — [`${HUB_REPO}`](https://hub.docker.com/r/${HUB_REPO}): `docker pull ${HUB_REPO}:${VERSION}`
- GitHub Container Registry — `docker pull ${GHCR_REPO}:${VERSION}`

### ⬆️ Updating your server

Take a backup first. The named volumes carry the data, and migrations run before
the app accepts requests:

```sh
docker compose pull
docker compose up -d
```

Anything this release needs you to do by hand is listed under 🔒 or ⬆️ above.
Full instructions: [Install, configuration and upgrading](${REPO_URL}/blob/${TAG}/docs/install.md#upgrading).
