# Datasets

Curated source data, committed rather than fetched.

## travel-places.json

3,437 places across 247 countries, at most 15 per country. Version 1.0.0.

Committed rather than downloaded at build time, unlike the map geometry and the
OCR models: those have upstream URLs that will still answer next year, and this
has no upstream at all — it is a curated selection whose exact contents decide
what the product shows. A build has to be reproducible from the repository.

`scripts/fetch-geodata.mjs` reads it and writes `geodata/places.json`, which is
this file trimmed to the fields the product uses and with each place's region
resolved against the map's own outlines. That resolution is the reason the two
live in one script: the dataset files its French places under départements —
`Bas-Rhin`, `Gironde` — because it was built from the same Natural Earth admin-1
data the map used before v0.9.1, and the map now draws `Grand Est` and
`Nouvelle-Aquitaine`. The names cannot be matched, so the coordinates are asked
instead, against the outlines that same run has just dissolved.

`travel-places.schema.json` is the dataset's own JSON Schema, kept beside it so
a future rebuild can be checked against what this release was written for.

**Licence: CC BY-SA 4.0.** Sources are Wikivoyage and the UNESCO World Heritage
Centre. See `NOTICE.md` at the repository root; attribution is a condition of
use, not a courtesy.
