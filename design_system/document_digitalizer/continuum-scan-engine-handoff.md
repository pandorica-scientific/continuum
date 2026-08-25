# Continuum Scan Engine — Engineering Handoff

**Version 5 · final.** Scope is capture → detect → crop/flatten → enhance/standardize → assemble PDF, and nothing else.
**Companion:** the design handoff (`README.md` + `Continuum_Scan_Engine_dc.html`) is authoritative for tokens, copy, states and layout. This document is authoritative for pipeline, data and behaviour.

## Start here

Read in this order, then start on M0.

| If you are… | Read |
|---|---|
| Picking up the whole thing | §1 scope, §2 boundary, §7 where processing runs, §11 milestones |
| Writing pipeline code | **§6.6 first**, then §6.1–6.5 |
| Touching the dropzone | §3, §4 |
| Building the capture UI | design handoff Pass B, then §5, §6.2, §10 |
| Wondering why something is the way it is | §15 decision log |

**Three things that will cost you a week if skipped:** §6.6 (OpenCV memory — the top risk), §9 trap 1 (secure context, or self-hosters get no camera), §3.1 (the upload path's only recovery).

**First commit:** M0. Migrating the ten raw `<input type="file">` sites to `UploadDropzone` ships alone, touches no scan code, and derisks everything after it.

---

## 1. Scope

```
camera or image  →  detect document  →  crop + flatten  →  enhance/standardize  →  assemble PDF
```

That is the whole engine. It produces a `File` and hands it to Continuum's existing upload path.

**Explicitly not in the engine:** OCR, text extraction, searchable-text layers, PDF/A conformance, classification, field extraction, upload, storage, routing, linkage.

**Also not in scope, by earlier decisions:** manual corner adjustment (§8), retention of anything but the final PDF (§2.6).

---

## 2. Boundary and stack

### 2.1 Stack corrections

An early draft assumed React. It is wrong.

| Early draft said | Actual |
|---|---|
| React + Vite, `<DocumentInput>` component | **SvelteKit** — `src/routes/(app)/`, `src/lib/components/*.svelte` |
| New dropzone component | **Extend `src/lib/components/UploadDropzone.svelte`** — already has idle/dragging/busy/error, `role="button"`, Enter/Space, and an `onfiles` callback returning `ActionOutcome` |
| New design tokens | **Extend `src/lib/styles/app.css`** — dark is default, light is opt-in via `html[data-ledger-theme='light']`. `design/no-raw-geometry` lints raw values |
| Icons from a library | **Custom, `src/lib/icons.ts`** — 24 viewBox, `currentColor`, 1.7 stroke, round caps, typed primitives, no `{@html}`, no CDN. Six to add |

### 2.2 Packages

```
packages/
  scan-engine-core/     # isomorphic: types, corner math, param derivation, quality metrics
  scan-engine-client/   # Svelte: camera store, detection loop, warp, enhance, PDF assembly
```

There is no server package — see §7. `scan-engine-client` now owns the whole pipeline.

### 2.3 Services

**None.** No new container. The `ocrmypdf` sidecar is removed with OCR, and the render service is removed with it (§7). `docker-compose.yml` is untouched by this feature.

This is the single largest consequence of dropping OCR, and it is worth stating plainly: OCR was the only step that genuinely needed a server. Everything else runs in the browser.

### 2.4 The engine produces a `File`

```
camera / dropped image
        │
        ▼
   scan engine  ── detect · crop · flatten · enhance · assemble
        │
        ▼
   File("Nájemní smlouva.pdf", application/pdf)
        │
        ▼
   UploadDropzone.onfiles([file])     ← existing Continuum logic, unchanged
        │
        ▼
   whatever that call site already does
```

**The engine has no opinion about destination.** A transaction receipt lands wherever the transaction page already puts a dropped PDF. Consequences, all simplifications:

- **No `destination` parameter.** Nowhere.
- **No new callback.** The scan path calls the existing `onfiles([pdfFile])`. Every call site works unchanged the moment the camera button appears.
- **No documentId, no url, no linkage.**
- The engine cannot report upload success, because it does not upload — see §7.3.

### 2.5 What the engine is not

Not a document store. Not an upload client. Not an OCR pipeline. Not aware of Continuum's data model. It should lift into another app with only the token names changing.

### 2.6 Retention: the PDF only

| Artifact | Lifetime |
|---|---|
| Camera frame / dropped image | client memory, revoked once the page renders |
| Corners, mode, rotation | in-memory session state, discarded with it |
| Warped/enhanced page bitmap | encoded to a blob, source freed immediately |
| **Final PDF** | handed to Continuum as a `File` |

With the pipeline client-side, retention becomes trivially enforceable: nothing is ever written to disk, so there is nothing to sweep. No tmpfs, no expiry timer, no scratch directory. The strongest version of the guarantee, for free.

Client-side hygiene still matters: `bitmap.close()` and `URL.revokeObjectURL()` per page as soon as it renders. Do not hold full-res sources for the session.

**Two things this forecloses, deliberately:**

1. **Mode is final at render time.** No switching to colour later — the source is gone. The mode switcher on the page preview is the only chance, so it must be obvious and preview accurately.
2. **No reprocessing of any kind.** If a page comes out badly the fix is re-photographing it.

---

## 3. Both paths go through the pipeline

A dropped image is treated exactly like a photographed one. Same detection, same rectification, same enhancement, same PDF.

```
dropped file
     │
     ├── application/pdf ─────────────► straight to onfiles, no pipeline
     │
     └── image/* ──► detect ──► page preview ──► render ──► PDF ──► onfiles
```

- **PDFs pass through untouched.** Only `image/*` enters the pipeline.
- **Multiple dropped images become one PDF**, in drop order, reorderable on the review screen.
- Same review screen for both paths.

### 3.1 The upload path needs its own escape hatch

On the camera path a bad detection is recoverable: **Replace** returns to the viewfinder with the stack intact, and re-shooting beats dragging four handles on a phone. That is what makes cutting corner editing safe.

On the upload path there is no viewfinder. No corners to drag, no camera to retake with, and a file that came from the gallery. **The recovery is nothing.**

Minimal fix, in the spirit of the design's two-answers-not-an-editor principle:

- **Add `original` as a fourth mode**: `B&W · Grayscale · Colour · Original`. Skips rectification entirely; EXIF rotation only.
- **`Replace` becomes `Choose another file`** on the upload path — same slot, same weight, different verb.

Two taps of recovery, no new interaction model, no handles. Also useful on the camera path when someone photographs something that is not a page.

If `original` gets used often in practice, that is evidence the corner-editing decision needs revisiting for uploads.

---

## 4. Dropzone integration

Extend, do not rewrite.

```svelte
<UploadDropzone
  accept="image/*,application/pdf"
  multiple
  busyText="Uploading"
  onfiles={(files) => ActionOutcome}   <!-- scan results arrive here too -->
/>
```

**The camera button renders when `accept` admits an image type.** No new prop — every call site already passes `accept`, so Settings JSON restore and the `.xlsx` broker report never draw one.

**Stop propagation on the camera button's click handler.** It sits inside a clickable region; without it, tapping the camera also opens the file browser behind it. It is a real `<button>`, next in tab order after the region.

### Twelve upload sites

Ten are raw `<input type="file">` today. Migrating them to `UploadDropzone` **ships independently** — do it first, it derisks everything after.

| Site | File | Camera |
|---|---|---|
| Bank statement import | `routes/(app)/import/+page.svelte` | via `accept` |
| Investments report | `routes/(app)/investments/+page.svelte` | no (`.xlsx`) |
| Documents archive | `routes/(app)/documents/+page.svelte` | yes |
| Property document | `routes/(app)/property/+page.svelte` | yes |
| Transaction receipt | `routes/(app)/transactions/+page.svelte` | yes |
| Settings restore | `routes/(app)/settings/+page.svelte` | no (JSON) |
| Tax statement | `components/TaxStatementDialog.svelte` | yes |
| Tax year detail | `components/TaxYearDetail.svelte` | yes |
| Payslip | `components/PayslipDialog.svelte` | via `accept` |
| Bulk payslips | `components/BulkPayslipDialog.svelte` | via `accept` |
| Contact photo | `components/ContactForm.svelte` | yes |
| Property image | `components/ImageSlot.svelte` | yes |

**Contact photo and property image are not documents.** With every dropped image entering the pipeline, these two would binarize a portrait or a photo of a house. They need `scan={false}`. This is the one place a second prop is justified; see §12 q1.

---

## 5. Data model

```ts
type Point = { x: number; y: number };
type Corners = { tl: Point; tr: Point; br: Point; bl: Point };  // ORIGINAL image px

type PageMode = 'bw' | 'grayscale' | 'color' | 'original';
type PageSource = 'camera' | 'upload';

type DetectState =
  | { kind: 'searching' }
  | { kind: 'detected';  corners: Corners }
  | { kind: 'stable';    corners: Corners }
  | { kind: 'rejected';  corners: Corners | null;
      reason: 'blurry' | 'dark' | 'small' };

interface ScanPage {
  id: string;
  source: PageSource;
  corners: Corners | null;        // null = detection failed, use full frame
  rotation: 0 | 90 | 180 | 270;
  mode: PageMode;
  rendered: Blob | null;          // encoded page, ready for pdf-lib
  previewUrl: string;             // object URL onto `rendered`
}

interface ScanSession {
  id: string;
  pages: ScanPage[];
  filename: string;               // from the review screen's "Save as"
  createdAt: string;
}
```

`original: Blob` and `sendState` are gone. Each page is rendered once, right after capture, and only the encoded result is kept — which is both the retention guarantee and the memory strategy.

`DetectState` is what the detection loop returns each frame; the design's four outline states map to it one-to-one and `reason` selects the guidance line.

**Guard every per-state lookup.** The permission, denied and no-camera screens carry no outline and therefore no weight or dash value — reading `.replace()` off `undefined` took the whole prototype component down rather than degrading.

---

## 6. Pipeline

### 6.1 Capture

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: { ideal: 'environment' },
           width: { ideal: 3840 }, height: { ideal: 2160 } },
});
```

Prefer `ImageCapture.takePhoto()` for the still — sensor resolution, not the video track's. Fall back to `drawImage(video)` on Safari, which still lacks it.

**Flash / torch.**

```ts
const caps = track.getCapabilities();
if (caps.torch) await track.applyConstraints({ advanced: [{ torch: true }] });
```

Chrome-on-Android only. **Not supported in iOS Safari at all** — no polyfill. Hide the control when `caps.torch` is absent rather than disabling it, or half your users get a dead button in the one band they can actually reach.

### 6.2 Detection (client, live)

- Downscale each frame to **640 px wide** before detecting. Detecting on a 4 K canvas at 10 fps is a slideshow on mid-range Android.
- `jscanify.findPaperContour()` → `getCornerPoints()` → scale corners back up.
- Throttle to ~8–10 fps with `requestAnimationFrame` + a timestamp gate. Not `setInterval` — it queues work the main thread cannot drain.

On the upload path, run detection **once** on the dropped image. No loop, no quality gates — the photo is what it is, and rejecting it helps nobody when there is no retake.

**Quality gates** (camera path only), measured on the downscaled frame:

| Gate | Metric | Fails to |
|---|---|---|
| Sharpness | variance of Laplacian on the ROI | `rejected: 'blurry'` |
| Exposure | mean luminance of ROI < ~40/255 | `rejected: 'dark'` |
| Framing | contour area < 25% of frame | `rejected: 'small'` |

**Stability, reconciled with the design.** An earlier draft said six consecutive stable frames; the design says the ring fills for `--motion-hold` (1500 ms). Both in sequence is ~2.2 s of holding still — too long.

Settle on: **3 consecutive frames** with all corners moved < 2% of frame width (≈350 ms at 9 fps) to enter `stable`, then the 1500 ms ring, then fire. Total ≈1.85 s. The ring is a plain timer, not a continuous confidence value — simpler, and it matches "the fill runs its full length."

**Any touch anywhere cancels the pending capture** — a `pointerdown` listener on the capture root, capture phase, not just on controls. While the ring fills, the shutter's `aria-label` becomes "Capturing now — tap to cancel".

**Debounce guidance transitions** (~400 ms) or the user gets a strobing instruction they cannot read.

### 6.3 Crop and flatten

Derive output dimensions from the corners; never hardcode:

```
wTop  = |tr - tl|,  wBottom = |br - bl|
hLeft = |bl - tl|,  hRight  = |br - tr|
outW  = max(wTop, wBottom)
outH  = max(hLeft, hRight)
```

Snap to A4 (1:√2) when within ~4% — almost everything scanned in CZ/PL is A4. Clamp `outW` to ≤ 2480 px (A4 @ 300 DPI); beyond that you are storing lens noise.

`cv.getPerspectiveTransform` → `cv.warpPerspective(..., INTER_CUBIC)`.

**When `corners` is null, or mode is `original`, use the full frame.** With corner editing cut this is the only fallback — it must produce something usable rather than throwing.

### 6.4 Enhance / standardize

**`original`** — EXIF rotation only. No warp, no enhancement. The escape hatch from §3.1.

**`color`** — CLAHE on the L channel of LAB (`clipLimit 2.0`, `tileGridSize 8×8`). Fixes uneven room lighting without the plastic look of global normalisation.

**`grayscale`** — desaturate, then the shadow-removal divide:
```
bg     = GaussianBlur(gray, sigma ≈ outW / 60)
result = clamp(gray / bg * 255)
```
Kills gradients from a desk lamp or a hand shadow in one pass. No model needed.

**`bw`** (default) — the divide above, then:
```
adaptiveThreshold(GAUSSIAN_C, blockSize = odd(outW / 100), C = 10)
```
`blockSize` **must** scale with resolution or the same page binarizes differently at 1000 px and 2500 px. Follow with a 2×2 morphological open to drop speckle.

**Budget note.** The Gaussian blur at `sigma ≈ 40` on an 8.7 MP image is the expensive step — roughly 1–2 s on a mid-range phone, and it dominates everything else in the pipeline. Two mitigations, both worth doing: compute the background at 1/4 scale and upsample it (visually identical for a low-frequency illumination field, ~16× cheaper), and run the render **per page immediately after capture**, while the user is looking at the preview, rather than batching at the end. Done this way the work is invisible.

### 6.5 Assemble PDF

`pdf-lib`, one A4 page per scan page, image fitted with margins, `setTitle(session.filename)`.

**Set DPI implicitly and correctly**: a 2480 px image drawn across a 210 mm page is 300 DPI. Nothing downstream reads a DPI tag any more, but getting the draw box right is still what determines whether the page looks like a scan or a photo pasted onto A4.

**Encoding, now that OCRmyPDF is gone.** It was doing three jobs — OCR, PDF/A, and compression. Only the third one is missed:

| Mode | Encoding | Typical A4 @ 300 DPI |
|---|---|---|
| `color`, `grayscale`, `original` | JPEG q85 | 250–600 KB |
| `bw` | **1-bit PNG (deflate)** | 60–120 KB |

1-bit PNG is the pragmatic choice: pure `pdf-lib`, no external binary, no WASM codec. It is 2–4× larger than JBIG2 but still small, and it is lossless — which matters more for text than the extra saving does.

**If page size becomes a real complaint**, the upgrade is CCITT Group 4, which is a native PDF filter (`CCITTFaxDecode`) and needs no decoder on the reading side. Encode the bilevel page as a G4 TIFF, lift the strip data out, and embed it as an image XObject via `pdf-lib`'s low-level API. Gets you to 20–50 KB per page. It is maybe a day of work and entirely optional — do not do it in v1.

**Output is a plain PDF, not PDF/A.** PDF/A conformance needs XMP metadata, an OutputIntent, and an embedded ICC profile; `pdf-lib` can do it but it is fiddly, and nothing in a household ledger requires archival conformance. See §12 q2 if you disagree.

### 6.6 OpenCV memory discipline — read before writing pipeline code

#### Why `Mat` is different from every other JS object

`opencv.js` is OpenCV's C++ compiled to WebAssembly by Emscripten. A `cv.Mat` is **not** a JavaScript object that happens to hold pixels. It is a small JS handle — a few dozen bytes, holding an integer pointer — that refers to a buffer inside the **WASM linear heap**, which is a single `ArrayBuffer` the JS garbage collector cannot see into.

So when a `Mat` goes out of scope in JS:

```js
function detect(frame) {
  const src = cv.imread(frame);      // 33 MB allocated in WASM heap
  const gray = new cv.Mat();          // …
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  return findCorners(gray);
}                                     // ← JS frees ~80 bytes of handles.
                                      //   The 33 MB is still allocated. Forever.
```

The GC collects the handles and reclaims nothing that matters. There is no finalizer, no destructor, no `WeakRef` hook that runs. **`.delete()` is the only thing that frees the buffer**, and it is a manual call — this is C++ ownership semantics wearing a JavaScript costume.

#### Why it fails hard rather than gracefully

The Emscripten heap **grows and never shrinks**. Every leak permanently raises the floor. When it cannot grow further you do not get a catchable JS error in a useful place — you get `RuntimeError: Aborted(OOM)` or a memory-growth failure from deep inside the WASM module, usually mid-frame, and the tab dies. There is no degraded mode.

#### The numbers, for this pipeline specifically

`Mat` size is `width × height × channels × bytes-per-channel`. No compression, ever.

**Detection loop**, per frame at 640×360 RGBA (≈0.9 MB per RGBA Mat):

| Allocation | Size |
|---|---|
| `src` (RGBA) | 0.9 MB |
| `gray` | 0.23 MB |
| `blurred` | 0.23 MB |
| `edges` | 0.23 MB |
| `contours` (`MatVector`) + each contour inside it | ~0.1 MB |
| `hierarchy` | small |
| **per frame** | **≈1.7 MB** |

At 9 fps that is **~15 MB/s leaked**. A phone tab with ~1 GB of headroom dies in about a minute of pointing the camera at a table. On desktop it survives longer, which is exactly why this passes local testing and fails on the device that matters.

**Page render**, per page at full resolution — the newer risk, since an earlier draft had this on the server:

| Allocation | Size |
|---|---|
| `src` 12 MP RGBA | 48 MB |
| `warped` 2480×3508 RGBA | 35 MB |
| `gray` | 8.7 MB |
| `bg` (blurred background) | 8.7 MB |
| `divided` | 8.7 MB |
| `binary` | 8.7 MB |
| **per page** | **≈118 MB** |

Leak one page's worth and the second page has no room. This is not a slow drip; it is one missed `.delete()` away from a crash on page two.

#### The pattern to use

Do not scatter `.delete()` calls and hope. Use an arena that frees everything on the way out, including on the exception path:

```ts
type Arena = {
  <T extends { delete(): void }>(m: T): T;   // track and return
  release<T>(m: T): T;                        // hand ownership back to the caller
};

export function withMats<T>(fn: (keep: Arena) => T): T {
  const tracked = new Set<{ delete(): void }>();
  const keep = (<M extends { delete(): void }>(m: M) => { tracked.add(m); return m; }) as Arena;
  keep.release = (m: any) => { tracked.delete(m); return m; };

  try {
    return fn(keep);
  } finally {
    for (const m of tracked) { try { m.delete(); } catch { /* already gone */ } }
  }
}
```

Used:

```ts
const corners = withMats((keep) => {
  const src  = keep(cv.imread(canvas));
  const gray = keep(new cv.Mat());
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const contours  = keep(new cv.MatVector());
  const hierarchy = keep(new cv.Mat());
  cv.findContours(gray, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  for (let i = 0; i < contours.size(); i++) {
    const c = keep(contours.get(i));   // ← each one is its own Mat
    // …
  }
  return cornersFrom(/* … */);          // plain JS numbers, nothing to free
});
```

Four rules that cover every bug in this class:

1. **Every `cv.*` object that has `.delete()` goes through `keep()` at the moment it is created** — same expression, never a line later. `Mat`, `MatVector`, `Rect`-vectors. Plain `cv.Size` and `cv.Point` are JS objects and need nothing.
2. **`contours.get(i)` returns a new `Mat` each call.** Deleting the `MatVector` does not free them. This is the most commonly missed one.
3. **Return plain data, never a `Mat`.** If a function must hand a `Mat` outward, use `keep.release()` so ownership transfer is explicit and greppable.
4. **Never `await` inside `withMats`.** An interleaved frame can allocate against a heap the arena is about to unwind, and the ordering becomes untestable. Do async work outside; hold only numbers across the boundary.

#### Catching regressions automatically

The heap size is readable, so leaks are a unit test rather than a bug report:

```ts
const heap = () => cv.wasmMemory?.buffer.byteLength ?? cv.HEAPU8.buffer.byteLength;

// warm up first — the first few frames legitimately grow the heap
for (let i = 0; i < 10; i++) detectOnce(fixture);
const before = heap();
for (let i = 0; i < 200; i++) detectOnce(fixture);
expect(heap()).toBe(before);        // exact, not approximate
```

Run it in CI against a fixture image, for both the detection path and a full page render. It is the cheapest insurance in the project.

#### On jscanify — a reversal from v1

The first research pass recommended jscanify as the detection layer. For this engine, **use it as a reference implementation and own the code instead.**

Three reasons, and the third is the decisive one:

- `findPaperContour()` and `getCornerPoints()` return `Mat`s the caller must free, and the convenience wrappers (`highlightPaper`, `extractPaper`) allocate internally. Auditing someone else's allocation discipline every time you upgrade is worse than owning ~120 lines.
- The engine needs things jscanify does not expose: the three quality gates (§6.2), corner rescaling from the downscaled detection frame, and `original` mode bypassing the warp.
- Detection is genuinely small — `cvtColor` → `GaussianBlur` → `Canny`/`threshold` → `findContours` → largest-area → `approxPolyDP` → order the four points. Wrapping a library to get at those six calls, while fighting its memory model, is more work than writing them.

The 30 MB npm package also disappears from the bundle, which matters when `opencv.js` itself is already 8–10 MB.

---

## 7. Where processing runs

**Everything runs in the browser. There is no render service and no scan API.**

An earlier draft had a session API, per-page uploads, SSE progress, tmpfs scratch, and a partial-failure recovery flow. All of it existed because OCR needed a server. With OCR gone, so does the reason.

What runs client-side, and what it costs on a mid-range phone:

| Step | Where | Cost |
|---|---|---|
| Detection | opencv.js WASM, 640 px | ~30 ms/frame |
| Warp | opencv.js WASM, to ≤2480 px | ~300 ms |
| Enhance | opencv.js WASM | ~600 ms with the 1/4-scale blur |
| Encode | canvas → PNG/JPEG blob | ~200 ms |
| Assemble | `pdf-lib` | ~100 ms for 10 pages |

Roughly **1 s per page**, paid while the user looks at the preview, plus a fraction of a second at the end. Memory stays bounded because each page is encoded and its source freed before the next capture.

### 7.1 What this removes

The session API, the per-page upload endpoints, the SSE channel, the progress event schema, the tmpfs volume, the 1-hour expiry sweep, the partial-failure recovery flow, the `scan-render` container, and the `ocrmypdf` container. Roughly 60% of the backend surface an earlier draft carried, and the entire reason `docker-compose.yml` needed touching.

### 7.2 What it costs

- **A very old phone may struggle** on a long session. Mitigation: cap at ~20 pages and say so. If it OOMs, the user retries with fewer — no data is on a server to reconcile.
- **No progress bar worth the name.** Per-page work is ~1 s and already absorbed by the preview; assembly is ~100 ms. The design's *"Cleaning up page 3 of 5"* bar becomes a brief flash. That is a design change, not a bug — see §12 q3.
- **Desktop drag-and-drop of ten 12 MP images** does the same work in one burst rather than spread across captures. Render each on drop, not on Upload, and it stays smooth.

### 7.3 The seam: render finishes, upload begins

The engine hands a `File` to `onfiles`; Continuum then uploads with its own busy state. Two progress states in sequence:

```
[ engine ]     Combining · brief
                    ↓  File handed over
[ Continuum ]  UploadDropzone busy · "Uploading"
                    ↓
                  done
```

Client-side rendering makes the first state so short that the honest-two-states option is clearly right: **button reads "Make the PDF"**, review screen closes on success, the dropzone's existing busy state takes over. The design's *"Upload PDF → Combining into one PDF → Uploaded"* chain assumed a long server-side render worth narrating. It is not that any more.

Failure copy splits cleanly too: the engine can only fail at *"couldn't build the PDF"*, and everything after is Continuum's existing upload error path, unchanged.

---

## 8. The corner-editing decision

The product owner cut manual corner adjustment. Early analysis called it first-class and estimated it as the fallback for roughly a fifth of real captures.

**Defensible on the camera path.** Replace returns to the viewfinder with the stack intact; re-shooting beats dragging four handles on a phone.

Four conditions make it safe. Build all four:

1. **`corners: null` degrades to the full frame**, not to an error.
2. **Replace is one tap and does not lose the stack.** This is the entire safety net; it cannot regress.
3. **Rejection guidance is specific enough to act on.** "Move closer to the page" turns a second attempt into a better one rather than an identical one.
4. **`original` mode exists** — §3.1. Without it the upload path has no recovery at all, and it now handles every dropped image.

**Copy inconsistency to fix:** the design handoff's Voice table still lists *"Couldn't find the edges — drag the corners to fix it"*. There are no corners to drag. Suggest *"Couldn't find the edges — try Original, or replace this page."*

---

## 9. Known traps

Ordered by how much time each costs if discovered late.

1. **`getUserMedia` requires a secure context.** A self-hosted Continuum at `http://192.168.1.50:3000` gets no camera, ever. Ship both mitigations:
   - Document a TLS reverse proxy (Caddy: three lines).
   - Fall back to `<input type="file" accept="image/*" capture="environment">`, which opens the native camera app and **does not require a secure context**. The result flows down the upload path, which runs the same pipeline — so the fallback produces the same PDF, just without the viewfinder.

   The design's "No camera on this device" state is the right shell, but its copy assumes no hardware. A fourth state is needed: *camera exists, this origin is not secure* — recovery is the native camera app, not "open on my phone".

2. **OpenCV.js memory.** The single highest-risk item in this document, and the one most likely to look fine in testing and crash on a real ten-page session. Full treatment in **§6.6** — read it before writing any pipeline code.

3. **HEIC — bundle a WASM decoder.** iPhones shoot HEIC by default and the upload path now runs the pipeline on dropped files, so this is a real share of input. With no server there is no `sharp`; Safari decodes HEIC natively, Chrome and Firefox do not.

   Use **`libheif-js`** (Emscripten build of libheif, LGPL, ships its own `.wasm`). Ship it self-hosted like `opencv.js` — no CDN.

   ```ts
   // lazy: only when a HEIC actually arrives
   const { default: libheif } = await import('libheif-js');
   ```

   Four implementation notes, each of which will otherwise cost an afternoon:

   - **Sniff, do not trust the MIME type.** Safari and several Android file pickers hand over HEIC with an empty or wrong `File.type`. Check the magic bytes: `ftypheic`, `ftypheix`, `ftypmif1` or `ftypmsf1` at byte offset 4. Fall back to the `.heic` / `.heif` extension.
   - **Skip the decoder where it is not needed.** Try `createImageBitmap(file)` first — on Safari it succeeds natively and you avoid loading 1.5 MB of WASM for nothing.
   - **A HEIC file can contain multiple images** (bursts, Live Photo stills). Take the primary item, not `images[0]` blindly.
   - **Second WASM heap, same discipline.** libheif is Emscripten too. Decode straight into an `ImageData`, then free the decoder's handles — see §6.6. Do not keep the libheif module alive between files; instantiate, decode, discard.

   Also unresolved by the decoder: **HEIC carries EXIF orientation** and libheif does not apply it. Read and apply it yourself, same path as trap 4.

4. **EXIF orientation.** Canvas `drawImage` ignores EXIF. Read the orientation tag yourself and apply it before anything else, or every portrait photo from certain Androids lands sideways. This is also the whole of `original` mode's processing, so it has to be right.

5. **opencv.js is ~8–10 MB of WASM.** Lazy-load only when the scanner opens; cache in the service worker; **self-host it**. A `docs.opencv.org` CDN dependency in a self-hosted app is a contradiction, and the product already refuses CDNs for icons.

6. **Mobile memory.** A 12 MP `ImageBitmap` plus two canvases is ~150 MB. Render each page immediately, encode to a blob, free the source. Never hold more than one full-res image at a time.

7. **iOS Safari in installed-PWA mode.** `getUserMedia` has been broken across several iOS versions. Test on a real installed instance, not mobile Safari.

8. **Detection fails on white-on-white.** jscanify needs a contrasting background. Recovery is Replace or `original` — which makes §8's conditions load-bearing.

9. **The capture collapse is one-directional.** `transition: all` on both legs sends the plate travelling *back* to the page and the next frame reverses it mid-flight, so every capture after the first shows a few pixels of drift near the thumbnail. The reset leg must be `transition: none`. Sequence: `collapsed:false` → paint → `collapsed:true` (two frames, ~60 ms, not one tick) → open preview at 900 ms.

10. **Hairline strokes.** A segment thinner than its own border paints a ~2 px band at full strength and becomes the loudest pixels on screen. Clamp to `max(0.8px, raw)`; apply the stroke only when `raw >= 2.5px`.

---

## 10. Token contract

The design adds five axes to `app.css`. The client consumes them; never hardcode.

| Group | Tokens |
|---|---|
| Scrim (pinned across themes) | `--scan-plate`, `--scan-plate-edge`, `--scan-ink`, `--scan-ink-2` |
| Detection | `--detect-{searching,found,stable,rejected}`, `--detect-w-{searching,found,stable}`, `--detect-dash-{searching,rejected}` |
| Safe area | `--safe-{top,bottom,left,right}` |
| Touch | `--touch-min` (44px), `--shutter-size` (72px) |
| Motion | `--motion-{snap,capture,hold,settle}`, `--ease-out` |

Two things the code must not undo:

- **The four scrim tokens get no light-theme override.** Pinned deliberately — a camera frame is not a themed surface. Adding a `data-ledger-theme='light'` rule makes overlay text unreadable at night, which is the primary usage context.
- **`prefers-reduced-motion` must neutralise transitions, not only animations.** The stability ring is a `stroke-dashoffset` transition and is named pass/fail in the quality floor. An animation-only override — what a first pass naturally writes — leaves exactly the one motion that matters untouched. Re-assert the 90 ms button press inside the block; `app.css` keeps it deliberately.

Apply `--touch-min` to every control in the scan flow, including ones inheriting the base input layer — that layer resolves to 34 px, right for a desktop form row and 10 px short on a phone.

The mode switcher now has four segments. At 360 px with `--touch-min` height, `B&W · Grayscale · Colour · Original` is tight — check it wraps or abbreviates cleanly before committing to the label set.

---

## 11. Milestones

| | Scope | Exit criterion |
|---|---|---|
| **M0** | Migrate the ten raw `<input type="file">` sites to `UploadDropzone` | No regression; ships alone |
| **M1** | `scan-engine-core` + headless pipeline: own detection (§6.6), warp, enhance, `pdf-lib` assembly, arena helper + heap-stability test | Three JPEGs in, one PDF out, in a browser, no UI; heap flat over 200 iterations |
| **M2** | Pass A tokens + six icons + camera button in the dropzone | Button renders only where `accept` admits images |
| **M3** | Capture UI: detection loop, four states, quality gates, stability ring, collapse, permission screens | A photographed A4 page reaches `onfiles` as a one-page PDF |
| **M4** | Upload path through the pipeline, `original` mode, HEIC decode via libheif-js, page preview, mode switcher | A dropped gallery photo produces the same artifact as a capture |
| **M5** | Review screen, reorder, `Save as`, multi-page assembly | Ten-page mixed-orientation document in one PDF |
| **M6** | Auto-capture tuning, torch, `<input capture>` fallback, memory audit | Works on a self-hosted plain-HTTP instance; 20 pages on a mid-range Android without a crash |

M1 is now a headless browser module with no server and no UI, testable from a single HTML harness. That is a much better first milestone than a container would have been.

---

## 12. Open questions

1. **Contact photo and property image** — suppress the camera button (`scan={false}`), or run them through a no-pipeline capture? Every dropped image now enters the pipeline, so leaving them alone means a binarized portrait.
2. **PDF/A, or plain PDF?** This document assumes plain. PDF/A was free while OCRmyPDF was in the stack and is now real work. Nothing in a household ledger obviously needs archival conformance, but tax documents are the one plausible case.
3. **The design's progress bar.** *"Cleaning up page 3 of 5 · then writing the PDF"* was written for a server render. Client-side it is a ~1 s flash. Cut it, or keep a minimal state so the transition is not abrupt?
4. **TypeScript?** `src/lib/icons.ts` says yes for at least part of the codebase. Determines whether `scan-engine-core` ships types or JSDoc.

---

## 13. Deferred

**OCR.** Removed from the engine by decision, and the seam is clean: the engine emits a normal PDF, so if Continuum later wants searchable text it runs OCRmyPDF over the stored file as a post-upload step — outside this engine, on the server, where it belongs. Nothing here forecloses that. Worth noting the one cost: reprocessing needs the stored PDF's images, which are binarized and already discarded at source quality, so OCR accuracy would be whatever the B&W render supports. That is normally fine for text.

**CCITT G4 encoding.** §6.5. Cuts binarized pages from ~90 KB to ~30 KB. A day of work, entirely optional.

**ML dewarping (DocRes / UVDoc).** Perspective warp assumes a flat page. Curled paper, book spines and crumpled receipts will look wrong, and jscanify will often miss them entirely. A poorer fit than ever: it needs a Python runtime and ~1 GB of image and weights, in a feature whose whole architecture is now zero new containers. If `original` mode usage turns out high, reconsider — but reconsider a better client-side detector first.

**Commercial SDKs (Scanbot/Apryse, Dynamsoft).** Evaluated and rejected. They sell the scanning *UX* — auto-capture, guidance, quality analysis — real work, but M3 and M6, not the hard part. Enterprise annual licensing priced per web domain is not defensible for a self-hosted household tool.

---

## 14. Acceptance criteria

- Every file input in Continuum offers upload, drag-and-drop and, where `accept` admits images, scan.
- The drop area responds to click and to keyboard activation; the camera button does not trigger the file browser behind it.
- **A dropped image and a photographed page produce the same artifact** — one PDF, same processing.
- A photo of an A4 page in normal indoor light yields a rectified, legible B&W page with no manual correction.
- Failed detection produces a full-frame page, never an error; `original` mode is reachable in one tap from the page preview.
- **The engine calls `onfiles` with one `File` and touches nothing else.** No call site's logic changes; `docker-compose.yml` is unmodified.
- **Nothing is ever written to disk by the engine** — no scratch, no temp files, no server round-trip.
- **The WASM heap is flat** across 200 detection frames and across a ten-page render, verified in CI (§6.6).
- A HEIC dropped from an iPhone produces the same artifact as a JPEG, on Chrome and Firefox as well as Safari.
- Ten-page sessions work on a mid-range Android without a tab crash; twenty pages is the documented cap.
- Output is one PDF, titled with the user's `Save as` name, under ~150 KB per binarized page.
- The scan path degrades to `<input capture>` on non-secure origins rather than disappearing.
- `prefers-reduced-motion` neutralises the stability ring, the searching sweep and the capture collapse — and preserves the 90 ms button press.

---

## 15. Decision log

Why the engine looks the way it does. Each line is a product-owner decision or its direct consequence.

| # | Decision | Consequence |
|---|---|---|
| 1 | **The engine's job ends at the PDF.** It emits a `File` into the existing `onfiles`; Continuum owns destination, storage and linkage. | No `destination` param, no new callback, no `documentId`. Zero call-site logic changes. §2.4 |
| 2 | **No OCR.** Not in this engine, in any form. | `ocrmypdf` gone — and with it the only step that needed a server. §13 keeps the seam open for Continuum to OCR the stored PDF later. |
| 3 | **Everything runs client-side.** Follows from 2. | No new containers, no session API, no SSE, no tmpfs, no partial-failure flow. `docker-compose.yml` untouched. §7 |
| 4 | **Nothing but the final PDF is retained.** | Trivially enforceable once client-side — nothing is written to disk. Forecloses changing mode later and any reprocessing. §2.6 |
| 5 | **Dropped images go through the same pipeline as captures.** | One artifact shape from both routes. Creates the upload path's recovery hole → `original` mode. §3 |
| 6 | **No manual corner adjustment.** | Safe on the camera path (Replace + re-shoot). Needs four conditions to stay safe, `original` mode being the fourth. §8 |
| 7 | **`original` added as a fourth mode.** Consequence of 5 + 6. | Mode switcher is four segments, not three — check it at 360 px. §3.1, §10 |
| 8 | **HEIC decoded in-browser via `libheif-js`.** Consequence of 3. | Self-hosted, lazy-loaded, native-first on Safari. §9 trap 3 |
| 9 | **Own the detection code; jscanify is reference only.** | ~120 lines of OpenCV, full control of memory discipline and quality gates, 30 MB off the bundle. §6.6 |
| 10 | **Plain PDF, not PDF/A.** Consequence of 2. | PDF/A was free inside OCRmyPDF and is real work without it. Open — §12 q2. |

## 16. Deltas to send back to design

Four items where this document diverges from the design handoff. All small; none change Pass A or the capture screen.

1. **Mode switcher gains a fourth segment** — `B&W · Grayscale · Colour · Original`. Needed as the upload path's only recovery (§3.1). Tight at 360 px with a 44 px floor; may need abbreviation.
2. **`Replace` becomes `Choose another file`** on the upload path. Same slot, same weight, different verb — there is no viewfinder to return to.
3. **The review screen's progress bar was written for a server render.** *"Cleaning up page 3 of 5 · then writing the PDF"* is a ~1 s flash client-side, and per-page work is already absorbed by the preview. Suggest the button reads **Make the PDF**, the review screen closes on success, and the dropzone's existing busy state takes over. Costs the *"Upload PDF → Combining → Uploaded"* label chain, which was good copy for an architecture that no longer exists.
4. **Stale copy in the Voice table** — *"Couldn't find the edges — drag the corners to fix it"*. There are no corners to drag. Suggest *"Couldn't find the edges — try Original, or replace this page."*

Also worth adding, though it is new rather than a divergence: a fourth permission-screen variant for **camera exists, but this origin is not secure** (§9 trap 1). The existing "No camera on this device" copy assumes absent hardware; here the recovery is the native camera app, not another device.
