// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The seam onto the unchanged scan core.
 *
 * Everything here is the work `ScanFlow.svelte` used to do between the shutter
 * and the preview, with a filesystem where the canvases were. The core itself
 * is untouched and unaware that it moved: it was written canvas-free so it
 * could be tested under node, and that is exactly what lets it run in a server
 * child now. The migration is cheap because of a decision made months before
 * anyone planned it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import {
	REFINE_WIDTH,
	applyOrientation,
	detectBest,
	readOrientation,
	renderPage,
	scaleOutline,
	turnCorners,
	turnEdges,
	type CV
} from '$lib/scan/core/index';
import type { Frame, Outline, PageMode, Rotation } from '$lib/scan/core/types';
import type { DetectRequest, RenderRequest } from '../protocol';
import { decodeToFrame, downscaleFrame, encodeFrame } from './codec';

/**
 * The photograph, turned the right way up.
 *
 * `needsRotation` is deliberately NOT consulted. That helper exists because a
 * BROWSER decoder may have applied the tag already, and comparing the decoded
 * shape against the stored one is the only way to tell. mupdf never applies it,
 * so there is nothing to guess: `readOrientation` returns 1 for a file with no
 * tag, and `applyOrientation` returns the frame untouched for 1. One fewer
 * thing that can be wrong on the server than in the browser.
 */
async function openSource(path: string): Promise<Frame> {
	const bytes = new Uint8Array(await readFile(path));
	return applyOrientation(await decodeToFrame(bytes), readOrientation(bytes));
}

/**
 * Encode a frame the way its mode wants, and write it.
 *
 * PNG for a binarized page: lossless, and JPEG ringing around black text on
 * white is the one artefact that costs legibility. Carried over from
 * `ScanFlow` unchanged, because it was right there too.
 */
async function write(path: string, frame: Frame, mode: PageMode, quality: number): Promise<void> {
	await writeFile(path, await encodeFrame(frame, mode === 'bw' ? 'png' : 'jpeg', quality));
}

/**
 * A quarter turn at a time, frame and corners together.
 *
 * `turnCorners(corners, height)` is ONE clockwise quarter turn and takes the
 * height it is turning WITHIN — not a rotation. So 180 is two calls and 270 is
 * three, each passing the height of the frame as it then stands, which swaps
 * every quarter. Getting this wrong does not throw; it puts the crop somewhere
 * else on the page.
 *
 * The frame turns through `applyOrientation`, whose EXIF cases 6, 3 and 8 are
 * exactly 90, 180 and 270 clockwise. Reusing it means the rotation the user
 * asks for and the rotation a camera asks for go down one well-tested path.
 */
function turn(
	frame: Frame,
	outline: Outline | null,
	rotation: Rotation
): { frame: Frame; outline: Outline | null } {
	let turnedFrame = frame;
	let turned = outline;
	for (let quarter = 0; quarter < rotation / 90; quarter++) {
		turned = turned
			? {
					corners: turnCorners(turned.corners, turnedFrame.height),
					// The bend travels with the corners AND shifts round an edge:
					// what was the top is the right after a quarter turn.
					edges: turnEdges(turned.edges, turnedFrame.height)
				}
			: null;
		turnedFrame = applyOrientation(turnedFrame, 6);
	}
	return { frame: turnedFrame, outline: turned };
}

/**
 * Find the page, and show it cropped.
 *
 * Detection runs at REFINE_WIDTH and NOT at the source's own resolution. Every
 * kernel in the detector is an absolute number of pixels sized for a frame
 * about 640 across; at 2400 the 9-pixel close cannot seal the holes text
 * punches in the page mask, the contour breaks up, and nothing is found. That
 * was the v0.8.5 upload bug, and a full-resolution frame handed to `detectBest`
 * does not come back slowly — it comes back UNCROPPED.
 */
export async function runDetect(
	cv: CV,
	request: DetectRequest
): Promise<{ outline: Outline | null; width: number; height: number }> {
	const source = await openSource(request.sourcePath);
	const measured = downscaleFrame(source, REFINE_WIDTH);
	const state = detectBest(cv, measured);
	// The bow travels with the corners: both were measured in the same
	// downscaled frame, and both have to be scaled back together or the curve
	// would describe an edge 1280 px wide on a page 4000 px wide.
	const found =
		(state.kind === 'detected' || state.kind === 'stable') && state.corners
			? { corners: state.corners, edges: state.edges }
			: null;
	// Back into the ORIGINAL's pixels, which is the only space an outline is
	// ever allowed to be in.
	const outline = found ? scaleOutline(found, source.width / measured.width) : null;

	// Black-and-white is the mode the preview opens on, matching `ScanFlow`.
	const page = renderPage(cv, source, outline, 'bw');
	await write(request.previewPath, downscaleFrame(page, request.previewWidth), 'bw', 90);

	return { outline, width: source.width, height: source.height };
}

/**
 * Render at a chosen mode, corners and rotation.
 *
 * `full` decides whether the warp reads the source or a draft of it. The corner
 * carry is the part to get right: corners are always in the SOURCE's pixels, so
 * a draft render scales them down on the way in — exactly as `ScanFlow.show()`
 * used to, in the same direction, for the same reason.
 */
export async function runRender(
	cv: CV,
	request: RenderRequest
): Promise<{ outline: Outline | null; width: number; height: number }> {
	const source = await openSource(request.sourcePath);
	const turned = turn(source, request.outline, request.rotation);

	const base = request.full ? turned.frame : downscaleFrame(turned.frame, request.previewWidth);
	const outline =
		turned.outline && base.width !== turned.frame.width
			? scaleOutline(turned.outline, base.width / turned.frame.width)
			: turned.outline;

	const page = renderPage(cv, base, outline, request.mode);

	if (request.outPath) {
		// The artefact the PDF will embed: encoded ONCE, at high quality, and
		// handed to pdf-lib as bytes. v0.8.5 had to raise the quality of two
		// compounding encodes; there is now only one to raise.
		await write(request.outPath, page, request.mode, 95);
	}
	if (request.previewPath) {
		await write(request.previewPath, downscaleFrame(page, request.previewWidth), request.mode, 90);
	}

	// The outline is echoed back in the SOURCE's own pixels, never the draft's:
	// the client stores it and sends it again on the next mode switch, and a
	// draft-space boundary round-tripping through that would shrink the crop a
	// little more on every tap.
	return { outline: request.outline, width: page.width, height: page.height };
}
