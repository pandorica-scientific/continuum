# Texture segmentation — handoff for v0.6.1

**Goal:** find the page in a photograph where the background is the same
brightness as the paper.

**Companion documents:** `continuum-scan-engine-handoff.md` (the pipeline this
extends) and `README.md` (design authority). Nothing here changes either.

---

## The problem, stated precisely

v0.6.0 segments on **brightness**. Otsu splits the histogram into bright and
dark and treats the bright part as the page. That is a property text does not
disturb, which is why it beat edge detection, and it is why the engine works at
all on nineteen real captures.

It has one failure mode, and every remaining miss is an instance of it: **when
the paper and what it is lying on fall on the same side of the split, the page
has no boundary in the mask, and nothing downstream can find one.** No amount of
refinement helps, because refinement can only tighten a region the segmentation
already proposed.

Measured on the sample set:

| capture | background | Otsu threshold | frame mean luma | outcome |
| --- | --- | --- | --- | --- |
| `n1` | cream wall, in shadow | 163 | 164 | mask keeps 0.68 of its own hull; crop follows the page on two sides and runs into the wall on the third |
| `m2` | pale wall + a second sheet | 119 | 142 | page merges with wall and sheet; no crop |
| `m4` | cream desk | 151 | 140 | page reduced to a 0.15 sliver at solidity 0.64; no crop |
| `n2`, `m1`, `m6` | pale mottled fabric | — | — | recovered in v0.6.0 by the second reading, but marginally — these are the same class and the nearest to tipping back over |

The tell is **inside-versus-outside contrast**, which the engine already
measures: a good capture scores 0.28–0.92, and every capture in this class
scores **0.00 to 0.01**, sometimes negative. There is no brightness difference
to find.

## What has already been tried, and rejected

Do not spend time re-deriving these. All were measured on the same set.

1. **Cutting the mask along Canny edges** so a second sheet separates from the
   page. Left the target capture unchanged *and* destroyed a working
   bent-corner detection. Rejected.
2. **Lowering the contrast floor** so low-contrast edges are admitted. Did not
   rescue `n1`, and made two working captures worse — one quad collapsed from
   41% of the frame to 28%, another went from aspect 1.89 to 2.02. Rejected.
3. **Illumination flattening as a replacement** for the plain reading. Fixed
   the shadowed page (0.68 → 0.92 of its hull) and broke two that were fine
   (0.93 → 0.83). Kept as a *second* reading instead — this is `flattenLighting`
   and `detectBest` in v0.6.0. Not a solution to this class.
4. **The full Dropbox line-first method** — line segments over the whole frame,
   grouped into lines, every two-horizontal × two-vertical quad enumerated and
   scored. Implemented in full (~400 lines) and measured twice. Otsu found a
   page in 10 cases where lines found none; lines won 0. Fixing a real ranking
   bug in it (summed segment length ranks typography above documents, because
   Canny shatters one printed line into dozens of overlapping fragments that
   each contribute their full length — measure **extent along the line**
   instead) made it *worse*, because with honest ranking most frames do not have
   four long lines: `n1` yielded eight horizontals and **zero** verticals.

   The code is kept at `scratch-workspace/v0.6.0/tune/dropbox.ts`. It is worth
   revisiting **only** with a real line-segment detector (LSD or EDLines) rather
   than Canny + probabilistic Hough, and even then it shares the root cause
   below.

**The root cause common to 3 and 4:** on a page whose edge produces almost no
gradient, the edge is not in the evidence. Otsu cannot see it and Hough returns
no line there to enumerate. A different *algorithm* over the same evidence
cannot fix that. It needs **different evidence**.

## The proposal

Paper is **smooth and neutral**. Most things it gets photographed on are
neither. That is evidence brightness throws away, and it is available in every
one of the failing captures:

- `n1` — cream wall: smooth-ish, but a different hue, and the page casts a soft
  shadow along its edge.
- `m2` — pale wall: different hue, and the page has a visible shadow line.
- `m4` — cream desk: neutral but with a fine grain the paper does not have.
- `n2`, `m1`, `m6` — mottled fabric: strongly textured against smooth paper.

Two channels of evidence, either or both:

### A. Saturation

Paper under most lighting is close to neutral; wood, fabric, painted walls and
desks usually are not. Convert to HSV or Lab, and segment on **how far from
neutral** each pixel is rather than how bright. Cheap — one `cvtColor` and one
threshold, the same shape as the existing pipeline.

Watch for: white balance. A phone under warm light casts paper yellow, which
raises its saturation and can invert the test. Estimating and dividing out the
scene's average chroma first is likely necessary — the same trick
`flattenLighting` uses for luminance.

### B. Local texture energy

Paper's local variance is near zero except where there is print. Fabric, wood
grain and carpet have high variance everywhere. Compute local standard
deviation over a small window and threshold it.

Watch for: print. A dense paragraph has high local variance too, so the window
must be large enough that a text block averages out, or the measure must be
taken at a coarse scale (a quarter or eighth resolution, where type disappears
and weave does not). This is the main thing to get right and the reason to
prototype before committing.

## Where it plugs in

`detectBest` in `src/lib/scan/core/detect.ts` is already the extension point,
and was built to be. It currently reads the still two ways and keeps the better
crop:

```ts
const plain = detectOnce(cv, frame, { gates: false, refine: 'thorough' });
const evened = detectOnce(cv, flattenLighting(cv, frame), { gates: false, refine: 'thorough' });
```

A texture reading is a **third** entry in that list. The cleanest shape mirrors
`flattenLighting` exactly: a function that returns a `Frame` whose luminance
encodes the new evidence — high where paper, low where not — so the existing
`detectOnce` runs over it unmodified and the corners come back in the same
coordinate space, directly comparable.

```ts
export function textureContrast(cv: CV, frame: Frame): Frame
```

Everything downstream then works unchanged: segmentation, the solidity floor,
the line search, the winding and skew checks, and the chooser.

**The chooser is already strategy-independent and must stay that way.**
`judgeQuad` scores a candidate from the photograph alone — brightness either
side of each edge, corner squareness, area — and never from the mask that
proposed it. That is deliberate: "these lines sit on the boundary *my*
segmentation drew" is not a claim two segmentations can argue about. Adding a
third reading requires no change to it.

One caveat to check: `judgeQuad`'s contrast term is measured on the grey image,
and the whole point of this work is captures where that term is near zero. A
texture-found quad will therefore score *low* on the one axis carrying the most
weight (0.45), and may lose to a worse candidate from another reading. Expect to
need a contrast measure that can also read the texture channel, or a per-reading
normalisation. **Measure this before assuming it is fine.**

## Constraints

- **Client-side only.** No network, no CDN. Everything is bundled and
  self-hosted; `scripts/prepare-opencv.mjs` splits OpenCV into
  `static/opencv/{opencv.js,opencv.wasm}` at build time.
- **Arena discipline is absolute.** Every `cv.*` object with a `.delete()` goes
  through `keep()` in the same expression that creates it. See the four rules at
  the top of `src/lib/scan/core/arena.ts`. A missed delete is a dead tab, not a
  slow leak.
- **No hardcoding.** Derive it or make it configurable; constants are for format
  facts and arithmetic. In particular **do not assume A4** — aspect ratio is
  used to *report* results in testing, never to accept or reject one. Receipts,
  Letter and folded sheets all pass through this pipeline.
- **Budget.** The still has a second or two, confirmed acceptable. The live
  viewfinder must not be touched: it is a framing aid running the cheap pass at
  ~26 ms and it does not fire the shutter.
- **Never regress a working capture.** The bar set in v0.6.0 was *gained 3,
  lost 0*. Hold to it.

## How to measure

The harness is in `scratch-workspace/v0.6.0/tune/`, served with
`python3 -m http.server 8777`:

- `best.html` — every capture through both readings side by side, with judge
  scores and overlays. **Start here.** Add the third reading to it first.
- `diag.html` — Otsu threshold, mask before and after morphology, per-contour
  area, solidity, epsilon and aspect. Use when a capture finds nothing and you
  need to know which gate stopped it.
- `verify.html` — per-edge support and contrast for the rough and searched
  quads, and the top-scoring candidates. Use when a capture finds the *wrong*
  thing.
- `time.html?f=<file>` — one capture in isolation, 25 runs, median/p90/max.
  **Use this for any timing claim.** Running many large images in one page
  thrashes the WASM heap and inflated the numbers by 5–10× more than once
  during v0.6.0.

Rebuild the bundle the harnesses import after any source change:

```
npx esbuild src/lib/scan/core/detect.ts --bundle --format=esm \
  --outfile=scratch-workspace/v0.6.0/tune/detect.mjs
```

The sample set is `n1`–`n5`, `m1`–`m6`, `desk`, `bent`, `real3`, `good1`,
`bad1`, `bad2`, `edge1` — nineteen real captures. `n1`, `m2`, `m4` are the
targets; the rest are the regression bar.

## Two open decisions

1. **`n1` and `bad1` currently produce wrong-but-recoverable crops** where they
   previously produced nothing. The review screen offers "Edges wrong? Try
   Original". Whether silence is preferable to a wrong guess is a product call
   that has not been made — it is a threshold change, not a redesign.
2. **The v0.6.0 constants are fitted to nineteen photographs.** The structure is
   sound; several thresholds are tuned more tightly to that sample than is
   comfortable. Revisit once there is a week of real household paperwork to
   measure against, and prefer widening a threshold to adding another.
