# Bank logos

One WebP per bank key, named exactly as the key in `src/lib/banks.ts`:
`ing.webp`, `n26.webp`, `cs.webp`.

These files **are committed**, and ship inside the container image, the same way
`assets/place-icons/` does. `CREDITS.md` beside them records where each one came
from and the terms Wikimedia Commons states for it.

## How they got here

`scripts/fetch-bank-logos.mjs`, run by hand and its output committed. Nothing in
CI or in the Docker build runs it — the build only ever copies what is already
here. Re-run it when a bank rebrands, or with a key argument to add one:

```
node scripts/fetch-bank-logos.mjs            # refresh every known bank
node scripts/fetch-bank-logos.mjs n26 wise   # just these
node scripts/fetch-bank-logos.mjs --list     # what it would fetch
```

Each is taken from that bank's Wikidata logo property (P154), resolved to a file
on Commons. A bank whose item states no logo is skipped and keeps the emoji from
`BANK_SEED` — which is also what any bank a household adds themselves will show.

## What they are

Trademarks of the organisations named in `CREDITS.md`, included here to identify
the bank an account is held with. That is what the marks are for and how they
are used: beside an account you told Continuum about, at 36 pixels, on the
Accounts screen.

They are not Continuum's, they are not covered by its AGPL licence, and nothing
about shipping them here grants anyone rights to them. If you fork this project
or redistribute the image, the marks travel with it and their terms are yours to
observe — start with `CREDITS.md`.

To do without them entirely: `rm assets/bank-logos/*.webp` and rebuild. Every
account falls back to its bank's emoji and nothing else changes.

## How they are drawn

`src/lib/server/banks/logos.ts` reads this directory once and serves a file
through `/accounts/logo/<key>.webp`. A key that does not match
`^[a-z0-9][a-z0-9-]{0,60}$` never reaches the filesystem.
