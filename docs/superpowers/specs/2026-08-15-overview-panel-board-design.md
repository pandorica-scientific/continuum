# Overview panel board — design

Date: 2026-08-15
Release: 0.3.5
Status: implemented. Sections marked "found while building" and "not done, and
why" record where the built thing differs from what was designed.

## What this is

Design system V2 replaces the fixed Overview screen with a dashboard the person
arranges themselves: a twelve-column grid of panels they drag, resize, add and
remove. V2 calls this "a core requirement rather than a nicety".

This spec covers that screen and nothing else.

### Scope of the wider V2 migration

Full V2 is five subsystems and is too large for one spec. It is decomposed into
three, all landing in release 0.3.5, in this order:

| Spec                                         | Contents                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **A — Overview panel board** (this document) | The customisable board, per-person persistence, thirteen panels, and the waterfall scale-to-fit |
| **B — Navigation shell**                     | Sidebar areas replacing groups, sub-tabs in the page header, the quick-add button               |
| **C — Icon system**                          | `Icon.svelte` plus a path map, and the emoji sweep across roughly thirty files                  |

The waterfall scale-to-fit belongs to A rather than to its own spec because it
exists only as a consequence of the flow panel becoming resizable.

The icon sweep runs last so the mechanical pass happens exactly once, over the
final set of screens including the new panels. The cost is that this spec's
panel headers are built with emoji and swept in C.

`src/lib/modules/registry.ts` is edited by both A (panel gating) and B (areas).
Different exports, so this is merge friction rather than rework.

### Decided for Spec B, recorded here so it is not relitigated

The sidebar becomes eight rows, not V2's seven. This also closes a gap in V2,
whose IA table was written against the prototype's twelve screens and never
accounted for Transactions, Rules, Tags or Tax.

| Sidebar row | Screens                                                           |
| ----------- | ----------------------------------------------------------------- |
| Overview    | —                                                                 |
| Money       | Cash flow · Accounts · Transactions · Tax · Import · Rules · Tags |
| Assets      | Property · Investments · Loans                                    |
| Retirement  | —                                                                 |
| Home        | —                                                                 |
| Calendar    | —                                                                 |
| Admin       | Documents · Settings                                              |

Two questions Spec B must resolve, both out of scope here:

- Property under Assets contradicts V2's stated reason for keeping Property
  standalone — it carries its own property switcher, so nesting it stacks two
  rows of controls. The IA is better; the double row needs a decision.
- Money now has seven sub-tab pills, which will wrap on narrow viewports and
  needs an overflow rule.

## Decisions

| Decision            | Choice                                   | Why                                                                       |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Panel set           | Thirteen                                 | V2's eight plus five for screens its prototype did not have               |
| Storage             | `person.overview_layout` jsonb, nullable | The layout is plumbing attached to a profile, never a Settings entry      |
| Concurrency         | Last write wins                          | Discrete events, and both tabs belong to the same person                  |
| Module switched off | Keep the stored entry, close the gap     | Re-enabling restores placement; nobody loses a board to an admin's toggle |
| Narrow viewport     | Single column, still customisable        | Reorder, remove and add; resize is desktop-only                           |
| Default layout      | V2's four panels                         | Identical to today's screen, so upgrading changes nothing                 |

## The panel registry

`src/lib/overview/panels.ts` is the single source of truth, in the same spirit
as `src/lib/modules/registry.ts` for screens. One entry per panel: key, title,
default size, minimum size, and the modules it requires. It holds no data and
no arithmetic. A fourteenth panel is one entry plus one component.

Sizes are columns × rows. Row pitch is 56px, so a panel of `h` rows measures
`56h − 16` pixels.

| Key           | Title                   | Default | Requires                   | Source                                            |
| ------------- | ----------------------- | ------- | -------------------------- | ------------------------------------------------- |
| `briefing`    | Needs you               | 12 × 6  | —                          | `src/lib/server/briefing.ts`                      |
| `flow`        | Where the money goes    | 12 × 19 | —                          | `src/lib/server/cashflow.ts`                      |
| `composition` | What it is made of      | 6 × 6   | —                          | `src/lib/server/networth.ts`                      |
| `upcoming`    | Next 30 days            | 6 × 7   | `calendar`                 | `src/lib/server/calendar.ts`                      |
| `networth`    | Net worth over time     | 6 × 5   | —                          | `src/lib/networth/history.ts`                     |
| `accounts`    | Where the cash sits     | 6 × 6   | —                          | `src/lib/accounts/balance.ts`                     |
| `equity`      | Flats against mortgages | 6 × 5   | `property` **and** `loans` | `src/lib/server/property`, `src/lib/server/loans` |
| `energy`      | Energy this month       | 6 × 5   | `home`                     | `src/lib/server/home`                             |
| `investments` | Portfolio               | 6 × 5   | `investments`              | `src/lib/server/invest`                           |
| `retirement`  | Retirement outlook      | 6 × 5   | `retirement`               | `src/lib/retire.ts` + `src/lib/server/salary.ts`  |
| `tax`         | Tax position            | 6 × 6   | `tax`                      | `src/lib/server/tax.ts`                           |
| `activity`    | Recent activity         | 6 × 7   | —                          | `src/lib/server/transactions.ts`                  |
| `savings`     | Saved each month        | 6 × 5   | —                          | `src/lib/server/cashflow.ts` history              |

`equity` is the reason the registry field is a list of modules rather than a
single key: it is meaningful only when both Property and Loans are on.

Gating `upcoming` on `calendar` is a deliberate change from today's behaviour,
where `next30Days()` runs regardless of the module. It also fixes an existing
bug: the current Overview renders "Open calendar →" unconditionally, and
`pathDisabled('/calendar', modules)` makes that link 404 whenever the module is
off.

Minimum size is 4 columns by 3 rows, per V2, and the registry may override it
per panel. `flow` deliberately keeps the global minimum — see _Known
limitations_.

### The naming trap

V2 records this and it is worth obeying. `cashSplit` was defined twice — once
for the Accounts donut legend and once for a panel — and the later definition
silently won, so the panel rendered names with no figures and five identical
full-width bars.

Panel data is namespaced under a single `panels` object keyed by panel key.
The transactions panel is `activity`, not `transactions`, for the same reason.

## Layout model and persistence

A layout is an array of placements:

```json
[
	{ "k": "briefing", "x": 0, "y": 0, "w": 12, "h": 6 },
	{ "k": "flow", "x": 0, "y": 6, "w": 12, "h": 19 },
	{ "k": "composition", "x": 0, "y": 25, "w": 6, "h": 6 },
	{ "k": "upcoming", "x": 6, "y": 25, "w": 6, "h": 7 }
]
```

That array is also the default. It reproduces today's Overview exactly:
briefing full width, flow full width, then composition and upcoming side by
side.

**On upgrade nobody's screen changes**, with one deliberate exception.
`overview_layout` is null for every existing person, so the default renders and
the Overview looks as it did. The other nine panels wait in the tray. The board
is opt-in — it arrives when someone presses Customise, not when they upgrade.

The exception: an install with the calendar module switched off loses the
"Next 30 days" card, because `upcoming` is now gated on `calendar`. Its gap
closes and the default becomes three panels. That is the gating rule working
correctly, and it removes a link that 404s today.

### Storage

Migration `0034` adds a nullable `overview_layout jsonb` column to `person`.

Null means "never customised", which is distinct from an empty array, which
means "this person removed every panel". Both are valid states.

`validateSession` selects explicit columns and never `person.*`, so the column
never rides along on the hot path. It cascades on person delete because it is
part of the row.

The column is deliberately **not** a Settings entry and does not appear in the
config export allowlist.

### Saving

`PUT /overview/layout` writes for `locals.person`, on discrete events only:
drag end, resize end, add, remove, reset.

Last write wins. The retirement config's revisioned autosave machinery
(`setRevisionedSetting`, writer ids, base versions) is deliberately not reused:
that exists for a form autosaving continuously as someone types, whereas this
saves on discrete gestures and any conflict is between two tabs belonging to
the same person. The cost of losing is re-dragging one panel.

**The server re-normalises on write and on read and never trusts the posted
array.** Keys are checked against the registry, coordinates clamped, sizes held
to their minimums. A jsonb column stores whatever it is given, so validation is
the boundary.

## The layout maths

`src/lib/overview/layout.ts` — pure functions, no DOM, no Svelte, no app
imports. This is where the bugs will be, so it must be testable without a
browser. Everything spatial lives here; components only call it.

- `DEFAULT_LAYOUT` — the array above.
- `normalise(layout, known)` — drops unknown and inherited keys and repeated
  ones, discards
  entries whose geometry is not a number, rounds fractional cells, clamps `x` to
  `0 … 12 − w` and holds `w`/`h` to their minimums.
- `visible(layout, isAvailable)` — drops panels whose modules are off, then
  compacts.

**Split during implementation.** These began as one function. They cannot be:
`normalise` runs on write, and a single function that also dropped gated panels
would delete their entries the first time anyone saved — losing exactly the
placement this design promises to give back. `normalise` sanitises what is
stored; `visible` decides what is drawn.

- `compact(layout, pinned?)` — gravity. Everything is packed in reading order
  as high as it will go; `pinned` holds one panel at its exact cell and packs
  the rest around it, which is what a drag in progress needs.
- `firstFreeSlot(layout, w, h)` — scans rows top to bottom, columns left to
  right, for Add.
- `swap(layout, a, b)` — exchanges two panels' `(x, y)`, each keeping its own
  `w`/`h`. Used by narrow-screen reordering.

### Gravity — reversed after seeing it

The board holds no empty rows. Move a panel away from the top and everything
below rises to close the space; drop one below a gap and it rises itself.
Reading order decides who gets each row.

**This is the opposite of what was designed.** The original rule was "push down,
never pull up", on the reasoning that free placement means the person's empty
space is theirs to keep — V2 states it emphatically. In use it read as broken
rather than deliberate: a board with holes in it looks like a bug, not a
choice. The rule was reversed on that evidence, `settle` was deleted, and
`compact` replaced it.

A consequence worth knowing: the module-gap special case disappeared with it.
Hiding a switched-off module's panel leaves a hole that the same compaction
closes, so `visible` no longer needs rules of its own.

## Module gating

Panels whose modules are off do not render, are not offered in the tray, and
have no data computed. Their stored entry survives, so switching the module
back on restores the panel to where that person had put it. The space closes
while it is hidden.

**One consequence, found while building.** The board edits in _stored_ space,
not in the gap-closed space it normally shows. Dragging on a gap-closed board
would write back coordinates that are not the ones being stored, and the
promise above — that re-enabling a module returns the panel to where its owner
put it — would quietly stop holding.

So while customising, a panel whose module is off renders as a dimmed
placeholder naming it and saying the space is being held, with a "Remove
anyway" escape. Outside customise mode the gap is closed exactly as decided.
The arrangement someone edits is therefore the arrangement that is stored.

## Data loading

`overview/+page.server.ts` computes data only for panels that are both placed
in this person's layout and not gated off.

This matters: thirteen panels' worth of queries on every load would be a
serious regression from today's four. The tray needs only titles, which come
from the registry and cost nothing; adding a panel triggers `invalidateAll()`
to fetch its data. The board stays as cheap as the board that was built.

The loader returns `{ layout, panels: { <key>: <data> } }`.

**Not done, and why.** This spec intended to fix an existing duplication:
`computeNetWorth()` is called by both `(app)/+layout.server.ts` for the sidebar
card and by this loader for the composition panel, twice per request. SvelteKit
runs layout and page loads in parallel, so neither can hand its result to the
other; removing the second call needs a request-scoped cache in `hooks.server.ts`,
which is a change to the request pipeline and not this screen's business. The
duplication stands. What the loader does do is memoise net worth and the rate
table _across panels_, so thirteen panels still cost at most one of each.

## Interaction

### Desktop

A **Customise** button in the section header toggles edit mode. Panels take a
`--bd2` border and a grab cursor.

- **Drag by the panel body.** A 5px threshold separates a drag from a click.
  Target cell is pointer delta ÷ (column + gap), rounded; `x` clamps to
  `0 … 12 − w`, `y` to ≥ 0. The dragged panel takes a `--brand` border, lifts
  to `z-index: 5` and shows a live `n/12` width badge.
- **Edit mode sets `pointer-events: none` on panel content.** Not in V2, but
  required: panels contain links and scrollable rows, so without it a drag
  starting inside `activity` opens a transaction.
- **Corner handle**, bottom right, `nwse-resize`. Horizontal drag sets width in
  columns, vertical sets height in rows, each held to the registry minimum.
- **✕** removes the panel.
- **Add a panel** tray lists what is unplaced and not gated off, dropping the
  chosen panel into the first free slot that fits its default size.
- **Reset to default** restores `DEFAULT_LAYOUT`.

Panels are fixed boxes: `overflow-x: hidden; overflow-y: auto`, title truncated
with an ellipsis. Default heights are tuned so every panel in the default
layout measures its content exactly — an inner scrollbar on first load is a
bug, and must be re-verified after any content change.

### Narrow, below 900px

One column, panels stacked in `(y, x)` order at natural height. No fixed
`56h − 16` box and no inner scrollbars, which would be miserable on a phone.

Customise mode offers move up, move down, remove and add. **Resize is
desktop-only** — width in columns and height in rows are both meaningless in a
single column.

Adding still uses `firstFreeSlot`, so a new panel can appear mid-stack rather
than at the end; the board scrolls it into view so it is not lost.

### The accepted cost of narrow customising

There is one stored layout and two ways of editing it, so **reordering on a
phone can rearrange the desktop board.**

Moving a panel past its neighbour exchanges the two in reading order and lays
the board out again with `packInOrder`. Each panel keeps its column and size and
is placed as high as it will go, so a side-by-side pair stays on its row and a
well-formed board is otherwise untouched — but a reorder does move panels below
the pair up or down, and the wide layout changes with it.

This started as a `swap` of the two panels' cells, which is the least
destructive operation on paper and does not work at all in practice: see
_Found in review_.

This is not fixable without storing two layouts, which was rejected: it doubles
the state and "my board" stops meaning one thing.

Narrow customise mode therefore carries a one-line note saying reordering also
affects the desktop arrangement. Honest beats silent.

### Empty board

Removing every panel is allowed and leaves an empty state offering the tray.
Reset to default recovers. It is the person's board.

## The waterfall, scaled to fit

In scope here because the flow panel is now resizable and a fixed 592px chart
breaks inside it.

The chart is laid out at a fixed 880 × 592 and scaled. A `ResizeObserver` on
the outer box sets `scale = clamp(0.18, width / 880, 1)`; the inner box carries
`transform: scale(s); transform-origin: top left`; the outer box's height
becomes `592 × s` so there is no dead space beneath it.

**The initial scale must be computed synchronously** from
`getBoundingClientRect()` when the ref attaches, with the observer handling
only later resizes. `ResizeObserver` never fires in a hidden document, so an
observer-only implementation renders the chart unscaled and clipped in a
background tab.

Each waterfall instance keeps its own scale.

## Files

New:

- `src/lib/overview/panels.ts` — registry
- `src/lib/overview/layout.ts` — pure grid maths
- `src/lib/overview/Panel.svelte` — panel chrome
- `src/lib/overview/panels/*.svelte` — thirteen content components
- `src/routes/(app)/overview/layout/+server.ts` — `PUT` endpoint
- `drizzle/0034_person_overview_layout.sql`
- `tests/unit/overview-layout.test.ts`
- `tests/e2e/overview-board.spec.ts`

Changed:

- `src/routes/(app)/overview/+page.svelte` — rewritten as the board
- `src/routes/(app)/overview/+page.server.ts` — selective panel loading
- `src/routes/(app)/+layout.server.ts` — net worth reuse
- `src/lib/server/db/schema.ts` — the column
- `src/lib/charts/Waterfall.svelte`, `src/lib/charts/FlowCard.svelte` — scale to fit
- `src/lib/modules/registry.ts` — panel gating

## Error handling

| Case                                           | Behaviour                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Stored layout is corrupt or holds unknown keys | `normalise` drops them; an empty result falls back to the default                                              |
| Posted layout is invalid                       | Server clamps and normalises; never stored raw                                                                 |
| Save request fails                             | Board keeps local state, shows a quiet inline note, retries on the next change. It does not roll back the drag |
| Panel data missing or errors                   | That panel renders its own empty state; the board does not fail                                                |
| Module off mid-session                         | Panel disappears on next load, gap closes, entry preserved                                                     |

## Testing

**Unit — `tests/unit/overview-layout.test.ts`**, carrying the burden because
`layout.ts` is pure:

- `compact` pulling a column up, and ranking by cell rather than array position
- `compact` holding a pinned panel while packing the rest around it
- `packInOrder` realising a new order across panels of different heights
- `firstFreeSlot` scan order, top to bottom then left to right
- `normalise` against unknown keys, out-of-bounds coordinates, sizes below
  minimum
- `normalise` closes gated panels' gaps and preserves their entries
- `swap` keeps each panel's own `w`/`h`

A second unit check asserts every registry key has a component, so a
fourteenth panel cannot half-exist.

**End to end — `tests/e2e/overview-board.spec.ts`:**

- Drag, resize, add, remove and reset each survive a reload
- Narrow viewport renders one column and offers no resize
- **Person 1's layout never appears for person 2**
- Switching a module off closes the gap; switching it back on restores the
  panel to its stored position

The last two are easy to get wrong and invisible when broken.

## Release and documentation

- `package.json` 0.3.4 → 0.3.5
- A `## 0.3.5` CHANGELOG section in the existing house style — prose, with an
  **Upgrading:** note covering migration `0034`. Specs B and C append to it, so
  the notes describe the finished V2 rather than three partial states
- `README.md` and `ARCHITECTURE.md` gain the panel registry and the
  `overview_layout` column

## Found in review, after implementation

A `/code-review` pass over the finished branch turned up six defects worth
recording, because each one is a shape of mistake this design invites again.

- **`normalise` accepted keys inherited from `Object.prototype`.** `known[k]`
  finds `constructor` and `__proto__`, which took `undefined` minimums and wrote
  NaN geometry into the column. It self-healed on the next read — the NaN
  serialises to `null` and fails the number check — so it was quiet rather than
  harmless. Every registry lookup on a caller-supplied key now goes through
  `Object.hasOwn`.
- **One failing panel took the whole screen with it.** `panelData` used
  `Promise.all`, and `energy` reaches Home Assistant over HTTP, so an unplugged
  box 500'd the Overview — persistently, because the placement is saved.
  `Promise.allSettled` now confines a failure to its own panel.
- **`visible` closed only the first gap in a column.** Each hidden panel was
  measured against an already-shifted `y`, so two switched-off modules left a
  band of empty space. The lift is now summed from each panel's original row.
- **The narrow reorder buttons did nothing** — and the design was wrong, not
  just the code. `swap` cannot reorder a stack: exchanging a six-row panel with
  a nineteen-row one leaves them overlapping, and the collision pass, which
  privileged the panel that moved, pushed the shorter one back below. The
  sequence on screen never changed. Reordering is now `packInOrder`, which lays
  the list out in the order given, each panel as high as it will go. It is
  order-preserving on a well-formed board and does not flatten side-by-side
  pairs, since two panels on one row do not obstruct each other. `swap` is gone.
- **`{#key data.layout}` remounted the board on every load.** The loader builds
  a fresh array each time, so adding a panel — which calls `invalidateAll()` —
  dropped the person out of Customise mode and discarded the "not saved" notice
  along with the panel it referred to.
- **Two panels keyed their rows on a name.** Account and property names carry no
  uniqueness constraint, and the tax panel grouped by person name, merging two
  people who share one. All three now key on ids.

The narrow-reorder bug is the instructive one: the E2E test asserted the button
was _visible_ and never that it _moved_ anything, which is how a feature can be
covered and broken at once.

## Known limitations

- The flow panel's minimum is 4 columns, and below roughly half width the
  waterfall's leaf labels get genuinely small. V2 calls this an open question
  rather than a defect. No minimum beyond 4 is added; the registry's per-panel
  minimum is the lever if it proves unusable in practice.
- Narrow-screen reordering perturbs the desktop layout, as described above.
- Two tabs customising simultaneously: the later save wins.
