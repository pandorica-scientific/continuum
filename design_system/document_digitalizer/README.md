# Handoff: Scan engine — photograph a page, get one PDF

## Overview

Every file-upload point in Continuum gains a second route: photograph the document
instead of choosing a file. Five photographs become **one PDF** filed in the app — never
five images, never five files.

The feature is three surfaces and one token extension:

| Pass | Scope | Depends on the existing system? |
|---|---|---|
| **A** | Extend `app.css` — scrim, detection state, safe area, touch floor, motion | Yes, and it adds only what a live camera feed makes necessary |
| **B** | Capture and page preview — full-bleed chrome over a video frame | No precedent in the product |
| **C** | Dropzone and review | Yes, and Pass C is smaller than it looks — see below |

**Pass C is mostly not new work.** `UploadDropzone.svelte` already exists with idle,
dragging, busy and error states; it is used in two of the twelve upload sites. The scan
route adds one button to it. Everything else in this document is Pass A or B.

---

## Answers to the brief's §9

Recorded because they changed the scope, and because a future reader will ask the same
five questions.

1. **Does Continuum have a design system?** Yes — `src/lib/styles/app.css`, with the type
   ramp, geometry scale and traffic-light hues already tokenised and
   `design/no-raw-geometry` enforcing them. Pass A is an extension of five axes, not a
   project of its own.
2. **Is there a dark theme?** Yes, and **dark is the default**. Light is an explicit
   opt-in (`html[data-ledger-theme='light']`, set from a cookie before paint, with
   `color-scheme` flipped so the browser's own chrome follows). The capture screen
   therefore reuses an existing context rather than introducing one.
3. **What are the existing file inputs?** Twelve, listed below. `UploadDropzone.svelte`
   covers two of them.
4. **Icon set?** Custom, no library and no CDN. Twenty inline SVG primitives in
   `src/lib/icons.ts` — 24 viewBox, `currentColor`, 1.7 stroke, round caps, authored as
   typed primitives so nothing needs `{@html}`. This feature needs six more.
5. **Motion vocabulary?** Effectively none, but not nothing: `app.css` has exactly one
   transition (`background-color 90ms ease-out` on `.btn:active`) and one
   `prefers-reduced-motion` block. This feature sets the vocabulary, seeded from those.

### Decisions taken by the product owner

- **The scan flow follows the user's theme** — including the capture screen. One
  exception, argued below.
- **Auto-capture fires when the frame is stable**, and any touch anywhere cancels it.
- **No corner editing.** The user judges the photograph and replaces it if it is wrong,
  before any processing. This removes the loupe, the offset crosshair, the edge-of-frame
  grab problem and the whole corner-adjustment mode from §2.3.
- **The capture moment is a collapse** — the detected outline travels inward to the page
  thumbnail.
- **One dropzone design, everywhere.**

---

## About the design file

`Continuum Scan Engine.dc.html` is a **design reference created in HTML**. It is a
prototype showing intended look, layout, copy and behaviour — **not production code to
copy directly**. It opens standalone in a browser with `support.js` beside it.

Five tabs: **Tokens · Dropzone · Capture · Page preview · Review**. Every state is
togglable from the chip row on each tab, and the theme toggle in the header is live on all
five. Nothing needs camera access.

Prototype-only scaffolding, not to be ported: it is a single file with an inline template
plus a logic class, and the camera feed is a CSS gradient with an SVG quad over it.

**Fidelity is high.** Colours, typography, spacing, radii, states and copy are final, and
every value resolves a `var()` — there are no raw hex codes and no raw geometry in the
prototype. The five new tokens in §Pass A are the only additions to `app.css`.

---

## Pass A — the token extension

Five axes. Add them to `src/lib/styles/app.css` beside the existing tokens.

### 1 · Scrim — `--plate`, pinned across themes

```css
--scan-plate: rgba(14, 17, 23, 0.72);      /* --plate, one step softer */
--scan-plate-edge: rgba(14, 17, 23, 0.86); /* --plate exactly */
--scan-ink: #e6e9ef;                       /* dark --fg1, pinned */
--scan-ink-2: #c5ccd6;                     /* dark --fg2, pinned */
```

**These are not new colours.** `app.css` already has `--plate` for text that must sit on
an unknown ground — chart labels over waterfall ribbons. These are its dark values held
constant when the theme flips.

**This is the one place the scan flow does not follow the theme, and it is deliberate.**
The chrome *around* the viewfinder is themed; what floats *on* the feed is not. A camera
frame is not a themed surface — its luminance is unknown and changes every frame — so
`--plate`'s light override (near-white, correct over a light page) is unreadable over a
dark kitchen at night, which is the stated primary usage context. Do not add a
`html[data-ledger-theme='light']` override for these four.

A `text-shadow` was tried instead and rejected: it survives a busy backdrop but reads as a
mistake on a plain one, which is presumably why the chart labels use `--plate` rather than
a shadow too.

### 2 · Detection state — shape first, colour second

```css
--detect-searching: var(--fg3);
--detect-found: var(--blue);
--detect-stable: var(--green);
--detect-rejected: var(--yellow);
--detect-w-searching: 1.5px;
--detect-w-found: 2px;
--detect-w-stable: 3px;
--detect-dash-searching: 7 9;
--detect-dash-rejected: 4 4;
```

The brief forbids encoding these in colour alone, and the backdrop is unpredictable
regardless. **The primary signal is stroke weight and dash pattern; colour reinforces.**

| State | Weight | Dash | Corner brackets |
|---|---|---|---|
| Searching | 1.5px | 7 9 | no |
| Detected | 2px | solid | **yes** |
| Stable | 3px | solid | yes |
| Rejected | 2px | 4 4 | no |

Weight climbs and the dash resolves to solid as confidence rises, so the four states are
separable in greyscale. **Rejected dashes tighter than searching** — a different rhythm,
not just a different hue. Brackets appear only when four corners are actually found, which
makes searching → detected two shape changes rather than one.

**A segment thinner than its own border gets no border.** A 1px rect with a 1px stroke
centred on its edges paints a ~2px band at full strength, so a hairline segment can become
the loudest pixels on screen. Rule: clamp to `max(0.8px, raw)` and apply the stroke only
when `raw >= 2.5px`.

### 3 · Safe area

```css
--safe-top: env(safe-area-inset-top, 0px);
--safe-bottom: env(safe-area-inset-bottom, 0px);
--safe-left: env(safe-area-inset-left, 0px);
--safe-right: env(safe-area-inset-right, 0px);
```

The home indicator sits exactly where the shutter wants to be. Every edge control is inset
by the relevant token **plus** its own padding, never by a guessed constant. Left and right
matter too — a landscape phone has insets on the long edges.

### 4 · Touch

```css
--touch-min: 44px;
--shutter-size: 72px;
```

44 is the floor, not the target. **Apply it to every control in the scan flow**, including
ones that inherit `app.css`'s base input layer: that layer's `padding: var(--space-4) 11px`
plus 13px text resolves to 34px, which is right for a desktop form row and 10px short on a
phone. `app.css`'s own comment on `--control-h` says it is applied "where a row needs its
controls to agree — NOT globally", so overriding it here follows the design system's policy
rather than departing from it.

### 5 · Motion

```css
--motion-snap: 90ms;      /* inherited: the button press */
--motion-capture: 700ms;  /* the capture collapse */
--motion-hold: 1500ms;    /* the stability ring */
--motion-settle: 220ms;   /* sheets, mode swaps */
--ease-out: cubic-bezier(0.2, 0, 0.2, 1);
```

The easing is seeded from the one transition the product already has. **Duration does not
transfer, and this took three attempts to get right:**

- 90ms is correct for a 1px tint changing in place. Across the height of the screen it is
  below the threshold at which the eye reads movement at all — the "decisive snap" §10 asks
  for landed as a frame that had simply changed.
- 300ms still read as a flicker on a real phone.
- **700ms** is long enough to follow the page down to the counter, which is the information
  the beat carries, and still ends before you can study it.

`--motion-hold` is the auto-capture window, and the ring's fill must run its full length.
At `--motion-settle` the ring completed in 220ms and then sat full for 1.3s, which made the
shutter look like it fired for its own reasons rather than at the end of something the user
was watching.

### `prefers-reduced-motion`

**Cover transitions, not just animations.**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
  button { transition-duration: 90ms !important; }
}
```

The stability ring is a **transition** on `stroke-dashoffset`, and the brief's §6 names it
specifically as pass/fail. An animation-only override — which is what a first pass
naturally writes — leaves the single motion that matters untouched while correctly
neutralising the searching sweep and the processing spinner.

The `button` line is not an oversight. `app.css` deliberately keeps the 90ms colour change
on a press under this setting, because "the colour change still reports the press, which is
the part that carries the information". A blanket override silently reverses that decision,
so it is re-asserted.

The capture collapse **does** stop under reduced motion, which is correct: a deliberate
snap is precisely what a user enabling this setting is opting out of.

---

## Pass C — the dropzone

### The existing component

`src/lib/components/UploadDropzone.svelte` already has `idle` / `dragging` / `busy` /
`error`, `role="button"` with Enter and Space handling, and an `onfiles` callback returning
an `ActionOutcome`. **Extend it; do not rewrite it.**

### What to add

One camera button, inside the drop region, below a `1px solid var(--bd)` rule.

**The camera button appears when `accept` admits an image type.** `accept` is a prop the
component is already given at every call site, so this stays genuinely one component with
one design — the Settings JSON restore and the `.xlsx` broker report simply never draw a
button for a thing they cannot use. Do not add a second prop for this.

**Stop propagation on the camera button's handler.** It sits inside a clickable region;
without it, tapping the camera also opens the file browser behind it. It is a real
`<button>` and lands next in tab order after the region.

### The three affordances problem

Idle must communicate click-to-browse, drop-a-file, and take-a-photo without becoming a
busy control. The resolution: **three affordances, two things that look pressable.** The
dashed region carries click and drop together — a dashed rule has meant "a file goes here"
for twenty years, and clicking a drop target is what everyone already tries. Only the
camera is drawn as a button, because it is the one affordance a dashed rectangle does not
suggest.

### States

| State | Border | Ground | Copy |
|---|---|---|---|
| Idle | `1.5px dashed var(--bd2)` | transparent | "Drop a file here, or click to browse" + accepted types |
| Drag-active | `1.5px dashed var(--blue)` | `var(--blue-wash)` | "Release to add <filename>" — camera hidden |
| Rejected | `1.5px dashed var(--red)` | `var(--red-wash)` | "That is a .zip — this takes PDF, PNG or JPEG" — camera stays live |
| Busy | `1.5px dashed var(--bd)` | `var(--card)` | existing `busyText` |

Rejected says what the control accepts rather than what the user did wrong, and keeps the
camera offer visible — photographing the page is often the fastest recovery.

### The twelve upload sites

| Site | File | Camera? |
|---|---|---|
| Bank statement import | `routes/(app)/import/+page.svelte` | via `accept` |
| Investments report | `routes/(app)/investments/+page.svelte` | no — `.xlsx` |
| Documents archive | `routes/(app)/documents/+page.svelte` | yes |
| Property document | `routes/(app)/property/+page.svelte` | yes |
| Transaction receipt | `routes/(app)/transactions/+page.svelte` | yes |
| Settings restore | `routes/(app)/settings/+page.svelte` | no — JSON |
| Tax statement | `components/TaxStatementDialog.svelte` | yes |
| Tax year detail | `components/TaxYearDetail.svelte` | yes |
| Payslip | `components/PayslipDialog.svelte` | via `accept` |
| Bulk payslips | `components/BulkPayslipDialog.svelte` | via `accept` |
| Contact photo | `components/ContactForm.svelte` | yes |
| Property image | `components/ImageSlot.svelte` | yes |

Ten of these are raw `<input type="file">` today. Migrating them to `UploadDropzone` is the
bulk of Pass C and is independent of the scan flow — it can ship separately.

---

## Pass B — capture

### Layout

Full-bleed. Three bands over the video:

- **Top bar** — Cancel (left), page count so far (right). Both on `--scan-plate` chips over
  a `--scan-plate-edge` gradient. Nothing here is urgent, because the top of a phone is
  unreachable by the hand holding it.
- **Guidance chip** — centred, one line, fixed `min-height`, above the deck.
- **Control deck** — thumbnail (left), shutter (centre), flash (right), in a
  `1fr auto 1fr` grid, inset by `--safe-*`.

**Thumb reach is a placement rule, not a token.** Nothing the user must reach mid-capture
sits above the bottom third; the way to honour that is positioning the deck from the bottom
edge. A `--thumb-zone` token was drafted and removed — it never appeared in a declaration,
and a token that only appears in a comment is spec pretending to be code.

### The guidance line

One short line, **replaced not stacked**, in a chip with a fixed `min-height` so
"Move closer to the page" and "Too dark — try more light" occupy the same band and nothing
below them moves. **Debounce state changes** or the user gets a strobing instruction they
cannot read.

| State | Copy |
|---|---|
| Searching | Point at the page |
| Detected | Hold steady |
| Stable | Got it — hold still |
| Too blurry | Hold still — that came out blurry |
| Too dark | Too dark — try more light |
| Too small | Move closer to the page |
| Captured | Page 3 saved |

Every line names what the user controls. "Too dark — try more light" tells them what to do
with their free hand; "Insufficient illumination" tells them what the sensor thinks.

### The searching state draws no outline

No page found means there is nothing to outline, and a speculative box is a claim the
detector has not made. A slow vertical sweep says the camera is working without asserting a
result. It is a `@keyframes` animation, so `prefers-reduced-motion` neutralises it.

### The shutter and the stability ring

72px (`--shutter-size`), the one control allowed to exceed the touch floor, with a 56px
inner disc at `calc(var(--shutter-size) - 16px)`.

**Stability is a ring filling, not a number counting down.** A number invites the user to
wait for it; a filling ring invites them to keep still, which is the thing that actually
helps. The fill runs the full `--motion-hold`.

Auto-capture fires at the end of the window. **Any touch anywhere cancels it** — not just a
touch on a control. The shutter's `aria-label` changes to "Capturing now — tap to cancel"
while the ring is filling.

### The collapse — §10's one bold moment

The outline travels inward to the thumbnail's box over `--motion-capture`, then the page
preview opens.

**Two implementation notes, both of which caused visible bugs:**

1. **Only the collapse carries a transition.** With `transition: all` on both directions,
   re-firing sends the plate travelling *back* to the page, and the follow-up frame reverses
   it mid-flight — so every capture after the first shows a few pixels of movement near the
   thumbnail. The reset leg must be `transition: none`.
2. **The rest position must be the thumbnail's own box**, derived from the deck's geometry
   rather than typed as a constant. Nine pixels off reads as a misaligned plate sitting over
   the thing it became.

Sequence: `collapsed: false` → paint → `collapsed: true` (60ms, two frames, not one tick) →
open the preview (900ms).

### Steppy at 8–10 fps, on purpose

The outline is a plain polygon with **no per-frame smoothing**, and nothing about it
improves at 60 fps. The only transitioned property is stroke-width, which changes on a
state boundary rather than every frame — so the appeal survives a slow detector.

### Permission, denied, and no camera

Full-frame, **themed** (not scrimmed — there is no feed behind them), copy anchored to the
bottom for reach.

| State | Title | Body | Primary |
|---|---|---|---|
| Ask | Use the camera to photograph this page? | "…processed on your own server and never leaves it — there is no third party here." | Allow the camera |
| Denied | Continuum cannot reach the camera | Names the padlock, because that is the thing to tap. | Reload and try again |
| No camera | No camera on this device | "Nothing is wrong…" + open on your phone | Open on my phone |

All three keep **"Choose a file instead"** beside the primary, so the task is never blocked.

The Ask state is shown **before** the OS prompt: a raw system dialog with no context gets
denied, and the OS will not re-ask. For a self-hosted product, the sentence that earns the
tap is where the image goes.

**Implementation warning.** These three states draw no outline, so they carry no weight or
dash value. Reading `.replace()` off those undefined values threw a `TypeError` out of the
render function and took the **entire component** down — all three screens rendered nothing
rather than degrading. Guard any per-state lookup that assumes an outline exists.

---

## Pass B/C — page preview

**Two answers, not an editor.** No corner handles, per the product owner's decision.

- **Keep page** is primary, **Replace** is secondary. The shot is usually fine and the flow
  should not make the user confirm that carefully.
- Replace returns to the camera with the page still in the stack. Nothing is lost by trying
  again, which is what makes skipping corner editing safe.
- Rotate is a 44px icon button.

### Mode switcher

`B&W · Grayscale · Colour`, full width, each at `min-height: var(--touch-min)`. **B&W is
the default**: household paper is text on white, it is where OCR reads best and the file is
smallest. Colour is the exception for a stamp, a signature or a chart — so it is last, not
first.

**The mode-switch gap.** Tapping re-processes, so the tap lands instantly and the *page*
catches up under a scrim naming what it is doing ("Cleaning up page 3"). The note under the
switcher has a fixed height so the deck does not jump as the wording changes, and Keep
stays live throughout — the mode can be changed again later.

---

## Pass C — review

### Mixed orientations

**Every tile is the same 3:4 box; the page sits inside it at its own aspect ratio**
(`aspect-ratio: 210/297` or `297/210`, `max-width: 92%`, `max-height: 92%`). A landscape
page therefore cannot make its row taller than the row beside it.

Do not size the paper by percentage pairs — it renders a landscape page at roughly 1.05,
essentially square, while the layout claims 1.414. Do not reflow the grid into a single
column on narrow screens; that recreates the scrolling list this design removes.

### Page order is the document

One PDF means the order of the tiles **is** the order of the pages — getting it wrong is
not a display preference, it is a wrong document. So moving a page is a first-class action:
**`↑` and `↓` both**, plus `✕`, on their own row, all three at `--touch-min`.

Up-only at 30px was the first attempt and was wrong twice: below the touch floor, and it
takes four taps on *other* tiles to move the first page to the end.

Edge buttons dim to `var(--bd2)` with `cursor: not-allowed` rather than disappearing — a
control that vanishes shifts the two beside it, so the buttons stop landing where the eye
left them. Each page badge carries a grip glyph, since dragging is still the primary
gesture. **Order locks once combining starts.**

### One PDF, and the states that follow from it

| State | Title | Bar | Button |
|---|---|---|---|
| idle | 5 pages · "They will be combined into one PDF" | — | **Upload PDF** |
| combining | Combining · "Building one PDF from 5 pages" | "Cleaning up page 3 of 5" · "then writing the PDF" | Combining into one PDF |
| done | Uploaded · "One PDF · 5 pages · 1.8 MB" | — | Open <filename> |
| failed | Upload stopped · "4 pages sent · no PDF yet" | "Page 5 did not arrive" (red) | Send page 5 and finish |
| empty | No pages yet | — | Take a photo |

**Name the state for the file, not the page count.** "Uploading page 3 of 5" reads as five
separate uploads of five separate files. The per-page work is real — each photograph is
cleaned up and written into the document — so the bar still counts pages, but what it counts
*toward* is one PDF. A tick on a tile means the page is in the document.

Reading the pages and writing the PDF were two states with two chips and two bars in an
earlier draft. To the person holding the phone that is **one wait making one file**.

**A single PDF needs a name.** The review screen is the only moment the user knows what the
document is, so idle carries a `Save as` field using `app.css`'s base input layer plus
`min-height: var(--touch-min)`. The done state's button opens the name they typed.

**One PDF makes partial failure worse, so say so.** Four pages on a server are not a
document. Failed says the four that arrived are *being held rather than filed* — claiming
they were filed is a lie the Documents shelf immediately exposes. It never re-sends what
arrived and never offers to discard the batch. A self-hosted server going down mid-upload is
expected, not exceptional.

---

## Voice

Plain, specific, second person, sentence case. Name what the user controls, never how the
system works.

| Don't | Do |
|---|---|
| No contour detected | Move closer to the page |
| Perspective correction failed | Couldn't find the edges — drag the corners to fix it |
| Processing… | Cleaning up page 2 |
| Submit | Upload PDF |
| Insufficient illumination | Too dark — try more light |

Button labels carry through: **Upload PDF → Combining into one PDF → Uploaded.** Every
label is the same promise at a different stage.

---

## Icons to add to `src/lib/icons.ts`

Six, in the existing style — 24 viewBox, `currentColor`, 1.7 stroke, round caps, authored
as typed primitives (`path` / `circle` / `rect` / `line`), no `{@html}`.

| Name | Where |
|---|---|
| `camera` | dropzone button, permission states |
| `bolt` | flash toggle |
| `rotate` | page preview |
| `grip` | page badge drag handle |
| `check` | uploaded page tile |
| `arrowUp` / `arrowDown` | page reorder (or keep as text glyphs) |

The prototype uses `↑ ↓ ✕ ✓` as text glyphs, which is consistent with the product's
emoji-as-icons convention. Either is defensible; do not mix within one control group.

---

## Quality floor — pass/fail

Each of these is verifiable, and each was checked in the prototype.

- Works down to **360px** wide.
- Visible keyboard focus on every interactive element, dropzone included
  (`:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px }`).
- `prefers-reduced-motion` respected, **including transitions** — see Pass A §5.
- Every state legible without colour vision: detection state is carried by weight, dash and
  brackets before hue.
- Screen-reader labels on all icon-only camera controls.
- **No layout shift** when the guidance line changes length.
- Every control ≥ 44px in the scan flow.

---

## Files

| File | What it is |
|---|---|
| `Continuum Scan Engine.dc.html` | The design. Five tabs, all states togglable, both themes live. |
| `support.js` | Runtime the design file loads. **Must sit beside it** — without it every value renders as a literal `{{ }}` placeholder. Prototype scaffolding; nothing to port. |
| `README.md` | This document. |

## Existing code this touches

| Concern | File |
|---|---|
| Tokens — **extend** | `src/lib/styles/app.css` |
| Dropzone — **extend** | `src/lib/components/UploadDropzone.svelte` |
| Icons — **add six** | `src/lib/icons.ts` |
| Upload sites — migrate | the twelve listed above |
| Primitives — reuse | `src/lib/components/{ScreenHeader,Eyebrow,Segmented}.svelte` |
| Documents shelf — destination | `src/routes/(app)/documents/` |

## Out of scope

- Anything in Continuum outside the file-input control and the scan flow.
- The processed document's visual output — that is algorithmic, not a design choice.
- Onboarding, tooltips, first-run tutorials. If the flow needs explaining, it is wrong.
- Corner adjustment, per the product owner's decision.
