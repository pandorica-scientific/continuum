# Backups and restore

Settings → Backups writes one restorable database dump
(`continuum-backup.sql`, overwritten on every run) plus a copy of every uploaded
file to a folder of your choosing, weekly or monthly — or not at all. Both land in
a `Continuum backups` subfolder of that destination, and each run copies only the
files it has not copied before. Nothing is written until an administrator picks a
destination, and **Back up now** runs one on the spot.

The default destination is the `continuum-backups` volume; point
`CONTINUUM_BACKUPS` (in `.env`, see [Install](install.md)) at a cloud-synced folder
on the host — a Google Drive or Dropbox directory — and the sync client carries the
backup off-machine and keeps the dump's version history on its side:

```sh
# .env
CONTINUUM_BACKUPS=/Users/you/Library/CloudStorage/GoogleDrive-you@gmail.com/My Drive
```

The dump is plain SQL and is not encrypted. It holds everything the database holds,
password hashes and API tokens included, so treat the destination folder as being
as sensitive as the instance itself.

Restoring is booting a fresh instance (its migrations recreate the schema) and
feeding it the dump. It empties every table before it loads, so point it only at an
instance you are willing to lose:

```sh
docker compose exec -T db psql -U continuum -d continuum -v ON_ERROR_STOP=1 \
  < "Continuum backups/continuum-backup.sql"
```

Then copy the _contents_ of the backup's `files/` folder into the root of the
`continuum-data` volume, which is where uploads live — one flat directory of files
named by id, not a `files/` subdirectory. There is no restore button in the app;
this is the whole procedure.
