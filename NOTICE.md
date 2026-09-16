# Notices

Continuum itself is licensed under the GNU Affero General Public License v3.0
or later; see `LICENSE`. This file covers the third-party data it ships, which
carries its own terms.

Attribution here is a condition of use rather than a courtesy. Where a licence
requires the credit to reach the person looking at the data, it also appears in
the product — the sight coins on a country page carry their own credit line.

---

## Travel places

**`assets/datasets/travel-places.json`** — 3,437 curated places across 247 countries
and territories, version 1.0.0, built 12 September 2026.

Licensed **CC BY-SA 4.0**. Sources:

- [Wikivoyage](https://en.wikivoyage.org/wiki/Wikivoyage:Database_dump),
  article snapshot through 1 September 2026. © Wikivoyage contributors,
  [CC BY-SA 4.0](https://en.wikivoyage.org/wiki/Wikivoyage:Copyleft).
- [UNESCO World Heritage Centre](https://data.unesco.org/explore/dataset/whc001/),
  downloaded 12 September 2026, CC BY-SA 4.0.
  [Terms](https://whc.unesco.org/en/syndication).

**Continuum adapts this data**, and the adaptation is published under the same
terms. `scripts/fetch-geodata.mjs` resolves each place to the administrative
region the map draws, by testing its coordinates against Natural Earth outlines
rather than using the dataset's own region field, and writes the result to
`geodata/places.json.gz`.

## Place engravings

**`assets/place-icons/*.webp`** — one black-and-white engraving per place, revealed
when its coin is rubbed off.

**Copyright © 2026 Robert Kiewisz. All rights reserved**, except as granted
below.

Original artwork, created for Continuum. Not a third-party work and not derived
from the place dataset above — the engravings depict the places, they do not
reuse anyone else's description of them, so the CC BY-SA terms on the dataset do
not reach them.

Licensed to you under the **GNU Affero General Public License v3.0 or later**,
the same terms as the rest of Continuum, as part of this distribution. You may
therefore run, copy, modify and redistribute them with the software, on those
terms.

The copyright is retained separately from the code's so that these files can
also be licensed on other terms by their author. That is the practical reason
the section exists: an AGPL grant made here does not exhaust what the copyright
holder may do with their own work elsewhere.

Converted from 1254px masters by `scripts/convert-place-icons.mjs`; the masters
themselves are not distributed — all 3,437 of them would be 9.8 GB.

## Map geometry

- [Natural Earth](https://www.naturalearthdata.com/) admin-1 states and
  provinces, time zones and country outlines, via
  [natural-earth-vector](https://github.com/nvkelso/natural-earth-vector)
  v5.1.2. Public domain.
- [world-atlas](https://github.com/topojson/world-atlas) 2.0.2, derived from
  Natural Earth. Public domain.

Country attribution in Natural Earth generally follows de facto boundaries and
is not a statement of sovereignty. Continuum overrides this in one place:
Crimea and Sevastopol are filed under Ukraine rather than Russia — see
`REGION_ADMIN_OVERRIDES` in `src/lib/life/geo/aliases.ts`.

## Optical character recognition

- [Tesseract](https://github.com/tesseract-ocr/tesseract) trained language data
  for English, Czech, Polish, German and Spanish, Apache License 2.0.

## Fonts

- [Inter](https://rsms.me/inter/), SIL Open Font License 1.1.
- [Source Code Pro](https://github.com/adobe-fonts/source-code-pro), SIL Open
  Font License 1.1.
