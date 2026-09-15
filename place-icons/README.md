# Place engravings

One black-and-white engraving per place, revealed when its coin is rubbed off on
a country's map page.

**Copyright © 2026 Robert Kiewisz.** Licensed under the GNU Affero General
Public License v3.0 or later, as part of Continuum. See `NOTICE.md` at the
repository root for the full statement and why the copyright is recorded
separately from the code's.

## How these get here

Committed, not fetched — unlike the OCR models and the map geometry, which have
upstream URLs. These have no upstream: they are generated for this project, and
their 1254px masters are about 2.85 MB each, so all 3,437 would be 9.8 GB. Only
the ~24 kB WebP comes into the repository.

```
node scripts/convert-place-icons.mjs <masters-directory>
```

256 pixels at quality 85: a coin draws at 84 CSS pixels, which is 252 physical
pixels on a 3× screen, and on hatched line art the first thing lost to
upscaling is the hatching.

## Naming

The file name is the place id from `datasets/travel-places.json` —
`ad-q1863.webp` is the place whose `id` is `ad-q1863`. That is the whole lookup:
no manifest, and no database column that could claim an engraving exists when
the file does not.

**A place with no file here has no coin.** There is no fallback artwork, because
a gold disc hiding nothing promises a reveal it cannot deliver. Delivery is
partial and the row fills in as batches land, with no code change.
