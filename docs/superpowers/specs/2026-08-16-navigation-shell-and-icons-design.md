# Navigation shell and icon system — design

Date: 2026-08-16
Release: 0.3.5
Status: implemented

Specs B and C of the design system V2 migration. Spec A — the Overview panel
board — is
[2026-08-15-overview-panel-board-design.md](2026-08-15-overview-panel-board-design.md),
which also records why the migration was split into three and why they landed in
this order.

They share a document because C exists only to finish B: the icon sweep replaces
emoji in the sidebar and screen titles that B had just rebuilt, and doing it as a
second pass over the same files was the point of running it last.

## Spec B — the navigation shell

### Information architecture

Eight sidebar rows, not V2's seven. V2's table was written against the
prototype's twelve screens and never accounted for Transactions, Rules, Tags or
Tax, all of which exist in the app.

| Sidebar row | Screens                                                           |
| ----------- | ----------------------------------------------------------------- |
| Overview    | —                                                                 |
| Money       | Cash flow · Accounts · Transactions · Tax · Import · Rules · Tags |
| Assets      | Property · Investments · Loans                                    |
| Retirement  | —                                                                 |
| Home        | —                                                                 |
| Calendar    | —                                                                 |
| Admin       | Documents · Settings                                              |

Household is split into Home and Calendar so the calendar is one click away
rather than two. Retirement stands alone because it answers a different question
from the rest of Assets.

Module gating falls out of this: Money and Admin always survive, because Cash
flow, Accounts, Transactions, Rules, Tags and Settings are core rather than
modules. Assets disappears only when Property, Investments **and** Loans are all
off. Retirement, Home and Calendar each go with their own toggle.

### Two questions this spec had to settle

**Property under Assets.** V2 keeps Property standalone for a stated reason: it
carries its own property switcher inside the screen, so nesting it stacks two
rows of controls — sub-tabs above, switcher below. The grouping is nonetheless
the more truthful model, so it was accepted along with the double row. If it
reads badly in use, the fix is to tighten the spacing between the two rows, not
to move Property back out.

**Seven pills in Money.** They do not fit a narrow viewport on one line. They
scroll sideways rather than wrapping: a second row would shift every screen's
content down by an amount that varies with viewport width, which is worse than a
row that has to be swiped.

### Structure

`src/lib/modules/registry.ts` becomes `AREAS` — a list of areas, each holding
screens. `visibleAreas` drops switched-off screens and then any area left empty;
`areaForPath` says which area a path belongs to, which is what lights up the
sidebar row and picks the sub-tabs.

**`pathDisabled` is a load-bearing guard** — it is the thing that 404s a
switched-off module's routes — and this spec rewrote the structure underneath
it. Its behaviour was pinned by tests written against the _old_ implementation
before the rewrite, so the refactor had to keep them passing: an unknown path is
allowed and left to the router, a screen with no module is always allowed, and a
prefix match must not swallow a sibling path that merely starts the same way.

Sub-tabs live in `ScreenHeader`, which reads the modules from `page.data` rather
than taking them as a prop — threading them through sixteen call sites to draw
one row of pills would be a poor trade. An area with one screen renders no row:
a single pill is a label pretending to be a choice.

### Quick add

A 52px round button, bottom right, `--brand`, straight to import. On a narrow
screen it stacks above the existing menu button rather than on top of it.

It is named "Quick add" rather than "Import statement" because the header button
already carries that accessible name, and two links with the same name is a
worse answer than a slightly less descriptive one.

## Spec C — the icon system

`src/lib/icons.ts` holds the set as **data**, not markup: each icon is an array
of typed primitives (`path`, `circle`, `rect`, `line`) that `Icon.svelte`
renders. That avoids `{@html}` entirely and means a typo in a path cannot inject
anything.

No library and no font. This ships as a package people self-host, and it must
not need a network fetch to draw its own navigation.

One geometry for the whole set — 24 viewBox, no fill, `currentColor` stroke at
1.7, round caps and joins — set in `Icon.svelte` rather than repeated per icon.
Sizes: 19px in the sidebar, 26px in the screen title (in `--brand`, the one
place the brand colour appears inside content), 16px on header buttons.

### Scope of the sweep

V2 names three contexts and gives each a size; those three are what changed.
**Emoji survive where they read as content rather than furniture**: the
attention cards, account rows, and the Settings module list. Eyebrows keep
theirs on the same grounds — they are card-level labels, and giving forty-five
of them distinct icons would be inventing work V2 did not ask for.

### Icons come from the registry

Screens and areas name their own icon in `AREAS`, so no page passes one and the
`emoji` prop is gone from all sixteen `ScreenHeader` call sites. A unit test
asserts every name in the registry exists in the set, since the two are joined
only by a string.

### Verified by looking

The icons were hand-authored, so the set was rendered to a contact sheet and
inspected rather than assumed. That caught the gear, whose hand-drawn tooth
polygon rendered as a lopsided blob; it was rebuilt from computed geometry —
eight teeth on exact 45° spokes between a ring and the outer edge. Anything
added later should be looked at the same way.

## Testing

- `tests/unit/nav-areas.test.ts` — `pathDisabled` pinned through the
  restructure, the area shape, `areaForPath`, `visibleAreas` collapsing an
  emptied area, and every registry icon name existing in the set.
- `tests/e2e/shell.spec.ts` — the sidebar listing areas and not screens, a row
  staying lit for any screen inside it, sub-tabs appearing only for multi-screen
  areas, the pills scrolling on one line rather than wrapping, and both import
  entry points disappearing with their module.
- `tests/e2e/flow.spec.ts` — its module-toggle test was rewritten: it asserted
  that "Property" left the sidebar, which is no longer where screen names live.

## Known limitations

- Property under Assets stacks two rows of controls, as above.
- The sub-tab row scrolls without a visible affordance that it can be scrolled.
