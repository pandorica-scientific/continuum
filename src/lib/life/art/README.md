# Vendored artwork generators

Three libraries that draw the Life area's pictures. All three are synchronous,
have no dependencies, and touch neither the network nor the filesystem — which
is why they can be vendored rather than reimplemented, and why they can run on
the server or in the browser without a build step.

They are copied in **unchanged** from `design_system/`, and `.prettierignore`
keeps them that way so re-vendoring a newer version is a `cp` and a diff rather
than a merge. Do not edit them here: fix the library in `design_system/`, run
its own `node generate.mjs` and tests, then copy the result across and record
the date below.

| Directory  | Source                           | Copied     |
| ---------- | -------------------------------- | ---------- |
| `stamps/`  | `design_system/travel-stamps/`   | 2026-09-10 |
| `dishes/`  | `design_system/cookbook-assets/` | 2026-09-10 |
| `bottles/` | `design_system/bottle-assets/`   | 2026-09-10 |

Each source folder also holds a gallery, a contact sheet and pre-rendered SVG
examples. None of that is needed at runtime and none of it is copied here: the
gallery is how the household reviews new artwork, and it stays where the design
work happens.

## What each one draws

- **`stamps/`** — the passport stamp on a past trip and the art on an idea
  card. 500 destinations across 25 regional styles, 40 original landmark
  drawings, and a neutral symbol for anywhere else. `generateStamp({ name,
country })` is the whole API; `renderStamp(definition)` reproduces a stored
  one.
- **`dishes/`** — the line drawing on a recipe card. Picks one cohesive
  whole-dish illustration from a catalog rather than assembling a pile of
  ingredient symbols. Deterministic, so the same recipe always gets the same
  picture.
- **`bottles/`** — the silhouette on a bottle card, lying on its side. Eight
  shapes, each with a `labelBox` the household's cropped label photograph drops
  into.

## The rule that matters

**Artwork is stored as a definition, never as a file, and never re-derived from
the row.** `$lib/life/art` resolves a definition once, when the row is created,
and writes it to the row's `art` column. Renaming a recipe therefore does not
silently repaint it, and upgrading one of these libraries does not repaint the
household's history.

Bottles are the exception and have no `art` column: the silhouette follows the
bottle's `type`, so there is nothing to store.

## Licence

Written for Continuum and covered by the project's AGPL-3.0-or-later licence,
like everything else in `src/`. The files carry no SPDX header of their own so
they stay byte-identical to `design_system/`; this note is the record.
