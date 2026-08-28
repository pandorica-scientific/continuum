# Continuum Documents — Design Handoff (for UI/UX refinement)

**Audience:** a design-focused Claude session refining the Documents redesign. Assume no repository access — everything binding is in this document.
**Authority chain:** `continuum-documents-handoff-v3.md` is the locked architecture and behaviour spec. This document derives from it. Where they disagree, v3 wins. Your output returns for reconciliation into a unified execution handoff; nothing you produce ships directly.
**In the repo itself**, the codebase is the design system (`docs/ui-guidelines.md`): `app.css` holds tokens, `src/lib/components/` holds primitives. Values below are extracted from there and are constraints, not suggestions.

---

## 1. What you are designing

Four surfaces, one module, self-hosted household app (SvelteKit, dark default):

1. **Documents (main)** — shelf rail + searchable, groupable, single-appearance document list
2. **Document inspector** — in-content detail/edit panel (~440–480px), full-screen on mobile
3. **Inbox review** — split-pane rapid filing (preview | fields, `Skip` / `File & next →`)
4. **Documents → Settings → Shelves** — reorder, rename, emoji, add, delete-with-reassign

ASCII wireframes for all four exist and are approved in structure (appendix). Your job is refinement: visual hierarchy, states, spacing, copy polish, responsive behaviour, component mapping — not rearchitecting the surfaces.

## 2. Locked behaviour you must design around (from v3)

- **Model:** shelf = where in life (one per doc, user-editable rows) · type = what kind (fixed enum) · entity links = what it concerns (many) · tags = free cross-cuts. Never expose raw vocabulary (`type: insurance_policy`, `source: ocr`, confidence) outside an admin "Technical details" disclosure.
- **Visibility invariant:** restricted documents are simply absent for members — no teaser rows, no locks they can see, counts computed after filtering. Admins see a *quiet* lock (row + inspector read view). Restricted is an access state, not a warning.
- **No required enrichment:** minimum valid document = file + generated name + Inbox. Capture is a drop zone + "Added to Inbox", nothing else. Inbox is work waiting, not an error — amber count, never a red/whole-row alarm.
- **Archive:** documents linked only to archived subjects hide by default. Affordance: "Active subjects · N documents hidden from archived subjects" → include toggle; included ones get a subtle "Archived subject" label. Search must say when matches exist only in the archive.
- **A document appears once** in any result set; grouping (Type default · Entity · Year · Expiry · None) provides structure; group ≠ sort (separate controls).
- **Search honesty copy** (exact strings in v3 §5.2/§6.7): empty, still-preparing, archived-only, not-content-searchable counts. Highlight matched terms in snippets; never paint whole rows.
- **Inbox review:** fields = name, shelf, type, about, expiry (verb+date), tags, note, compact sensitivity toggle. Shelf/type sticky from previous File & next. Enter = File & next. Native date inputs, never text masks.
- **Inspector `⋯` menu is pinned:** Replace file · Re-extract (admin) · Download · Delete (link-cascade confirm). Delete of a *shelf* is always reassign-then-delete.
- **Not built, don't design:** folder tree, cards/thumbnails in lists, drag-and-drop between shelves, AI suggestions, saved-view manager, advanced-search screen, wizards, dashboards.

## 3. Design-system constraints (extracted from the codebase — binding)

**Themes.** Dark is default and base; light is explicit opt-in (`html[data-ledger-theme='light']`), no system fallback. Every colour is a token — a hex literal in a component is a bug. Light-theme tints mix from bright hues never used as ink; if a pill fails contrast, darken the ink, never re-mix the tint.

**Type.** Inter (self-hosted) for text; Source Code Pro for **every figure** — counts, dates in lists, sizes, "6 remaining" — `mono`, columns of digits `tabular-nums`. Sizes only from the ramp: 10 · 11 · 12 · 13 · 14 · 16 · 19 · 22 · 28. Roles: screen title 28/600 (emoji-prefixed, −0.02em) · section heading 22/600 · eyebrow 11/400 uppercase 0.1em `--fg3` (use for FILED IN / TYPE / ABOUT / EXPIRY / TAGS / NOTE in the inspector) · body/list row 13–13.5/400 · captions 11.5–12 `--fg3`. Foreground ramp `--fg1/2/3`; never dim with opacity.

**Geometry.** Radii from scale: 8px buttons/inputs · 9–10px cards · 12px pills · 20px chips · 999 avatars. Space scale 2–16. One control height: `--control-h` 36px for every input/select/textarea/button — mixed-height field rows are a documented past defect. Main content padding 26/32/60; sidebar 252px; the Documents shelf rail is **218px** (exists in code — keep it). Borders always 1px (`--bd`, `--bd2`); **no shadows anywhere**; coloured borders only on traffic-light pills.

**The traffic-light pill** (existing `<Pill hue>` component): green/yellow/red always mean state — use for expiry (`renews 12 Jan 2027` normal · `renews in 21 days` amber · `expired 6 days ago` red, dates mono). Blue/teal/purple carry data series; grey neutral. Never decorative.

**Icons.** Inline SVG via existing `<Icon>` (24 viewBox, stroke 1.7, currentColor). **No icon libraries, no CDNs, ever** — new glyphs (lock, inbox, drag handle if missing) are added as paths. Sizes 19 sidebar / 16 header buttons. **Emoji** survive at card/row level (shelf rows may carry `shelf.emoji`, matching account-row precedent) and as screen-title prefixes — not as section markers. Open call for you: emoji in the main rail, or settings-list only? Recommend and justify against this rule.

**Interaction restraint.** No animation/transitions; selection and hover are quiet fill changes; inspector content replaces instantly. Keyboard focus visible; anything that moves respects `prefers-reduced-motion`. Wide content scrolls in its own container — the body never scrolls sideways (the Money area's tab row scrolls for this reason). A single tab is a label, not a choice — never render one.

**Existing primitives to reuse before inventing** (`src/lib/components/`): `Pill`, `Icon`, `Eyebrow`, `Field`, `Modal`, `FileViewer` (preview), `ListPager`, `Segmented`, `TagInput` (tags field), `ScreenHeader`, `UploadDropzone` (capture). The list-row extension badge (`mono ext`) already exists on the Documents screen — keep its treatment.

## 4. Per-surface refinement questions (your actual work)

**Main.** Row anatomy at three widths: reserve a fixed right column (~140px) for the expiry pill — truncate names, never dates. Group header treatment: bare mono count flush right, one convention. Rail: `Everything`/`Inbox` above divider; counts mono, right-aligned; active-shelf state; does the rail scroll independently past ~15 shelves? Empty states per shelf and for fresh installs. Inbox strip: amber accent within pill semantics without alarm.

**Inspector.** Vertical rhythm of eyebrow-labelled sections; preview aspect handling (portrait A4 vs receipt strips vs images); `Open file` prominence vs `⋯`; read↔edit swap without layout jump (same 36px control grid both modes); metadata-only variant ("No file attached · Attach file"); quiet-lock placement beside the name; mobile full-screen variant with Back restoring list state.

**Inbox review.** Pane proportions and preview zoom; making sticky shelf/type legible as *defaults carried over* without noise; `Skip` vs `File & next →` visual weight (File is primary); the `6 remaining` counter (mono); keyboard affordance visibility; what Skip does at the last document.

**Shelves settings.** Drag handle + row emoji + label + System badge (grey pill) + `⋯`; the reassign-and-delete dialog ("32 documents need another shelf first — Move them to [ … ] — Move & delete"); emoji picker approach (native input? small curated grid? justify — no external pickers); add-shelf inline row vs dialog.

**Search.** Result-row variants: metadata match (plain), content match (+ snippet + "Matched in contents"), note match; term highlighting treatment (weight or tint, not paint); the four honesty states as designed empty-state blocks.

## 5. What to return

Per surface: refined layout spec (a grid/measurement description or tightened ASCII/wireframe), all states (default, empty, loading, error, restricted-admin, archived-included), both themes noted only where a token choice is non-obvious, mobile variant, exact microcopy tables, and a component list — reused vs new, with a one-line justification for every new one (drift between near-identical components is this codebase's most common defect). Name tokens, never values; where the system doesn't cover something, say so explicitly and derive from a neighbour rather than inventing.

---

## Appendix — approved wireframes (structure locked)

[Main screen, Inspector + edit mode, Inbox review, Shelves settings — as provided in the working session; reproduce from v3 §6 and the four ASCII sketches accompanying this handoff.]
