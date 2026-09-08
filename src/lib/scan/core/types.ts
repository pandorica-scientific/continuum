// SPDX-License-Identifier: AGPL-3.0-or-later
// The engine's vocabulary. No behaviour lives here.

export type Point = { x: number; y: number };

/** Always in ORIGINAL image pixels, never in the downscaled detection frame's. */
export type Corners = { tl: Point; tr: Point; br: Point; bl: Point };

/** A line as `a·x + b·y + c = 0`, with (a, b) a unit normal. */
export type Line = { a: number; b: number; c: number };

/**
 * The four edges of a page, each as the points BETWEEN its two corners.
 *
 * An edge runs from the first named corner to the second — `top` is tl→tr,
 * `right` tr→br, `bottom` br→bl, `left` bl→tl — and holds only the interior
 * points, because the endpoints are already in `Corners` and storing them twice
 * is two things that can disagree.
 *
 * An empty array means that edge is straight, which is the ordinary case: most
 * paper photographed flat needs none of this.
 */
export interface Edges {
	top: Point[];
	right: Point[];
	bottom: Point[];
	left: Point[];
}

/**
 * A page boundary, which is not always a quadrilateral.
 *
 * A4 lifted off a table bows: the edge between two corners is a curve, and four
 * straight lines cannot describe it. Measured over real photographs, that is
 * not a rare case — a bowed page is exactly what produces a mask whose boundary
 * is dented, which is why the detector returned nothing for several of them.
 *
 * `corners` is always present and is the whole answer for a flat page, so
 * everything that only wants a quad keeps working unchanged. `edges` bends it.
 */
export interface Outline {
	corners: Corners;
	edges?: Edges;
}

/**
 * `original` is CROPPED but not enhanced: the page is straightened out of
 * perspective and nothing else is touched, so the colours are the ones the
 * camera recorded. It is also still the escape hatch — with no boundary to
 * apply it returns the photograph whole, which is what the upload path needs
 * when detection has failed and there is no viewfinder to retake from.
 */
export type PageMode = 'bw' | 'grayscale' | 'color' | 'original';

export type PageSource = 'camera' | 'upload';

export type Rotation = 0 | 90 | 180 | 270;

/**
 * A canvas-free image, shaped exactly like ImageData.
 *
 * This is the boundary that lets `core` be tested without a DOM: a browser
 * hands one straight through from a canvas, and a test builds one from an
 * array. Nothing in `core` ever sees a canvas, a bitmap or a File.
 *
 * The buffer is pinned to ArrayBuffer rather than ArrayBufferLike so a Frame
 * can be handed to the ImageData constructor without a defensive copy — and a
 * copy of a 2480x3508 page is 35 MB, paid on every encode.
 */
export type Frame = { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number };

/**
 * What the detection loop returns for each frame.
 *
 * `lines` are the straight edges the refinement pass fitted in this frame, kept
 * so the corner screen can snap a dragged handle onto them. They ride on
 * `searching` as well as on a found page, and deliberately: a photograph whose
 * page the detector could NOT confirm is exactly the one somebody is about to
 * place four corners on by hand, and the edges it did find are still there.
 * Absent from a live pass, which does no refinement.
 */
export type DetectState =
	| { kind: 'searching'; lines?: Line[] }
	| { kind: 'detected'; corners: Corners; edges?: Edges; lines?: Line[] }
	| { kind: 'stable'; corners: Corners; edges?: Edges; lines?: Line[] }
	| { kind: 'rejected'; corners: Corners | null; reason: 'blurry' | 'dark' | 'small' | 'angle' };
