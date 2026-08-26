// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The isomorphic half of the scan engine: everything that needs no DOM.
//
// Nothing here may import a canvas, a File, or anything else the browser owns —
// that is what lets the pipeline and its memory discipline be tested under node.
//
// Relative imports carry their `.ts` extension. Node resolves ESM by exact
// filename and this barrel is loaded by `npm run test:scan` under plain node;
// TypeScript accepts it via `rewriteRelativeImportExtensions`, already set in
// tsconfig.json, and Vite resolves it unchanged.
export * from './types.ts';
export { heapBytes, allocMark, type CV } from './opencv.ts';
export { withMats, type Arena, type Disposable } from './arena.ts';
export {
	A4_RATIO,
	MAX_OUTPUT_WIDTH,
	fullFrameCorners,
	turnCorners,
	hairline,
	quadAspect,
	outputSize,
	scaleCorners
} from './geometry.ts';
export {
	applyOrientation,
	needsRotation,
	readOrientation,
	readStoredSize,
	turnsAQuarter
} from './exif.ts';
export { looksLikeHeic } from './heic.ts';
export { admitsImages, admitsPdf, isImageFile } from './accept.ts';
export { deflate, isBilevel, packBilevel } from './bilevel.ts';
export { assemblePdf, type RenderedPage } from './pdf.ts';
export {
	DETECT_WIDTH,
	detectBest,
	detectOnce,
	flattenLighting,
	orderCorners,
	type RefineMode
} from './detect.ts';
export { renderPage } from './enhance.ts';
export {
	angleBetween,
	distanceToLine,
	fitLine,
	intersect,
	lineAngle,
	lineThrough,
	quadAngles,
	worstCornerSkew,
	type Line,
	type Segment
} from './lines.ts';
export { defaultFilename } from './naming.ts';
