# Continuum Documents — refinement pass, returned for reconciliation

**Deliverable:** `Continuum Documents Refinement.dc.html` — six tabs, every state drawn at real
type sizes with the codebase's own tokens. This file is the written companion; where the two
disagree, the DC is the artefact and this is the index.

**Authority:** `continuum-documents-handoff-v3.md` remains the locked spec. Nothing here
rearchitects a surface. Structure was approved; this pass is hierarchy, states, spacing, copy,
responsive behaviour and component mapping.

**Nothing here ships directly.** It returns for reconciliation into the unified execution handoff.

---

## 1. What was drawn

| Tab | Surface | Contains |
|---|---|---|
| Main | Documents (main) | Full frame at content width, rail + list, row anatomy at three widths, six states |
| Inspector | Document inspector | Read and edit side by side at the same scale, preview-aspect rule, metadata-only variant, mobile, `⋯` menu |
| Inbox review | Split-pane filing | 58/42 panes, sticky-default treatment, Skip-at-last behaviour, empty state |
| Shelves settings | Settings → Shelves | Row grid, add-inline row, reassign-and-delete dialog, emoji picker |
| Search | Result rows + honesty | Three match kinds, term highlighting, four honesty blocks |
| Components & copy | Handoff tables | Reused vs new with justification, microcopy table, gaps and flags |

Two props are exposed as Tweaks so the open calls can be judged live: `railEmoji` (boolean) and
`inspectorWidth` (440–480px).

---

## 2. The two open calls, answered

### Emoji in the main rail → **no. Settings list and screen title only.**

The rule permits emoji at row level and rail entries are rows, so this is judgement, not
compliance. Three reasons against:

1. The app sidebar sits 252px to the left rendering 19px `<Icon>` glyphs. A second glyph column
   that close reads as two competing icon systems.
2. The 218px rail already carries a right-aligned mono count. A 20px emoji gutter costs the label
   its last two characters exactly where shelf names are longest.
3. The rail's job is switching, and the active fill (`--card3`) already does the work a glyph
   would.

The emoji still appears where it is *chosen* (Settings) and where it *identifies rather than
navigates* (the `🚗 Car` screen title — the sanctioned prefix position). Nobody loses sight of
their choice. Toggle `railEmoji` on in Tweaks to see the cost directly.

### Emoji picker → **24-cell grid at 36px, plus a two-character text field.**

External pickers are banned and a self-hosted app on Linux cannot rely on an OS picker being
reachable. Twenty-four cells at one `--control-h` square each make a 236px grid that needs no
scroll and covers the household domain; the text field covers the twenty-fifth without shipping
an emoji database.

---

## 3. Per-surface decisions worth carrying forward

**Row anatomy.** `38px ext · minmax(0,1fr) name+sub · 140px expiry`, right column fixed so pills
never reflow between rows and dates never truncate. Below ~1200 the column drops to 128px and the
pill sheds its verb (restated in the group header when grouping is Expiry, and always in the
inspector). Below 640 the row becomes two lines inside a 1px border — the only width where the
name wraps rather than truncates, because nothing competes for the space.

**Group headers.** One convention everywhere: label 13/500 left, bare mono count flush right,
1px `--bd` bottom rule. Same convention as the rail counts and the `6 remaining` counter.

**Rail.** `Everything` / `Inbox` above a divider, shelves in their own `max-height: 340px`
scroll container past ~15, `Manage shelves` below a second divider. The body never scrolls
sideways or vertically on the rail's behalf.

**Inbox strip.** Amber lives inside the pill (`6 in Inbox`, `--yellow` border + `--yellow-tint`),
never on the row. Inbox is work waiting, not an error.

**Restricted, admin view.** A 13px `--fg3` lock after the name. No tint, no pill, no row
treatment, never red — restricted is an access state. For members the row does not exist and the
count is computed after filtering.

**Archived subjects.** Grey outline chip, no tint: it is a fact about the subject, not a state of
the document. Expiry that has already passed on an archived subject drops the red pill and
becomes a plain mono date — history, not a problem.

**Read ↔ edit, no jump.** Every read value sits in a `min-height: var(--control-h)` box with the
same 10px inset as the input that replaces it. Eyebrow, rule and section padding are identical in
both modes, so the panel's height changes by exactly the Note field's growth and nothing above it
moves.

**Preview aspect.** One rule: box is `max-height: 260px`, artwork is `object-fit: contain`,
centred on `--card2`. Tall receipts letterbox rather than crop — cropping the top of a receipt
hides the merchant. Landscape photos leave the box short; the panel closes up rather than padding
to A4.

**Metadata-only.** The dropzone occupies the preview slot at the same width but sized to its
content — an empty A4-shaped hole reads as a failed load. `Open file` is absent, not disabled;
`Edit` becomes primary.

**`⋯` menu.** Order never changes with context. `Re-extract` is greyed for members rather than
hidden, so a member and an admin describing the menu describe the same menu.

**Inbox review.** Default zoom is `Width`, not Fit: the decision is *what is this*, and that is
almost always readable in the top third at full width. Fit shows the whole page and none of the
words.

**Sticky defaults.** The word `kept` at 11.5px `--fg3` beside the eyebrow — no tint, no italic,
no icon, and it disappears the moment the field changes. Rejected: a blue-tinted select (reads as
an error) and a "same as last" checkbox (a second decision to solve a no-decision problem).

**Skip at the last document.** Wraps to the first document skipped this session; the counter
reads `2 skipped` rather than `0 remaining`. Skipping the last skipped one exits to the Inbox
with those still in it. Skip never files and never deletes, so a lap of pure skipping is a no-op
— which is what makes it safe to press.

**Add shelf.** Inline row, not a dialog. One text field, in the position the row will occupy.
A dialog for one field is the wizard the brief rules out.

**Search highlight.** 600 weight plus a `--yellow-tint` ground at 3px radius on the term only,
never the row and never the snippet. Yellow is already the attention hue, so a matched term and
an expiring pill agree; the term carries no border, so it cannot be mistaken for a pill.

---

## 4. Components

**Reused, unchanged:** `Pill`, `Icon`, `Eyebrow`, `Field`, `Modal`, `FileViewer`, `ListPager`,
`Segmented`, `TagInput`, `ScreenHeader`, `UploadDropzone`. The existing list-row `mono ext` badge
keeps its treatment.

**New — three, each with its argument:**

- `SnippetMark` — a 600-weight span on `--yellow-tint`, matched terms only. New because
  highlighting inside prose has no existing owner, and inlining it at four call sites is exactly
  the drift this codebase keeps hitting.
- `ShelfRow` — handle, emoji button, label, System badge, `⋯`. New because it is the only
  sortable row in the app; it does not extend `TransactionRow`, which is a data row with no
  reorder affordance.
- `EmojiPicker` — 24-cell grid plus a two-character field. New because nothing in the codebase
  picks a glyph and the alternative is banned.

Three new `Icon` paths (lock, drag handle, search) are additions to the existing set, not a
component.

---

## 5. Gaps, flags and one missing input

**Where the system does not cover it, and what it was derived from:**

- *Loading.* No loading state and no animation exist, so there is no shimmer to borrow. Derived
  from the metric tile: three static `--card2` blocks at row height. Three regardless of the real
  count — a guessed count that then changes is worse than none. Flag if a spinner exists that was
  not found.
- *Term highlight ground.* No inline-mark token. Derived from `--yellow-tint` at 3px radius, no
  border. Names a token, adds no value.
- *Reorder affordance.* Nothing in the app reorders. Handle is a new Icon path at 16px `--fg3`,
  cursor grab; the dragged row keeps its 1px border and takes `--card3`, the fill the active rail
  item already uses. No lift, no shadow — the system has none.

**Flagged for reconciliation — judgement calls that could go the other way:**

- *Green as a done state.* The empty Inbox uses `--green-wash` for "clear". Green otherwise means
  a traffic-light state. It is a surface rather than a pill so the pill contract holds, but it is
  the one place in this pass where a semantic hue carries a mood.
- *Left rule on snippets.* A 1px `--bd2` left rule marks quotation; rules elsewhere mark
  boundaries. The alternative is 12px `--fg2` indented 10px with no rule, which loses the scan
  line down a column of results.

**Missing input, blocking:**

- *v3 §5.2 / §6.7 exact strings.* The four search-honesty states are drawn to the described shape
  with placeholder wording. Swap the locked strings in before anything ships. If any runs past
  two lines at 340px the block grows downward and no layout changes.

---

## 6. Not designed, on purpose

Folder tree, cards or thumbnails in lists, drag-and-drop between shelves, AI suggestions,
saved-view manager, advanced-search screen, wizards, dashboards. Per §2 of the brief.

---

## 7. Themes

Everything above is drawn dark. Only two token choices are non-obvious in light:

- The lock and the `Archived subject` chip both rely on `--fg3` against `--card`. In light these
  must darken the ink, not re-mix the tint — per the codebase rule.
- The `--yellow-tint` highlight ground under 600-weight text is the one place a tint sits *behind
  ink* rather than behind a border. Check it at light-theme contrast before shipping; if it
  fails, darken the term to `--fg1` rather than deepening the tint.
