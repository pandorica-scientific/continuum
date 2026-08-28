# Handoff: Continuum Documents — refinement pass

## Overview

Four surfaces of the Documents module in **Continuum**, a self-hosted household SvelteKit app:
the main document list, the document inspector, the Inbox review flow, and Settings → Shelves,
plus the search result-row variants and empty states that belong to the main list.

The architecture is already locked by `continuum-documents-handoff-v3.md`. This package is a
**refinement pass over approved structure** — visual hierarchy, all states, spacing, responsive
behaviour, microcopy and component mapping. It does not rearchitect any surface, and it answers
two open calls the brief left to design (emoji in the rail; emoji picker approach).

The model this UI expresses: **shelf** = where in life (one per document, user-editable) ·
**type** = what kind (fixed enum) · **entity links** = what it concerns (many) · **tags** = free
cross-cuts. Raw vocabulary (`type: insurance_policy`, `source: ocr`, confidence scores) is never
shown outside an admin "Technical details" disclosure.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing intended
look and behaviour, not production code to copy. The task is to **recreate them in the Continuum
codebase** (SvelteKit 5, runes, `src/lib/components/` primitives, tokens in `app.css`) using its
established patterns. Do not port the HTML.

The prototype deliberately mirrors the codebase's own token names (`--fg1`, `--bd2`,
`--control-h`, `--radius-md`, `--yellow-tint`), so most values transfer as literal token
references. **A hex literal in a component is a bug** — every colour below is named, not valued,
for that reason.

Open `Continuum Documents Refinement.dc.html` in a browser; `support.js` must sit beside it.

## Fidelity

**High-fidelity.** Final colours, typography, spacing and states, drawn at real sizes against the
codebase's own tokens. Recreate pixel-for-pixel using the existing Svelte primitives — the
component mapping in §"Components" below tells you which primitive owns each part.

Two things are intentionally *not* final:

1. The four search-honesty strings are **placeholders in the described shape**. v3 §5.2/§6.7 holds
   the locked wording. Swap it in. **This is blocking.**
2. Content is plausible household fixture data (Prague, two flats, a car sold April 2026), not
   real records.

---

## Screens / views

### 1. Documents (main)

**Purpose.** Find a document, see what is expiring, get to the Inbox.

**Layout.** Content area only — the 252px app sidebar sits outside this frame. Content padding
`26px 32px 60px`. Body is a vertical flex, `gap: var(--space-8)` (16px).

Row 1 — `ScreenHeader`: title `🗂️ Documents` at 28/600, `-0.02em`; caption 13 `--fg3`.

Row 2 — toolbar, `display: flex; align-items: center; gap: var(--space-5)`, wraps. **Every control
is `var(--control-h)` = 36px.** Mixed-height field rows are a documented past defect.
- Search input: `flex: 1 1 280px; max-width: 420px`, 1px `--bd2`, `--radius-md`, padding
  `0 12px 0 34px`, 13px. 16px search `Icon` absolutely positioned at `left: 11px`, `--fg3`,
  `pointer-events: none`.
- `Group` eyebrow (11/uppercase/0.1em `--fg3`) + `Segmented`: Type · Entity · Year · Expiry ·
  None. Default **Type**. Five options, so it is a control and never a single tab. Active segment
  `--card3` fill, `--fg1`, 500. 1px `--bd` dividers between segments, `--radius-md` on the group,
  `overflow: hidden`.
- Sort `<select>`: Newest first · Name A–Z · Expiry soonest. **Group ≠ sort — separate controls.**
- `Add document`: `margin-left: auto`, `--brand` fill, white text, 13/500.

Row 3 — `display: grid; grid-template-columns: 218px minmax(0, 1fr); gap: 28px; align-items: start`.
Below 860px collapse to a single column (this breakpoint already exists in `+page.svelte`).

**Rail (218px, `position: sticky; top: 14px`).** This width exists in code — keep it.
- Group A: `Everything` (count 412) and `Inbox` (count 6). The Inbox count is `--yellow`; every
  other count is `--fg3`.
- 1px `--bd` divider.
- Group B: shelf list in its own `max-height: 340px; overflow-y: auto` container — past ~15
  shelves the rail scrolls independently and the body never does.
- 1px `--bd` divider.
- `Manage shelves` with a 16px plus `Icon`, `--fg3` → `--fg2` on hover.

Rail item: `display: grid; grid-template-columns: minmax(0,1fr) auto; gap: var(--space-5);
padding: 8px 10px; border-radius: var(--radius-md); border: 0; background: transparent`, label 13
`--fg2` truncating with ellipsis, count mono 11 `--fg3` `tabular-nums` right-aligned.
Hover `--card2`. Active `--card3` + `--fg1`. No emoji — see §"Open calls".

**List column.** Vertical flex, `gap: var(--space-7)` (14px).

*Inbox strip.* 1px `--bd`, `--radius-lg`, `--card`, padding `11px 14px`, horizontal flex
`gap: var(--space-6)`. Contains a `Pill hue="yellow"` reading `6 in Inbox`; a 13 `--fg2` line
"Filed with a name and nothing else. Nothing expires from the Inbox."; and a 30px
`Review Inbox →` button pushed right. **Amber lives inside the pill — never on the row.** Inbox
is work waiting, not an error.

*Archive affordance.* One 13 `--fg3` line, "Active subjects · `14` documents hidden from archived
subjects" (count mono), followed by a 28px `Include archived` / `Hide archived` toggle button.
Active state: `--card3` fill, `--bd2` border, `--fg1`.

*Group header.* `display: flex; justify-content: space-between; align-items: baseline;
padding: 0 var(--space-4) var(--space-4); border-bottom: 1px solid var(--bd)`. Label 13/500
`--fg1` left; **bare mono 11 `--fg3` count flush right — one convention, used identically by the
rail counts and the review counter.**

*Document row.* `display: grid; grid-template-columns: 38px minmax(0, 1fr) 140px;
align-items: center; gap: var(--space-5); padding: 9px var(--space-4);
border-radius: var(--radius-md)`. Hover `--card2`. Whole row is the click target.

| Cell | Spec |
|---|---|
| ext badge | existing `mono ext` treatment — mono 10/600, `0.04em`, `--fg3`, 1px `--bd`, `--radius-xs`, `padding: 2px 0`, centred |
| name + sub | flex column, `gap: 1px`, `min-width: 0`. Name **13.5**/400 `--fg1`, ellipsis, never wraps. Sub-line **11.5**/400 `--fg3`, ellipsis — `Shelf · Entity` |
| expiry | `justify-content: flex-end`. `Pill` when amber or red; plain mono 11 `--fg3` `tabular-nums` otherwise |

**The 140px right column is fixed so pills never reflow between rows and dates never truncate.
Truncate names, never dates.**

Inline after the name, `flex: none`, when applicable:
- **Quiet lock** (restricted, admin only) — 13px lock `Icon`, `--fg3`. No tint, no pill, no row
  treatment, **never red**. Restricted is an access state, not a warning.
- **`Archived subject` chip** — 11 `--fg3`, 1px `--bd`, `--radius-xl`, `padding: 0 7px`, no tint.
  It is a fact about the subject, not a state of the document.

**Expiry pill copy and hue** (the existing `Pill` component, `hue` prop):

| Condition | Text | Treatment |
|---|---|---|
| far future | `renews 12 Jan 2027` | no pill — plain mono `--fg3` |
| within ~60 days | `renews in 21 days` | `Pill hue="yellow"` |
| passed | `expired 6 days ago` | `Pill hue="red"` |
| passed, archived subject | `ended 2026-04-18` | **no pill** — plain mono `--fg3` |

That last row matters: expiry that has already passed on an archived subject is history, not a
problem, and must not carry red.

**Responsive — three widths.**

| Width | Grid | Behaviour |
|---|---|---|
| ≥1200 (list col ≥700) | `38px / 1fr / 140px` | as above |
| 860–1200 | `32px / 1fr / 128px`, gap `var(--space-4)` | rail collapses above the list; pill sheds its verb → `in 21 days`. The verb is restated in the group header when grouping is Expiry, and always in the inspector |
| <640 | two lines inside a 1px `--bd` `--radius-md` card, `padding: var(--space-5)`, `gap: var(--space-3)` | name wraps (`text-wrap: pretty`) — the only width where it does, because nothing competes for the space. Second line: ext chip, sub-line, pill pushed right with `margin-left: auto` |

**States.**

| State | Spec |
|---|---|
| empty shelf | `Nothing on {Shelf} yet.` 13.5 `--fg1` + 13 `--fg3` sub + 36px `Add document`. Sub: "Drop a file anywhere on this screen and it lands in the Inbox — you can move it here later." |
| fresh install | Full-width `UploadDropzone` (its own dashed `--bd2` border — not a new treatment). `No documents yet.` + "Drop files here, or click to browse. A name is generated and they go to the Inbox — nothing else is asked of you." |
| loading | Three static `--card2` blocks at 34px, `--radius-md`, opacity 1 / 0.7 / 0.45. **No shimmer — the system has no animation.** Always three regardless of the real count: a guessed count that then changes is worse than none |
| error | 1px `--red`, `--red-wash` fill. `Could not load documents.` + "The archive is on disk and unreadable right now. Nothing has been lost." + 36px `Try again` |
| restricted (admin) | normal row + 13px lock glyph. **For members the row does not exist and the count is computed after filtering** — 26, not 27. No teaser rows, no visible locks |
| archived included | normal row + grey outline chip + plain mono date |

---

### 2. Document inspector

**Purpose.** Read a document's filing, edit it, get to the file.

**Layout.** In-content panel, **460px** (range 440–480; the prototype exposes this as a tweak).
Full-screen on mobile. 1px `--bd`, `--radius-lg`, `--card`. Vertical flex.

1. **Header** — `padding: var(--space-8) var(--space-8) var(--space-6)`, flex row.
   Title 19/600 `-0.01em` `--fg1`, `text-wrap: pretty`. **The quiet lock is inline in the title
   text flow** — a 15px `Icon` with `vertical-align: -1px; margin-left: 7px`, wrapped with a
   zero-width space in a `white-space: nowrap` span so it trails the last word and wraps with it.
   *Do not lay it out as a flex sibling*: on a two-line name it centres against the whole block
   and reads as a second toolbar button. Below the title, mono 11.5 `--fg3`: `PDF · 412 kB · added
   2026-02-11`. A 36×36 `⋯` button sits at the row's right, `flex: none`.
2. **Preview** — `FileViewer`, `max-height: 260px`, `object-fit: contain`, centred on `--card2`,
   1px `--bd`, `--radius-md`. A4 is `aspect-ratio: 210/297`. **Tall receipts letterbox rather than
   crop** — cropping the top of a receipt hides the merchant. Landscape photos leave the box short
   and the panel closes up; it does not pad to A4.
3. **Actions** — `Open file` (primary, `--brand`, `flex: 1`) + `Edit` (36px, 1px `--bd2`).
   `Open file` outranks `⋯` by fill and width; `⋯` is a 36px icon square with no label.
4. 1px `--bd` full-bleed rule.
5. **Sections** — `padding: var(--space-6) var(--space-8) var(--space-8)`. One per line:
   `FILED IN` · `TYPE` · `ABOUT` · `EXPIRY` · `TAGS` · `NOTE`. Each is `Eyebrow` (11/400,
   uppercase, `0.1em`, `--fg3`) over a value box, `padding: var(--space-5) 0`, separated by 1px
   `--bd`; the last has no rule.

**Read ↔ edit swap, no layout jump.** Every read value sits in a `min-height: var(--control-h)`
box with the same 10px horizontal inset as the input that replaces it. Eyebrow, rule and section
padding are identical in both modes. Only the 1px border and the caret appear. The panel's total
height therefore changes by exactly the Note textarea's growth — nothing above it moves.

**Edit controls** (all `Field`, all 36px): Filed in `<select>` · Type `<select>` · About =
chip input · Expiry = `grid-template-columns: 108px minmax(0,1fr)` with a verb `<select>`
(`renews` / `expires` / `ends` / `due`) and a **native `<input type="date">` — never a text mask**
· Tags = `TagInput` · Note = `<textarea>`, `min-height: 72px`, `resize: vertical`. Below the last
rule, a `Restricted` toggle with the sub-line "Absent for members, not locked."
Header actions become `Save` (primary) + `Cancel`.

**Metadata-only variant.** `UploadDropzone` occupies the preview slot at the same width but sized
to its content — an empty A4-shaped hole reads as a failed load. Copy: `No file attached` +
`Attach file`. `Open file` is **absent, not disabled**; `Edit` becomes primary.

**`⋯` menu — pinned order, never contextual.** Replace file · Re-extract *(admin)* · Download ·
Delete *(link-cascade confirm, `--red`)*. 300px popover, 1px `--bd2`, `--radius-lg`, `--bg2`
fill, 36px rows, hover `--card2`. **`Re-extract` is greyed for members rather than hidden**, so a
member and an admin describing the menu describe the same menu.

**Mobile (390px).** Full-screen. Header bar: back chevron + **the shelf name you came from**
(a bare chevron loses the promise), `⋯` right. Title at 22/600. Same sections stacked. Back
restores list scroll position and the open group.

---

### 3. Inbox review

**Purpose.** File a backlog fast, one document at a time.

**Layout.** `display: grid; grid-template-columns: 58fr 42fr`, 1px `--bd` between panes. Below a
480px floor on the field column, fields go single-column above the preview.

**Header bar** — `Review Inbox` 22/600 + mono 13 `--fg3` `6 remaining` + `Done for now` (36px,
ghost) pushed right. 1px `--bd` below.

**Left pane** (`--bg2` fill, `padding: var(--space-8)`). Filename + page count in mono 11.5
`--fg3`; a 30px zoom `Segmented` (Fit · **Width** · 100%) pushed right; then `FileViewer`,
`min-height: 420px`. **Default zoom is `Width`, not Fit** — the decision being made is *what is
this*, and that is almost always readable in the top third at full width. Fit shows the whole
page and none of the words.

**Right pane** (`padding: var(--space-8)`, `gap: var(--space-6)`). Fields in order: Name ·
Filed in + Type (side by side, `1fr 1fr`) · About · Expiry (verb + native date) · Tags · Note ·
`Restricted` toggle. All 36px.

**Sticky defaults.** Shelf and Type carry over from the previous `File & next`. The mark is the
word **`kept`** at 11.5 `--fg3` beside the eyebrow — no tint, no italic, no icon — and it clears
the moment the field changes. Rejected: a blue-tinted select (reads as an error) and a "same as
last" checkbox (a second decision to solve a no-decision problem).

**Footer** — `margin-top: auto`, 1px `--bd` above, `padding-top: var(--space-7)`.
`Skip` is a ghost 36px button, `--fg3`, hugging its label. `File & next →` is `flex: 1`,
`--brand`, 13/500 — **File is unambiguously primary by fill and by width.** Below, right-aligned
mono 11.5 `--fg3`: `Enter to file · Esc to leave`.

**Skip at the last document.** Wraps to the first document skipped this session; the counter
switches to `2 skipped` rather than `0 remaining`. Skipping the last skipped one exits to the
Inbox with those still in it. Skip never files and never deletes, so a lap of pure skipping is a
no-op — which is what makes it safe to press.

**Empty.** `Inbox is clear.` on `--green-wash` with a 1px `--green` border. See the flag in
§"Judgement calls".

---

### 4. Settings → Shelves

**Purpose.** Reorder, rename, re-emoji, add and delete shelves.

**Layout.** `max-width: 620px` — a settings list spanning 1200px is unreadable. One card, 1px
`--bd`, `--radius-lg`, rows separated by 1px `--bd`.

**Row** — `display: grid; grid-template-columns: 28px 36px minmax(0,1fr) auto 36px;
align-items: center; gap: var(--space-5); padding: 0 var(--space-6) 0 var(--space-5);
height: 52px`. Hover `--card2`.

| Cell | Spec |
|---|---|
| handle | 16px drag `Icon`, `--fg3`, `cursor: grab` |
| emoji | 36×36 button, 1px `--bd`, `--radius-md`, 16px glyph — opens the picker |
| label | 13.5 `--fg1` over mono 11.5 `--fg3` count (`63 documents`) |
| badge | `System` — mono 11/600 `--fg3` on `--grey-tint`, 1px `--bd2`, `--radius-xl`. Inbox only |
| menu | 36×36 `⋯`, `--fg3`, hover `--card3` + `--fg1` |

**Reorder.** The dragged row keeps its 1px border and takes `--card3` — the fill the active rail
item already uses. **No lift, no shadow, no transition** — the system has none.

**Add shelf — inline row, not a dialog.** Last row of the same card: a dashed 36px emoji button,
a `New shelf name` input, an `Add` button. One text field, in the position the row will occupy.
A dialog for one field is the wizard the brief rules out.

**Delete → reassign-then-delete, always.** `Modal`, `max-width: 480px`, 1px `--bd2`,
`--radius-xl`, `--bg2`, `padding: 22px`.
- Title 19/600: `Delete “Payslips”?`
- Body 13.5 `--fg2`: "`32` documents need another shelf first. Nothing is deleted except the
  shelf itself." (count mono)
- `MOVE THEM TO` eyebrow + 36px `<select>`
- Right-aligned: `Cancel` (ghost) · `Move & delete` (1px `--red`, `--red-tint` fill, `--red` text)

**Emoji picker.** A `repeat(6, 36px)` grid, `gap: var(--space-3)` — 24 cells at one
`--control-h` square each, so the grid is 236px and needs no scroll — plus a `maxlength="2"`
text field ("or paste any character") and a `Clear` button. Set:
`🗂️ 🏠 🚗 🏦 🩺 🪪 🔧 💼 📄 🧾 📬 🐕 🎓 ✈️ ⚡ 💧 🔥 🌱 👶 🛡️ 📷 🎟️ 🧰 ⚖️`

---

### 5. Search — result rows and honesty states

Three row variants, all on the same `38px / 1fr / 140px` grid. Content and note matches use
`align-items: start` and add `margin-top: 2px` to the ext badge and the date.

| Variant | Adds |
|---|---|
| metadata match | nothing — a plain row with the term highlighted in the name |
| content match | 12 `--fg2` snippet behind a 1px `--bd2` left rule, `padding-left: var(--space-5)`, then mono 10 `--fg3` `Matched in contents · page 2` |
| note match | same snippet treatment, prefixed `Note · „…“` |

**Term highlighting.** 600 weight + `--yellow-tint` ground at 3px radius, **on the term only —
never the row, never the whole snippet.** Yellow is already the attention hue in the pill scale,
so a matched term and an expiring pill agree. The term carries **no border**, so it cannot be
mistaken for a pill.

**Four honesty states.** Cards, `min-height: 160px`, 1px `--bd`, `--radius-lg`, `--card`, mono 11
`--fg3` key, 13.5 `--fg1` head, 13 `--fg2` body, optional 36px action pinned with `margin-top:
auto`.

| State | Head | Body | Action |
|---|---|---|---|
| empty | Nothing matches “{q}”. | Names, notes and tags were searched. Contents are searched for documents that have a text layer. | Clear search |
| still preparing | Nothing yet — {n} documents are still being prepared. | Their contents are not searchable until that finishes. Names, notes and tags already are. | — |
| archived only | No active matches. {n} matches sit on archived subjects. | {Subject} and one other subject you have archived. | Include archived subjects |
| not content-searchable | {n} matches. {m} documents cannot be searched by contents. | Photographs and scans without a text layer are matched on name, note and tags only. | List the {m} |

**These four strings are placeholders in the described shape. v3 §5.2/§6.7 holds the locked
wording — swap it in. Blocking.** If any runs past two lines at 340px the block grows downward
and no layout changes.

---

## Interactions & behaviour

- **No animation, no transitions, anywhere.** Selection and hover are quiet fill changes;
  inspector content replaces instantly. This is a system-wide rule, not an omission.
- **Hover:** rail items and document rows → `--card2`. Ghost buttons → border `--bd` → `--bd2`.
  Menu rows → `--card2`. `⋯` → `--card3`.
- **Keyboard:** focus ring must stay visible (`--ring-focus` equivalent in `app.css`). In Inbox
  review, `Enter` = File & next, `Esc` = leave. The key hint is always on screen, not in a
  tooltip.
- **Click targets:** the whole document row navigates to the inspector. Tag chips filter across
  type boundaries — that is the argument for tags over nested folders and it must survive.
- **Delete:** documents use the existing two-tap arm-then-confirm on the row; shelves always go
  through reassign-then-delete. Never a native `confirm()` — it blocks the page.
- **Overflow:** wide content scrolls in its own container. **The body never scrolls sideways.**
- **Reduced motion:** nothing moves, so nothing to gate — but if a drag preview is added, respect
  `prefers-reduced-motion`.
- **A document appears exactly once** in any result set. Grouping provides structure; grouping is
  not sorting.

## State management

| State | Type | Notes |
|---|---|---|
| `shelf` | string | URL param, as today (`?shelf=`) |
| `query` | string | URL param `?q=`, `keepFocus: true, noScroll: true` on navigate |
| `tag` | string | URL param `?tag=`, single active tag |
| `group` | enum | `type` (default) · `entity` · `year` · `expiry` · `none` |
| `sort` | enum | independent of `group` |
| `includeArchived` | boolean | default false |
| `inspectorId` | string \| null | which document is open |
| `inspectorMode` | `read` \| `edit` | resets to `read` on document change |
| `reviewIndex`, `reviewSkipped` | number, string[] | Inbox review session only, not persisted |
| `stickyShelf`, `stickyType` | string | carried across `File & next` within one session |

Counts (`Everything`, per shelf, per group, `N remaining`) are **derived, never stored**, and
**computed after visibility filtering** — a member must never be able to infer a restricted
document from a count.

## Design tokens

All from `app.css`. Named here, never valued — a hex literal in a component is a bug.

**Colour.** `--fg1` `--fg2` `--fg3` (foreground ramp — **never dim with opacity**) ·
`--bd` `--bd2` (the only two border strengths; always 1px) · `--card` `--card2` `--card3`
(ambient / hover / active fills) · `--bg` `--bg2` · `--brand` (primary buttons) ·
`--green` `--yellow` `--red` (traffic-light state **only**) · `--blue` `--teal` `--purple`
(data series) · `*-tint` at 0.18 for pill fills · `*-wash` at 0.07 for surface fills ·
`--grey-tint` for the `System` badge.

**Type.** Inter (self-hosted) for text; **Source Code Pro for every figure** — counts, dates in
lists, sizes, `6 remaining` — with `tabular-nums` wherever digits stack in a column.
Ramp: `10 · 11 · 12 · 13 · 14 · 16 · 19 · 22 · 28`, plus **11.5 and 13.5** used for list sub-lines
and row names respectively (these are in the shipped Documents screen already; if they are not in
the ramp, flag it — do not round them silently).
Roles: screen title 28/600 `-0.02em` emoji-prefixed · section heading 22/600 · eyebrow 11/400
uppercase `0.1em` `--fg3` · row name 13.5/400 · body 13/400 · caption 11.5/400 `--fg3`.

**Geometry.** `--radius-xs` 4 (ext badge) · `--radius-sm` 6 · `--radius-md` 8 (buttons, inputs) ·
`--radius-lg` 10 (cards) · `--radius-xl` 12 (pills, dialogs) · `--radius-chip` 20 (tag chips) ·
`--radius-pill` 999 (avatars, toggles).
Space scale `--space-1` … `--space-8` (2 · 4 · 6 · 8 · 10 · 12 · 14 · 16).
**`--control-h` 36px on every input, select, textarea and button.**
Sidebar 252px · shelf rail **218px** · content padding 26/32/60.

**Shadows: none, anywhere.** Depth is background tint plus a 1px border.
**Coloured borders: traffic-light pills only.**

## Components

**Reuse unchanged** — `Pill`, `Icon`, `Eyebrow`, `Field`, `Modal`, `FileViewer`, `ListPager`,
`Segmented`, `TagInput`, `ScreenHeader`, `UploadDropzone`. The list-row `mono ext` badge keeps
its current treatment.

**Three new, each justified** (drift between near-identical components is this codebase's most
common defect, so the bar is deliberately high):

| Component | Why it must be new |
|---|---|
| `SnippetMark` | A 600-weight span on `--yellow-tint`, matched terms only. Highlighting inside prose has no existing owner, and inlining it at four call sites is exactly the drift to avoid. |
| `ShelfRow` | Handle · emoji button · label · System badge · `⋯`. The only sortable row in the app. It does **not** extend `TransactionRow`, which is a data row with no reorder affordance. |
| `EmojiPicker` | 24-cell grid + two-character field. Nothing in the codebase picks a glyph, and the alternative — an external picker — is banned. |

**Three new `Icon` paths** (lock, drag handle, search) — additions to the existing set at
24 viewBox / stroke 1.7 / `currentColor`, not a component. **No icon libraries, no CDNs, ever.**

## Open calls — answered

**Emoji in the main rail → no. Settings list and screen title only.** The rule permits emoji at
row level and rail entries are rows, so this is judgement, not compliance. Three reasons: (1) the
app sidebar 252px to the left renders 19px `<Icon>` glyphs, and a second glyph column that close
reads as two competing icon systems; (2) the 218px rail already carries a right-aligned mono
count, and a 20px emoji gutter costs the label its last two characters exactly where shelf names
are longest; (3) the rail's job is switching, and the active `--card3` fill already does the work
a glyph would. The emoji still appears where it is *chosen* (Settings) and where it *identifies
rather than navigates* (the `🚗 Car` screen title — the sanctioned prefix position). The
prototype exposes `railEmoji` as a tweak so the cost is visible directly.

**Emoji picker → 24-cell grid at 36px plus a two-character field.** External pickers are banned
and a self-hosted app on Linux cannot rely on an OS picker being reachable. Twenty-four cells
cover the household domain in a 236px grid with no scroll; the field covers the twenty-fifth
without shipping an emoji database.

## Derived values — where the system was silent

- **Loading.** No loading state and no animation exist, so there is no shimmer to borrow. Derived
  from the metric tile: three static `--card2` blocks at row height. Flag if a spinner exists
  that was not found in `src/lib/components/`.
- **Term highlight ground.** No inline-mark token. Derived from `--yellow-tint` (the attention
  hue already used by the amber pill) at 3px radius, no border. Names a token, adds no value.
- **Reorder affordance.** Nothing in the app reorders. Handle is a new `Icon` path at 16px
  `--fg3`, `cursor: grab`; the dragged row takes `--card3`, the fill the active rail item already
  uses.

## Judgement calls — flagged for reconciliation

- **Green as a done state.** The empty Inbox uses `--green-wash` for "clear". Green otherwise
  means a traffic-light state. It is a surface rather than a pill, so the pill contract holds —
  but it is the one place in this pass where a semantic hue carries a mood.
- **Left rule on snippets.** A 1px `--bd2` left rule marks quotation; rules elsewhere mark
  boundaries. The alternative is 12px `--fg2` indented 10px with no rule, which loses the scan
  line down a column of results.

## Themes

Everything is drawn dark (default and base). Light is explicit opt-in via
`html[data-ledger-theme='light']`, no system fallback. Only two token choices are non-obvious:

- The lock glyph and the `Archived subject` chip both rely on `--fg3` against `--card`. In light,
  **darken the ink, never re-mix the tint**.
- The `--yellow-tint` highlight ground is the one place a tint sits *behind ink* rather than
  behind a border. Check it at light-theme contrast; if it fails, darken the term to `--fg1`
  rather than deepening the tint.

## Not designed, on purpose

Folder tree · cards or thumbnails in lists · drag-and-drop between shelves · AI suggestions ·
saved-view manager · advanced-search screen · wizards · dashboards. Per §2 of the source brief.
Do not add them.

## Assets

None. No images, no icon libraries, no CDN fonts in the target implementation — Inter and Source
Code Pro are self-hosted in the codebase already. The prototype loads them from Google Fonts for
portability only; **do not carry that link over.** Emoji are Unicode characters, rendered by the
system font.

## Files

| File | What it is |
|---|---|
| `Continuum Documents Refinement.dc.html` | The design reference. Six tabs; open in a browser with `support.js` beside it. Two live tweaks: `railEmoji`, `inspectorWidth` |
| `support.js` | Runtime required by the HTML above |
| `design-rationale.md` | Why each decision went the way it did — the reasoning behind this spec, including rejected alternatives |
| `README.md` | This file |

Source read during the pass: `src/routes/(app)/documents/+page.svelte` and `+page.server.ts`,
`src/lib/components/Pill.svelte`, and the token block in `src/app.css`.
