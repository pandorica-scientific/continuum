// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The engine's vocabulary. No behaviour lives here.

export type Point = { x: number; y: number };

/** Always in ORIGINAL image pixels, never in the downscaled detection frame's. */
export type Corners = { tl: Point; tr: Point; br: Point; bl: Point };

/**
 * `original` is the escape hatch: no warp, no enhancement, EXIF rotation only.
 * It exists because the upload path has no viewfinder to retake from, so a
 * failed detection would otherwise leave the user with nothing (§3.1).
 */
export type PageMode = 'bw' | 'grayscale' | 'color' | 'original';

export type PageSource = 'camera' | 'upload';

export type Rotation = 0 | 90 | 180 | 270;

/**
 * A canvas-free image, shaped exactly like ImageData.
 *
 * This is the boundary that lets `core` run under node: a browser hands one
 * straight through from a canvas, and a test builds one from a fixture. Nothing
 * in `core` ever sees an HTMLCanvasElement, an ImageBitmap or a File.
 */
export type Frame = { data: Uint8ClampedArray; width: number; height: number };

/** What the detection loop returns for each frame. */
export type DetectState =
	| { kind: 'searching' }
	| { kind: 'detected'; corners: Corners }
	| { kind: 'stable'; corners: Corners }
	| { kind: 'rejected'; corners: Corners | null; reason: 'blurry' | 'dark' | 'small' };

export interface ScanPage {
	id: string;
	source: PageSource;
	/** null means detection failed; the full frame is used instead, never an error. */
	corners: Corners | null;
	rotation: Rotation;
	mode: PageMode;
	/** The encoded page. The full-resolution source is freed as soon as this exists. */
	rendered: Blob | null;
	previewUrl: string;
}

export interface ScanSession {
	id: string;
	pages: ScanPage[];
	/** From the review screen's "Save as". */
	filename: string;
	createdAt: string;
}
