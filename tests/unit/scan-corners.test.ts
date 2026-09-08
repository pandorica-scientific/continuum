// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { orderCorners } from '$lib/scan/core/geometry';

/**
 * The floor under the detector.
 *
 * ScanPagePreview argued for a long time that this screen should not exist —
 * "dragging four handles on a phone is worse than taking the photo again",
 * made safe by Original as the recovery. Two things overturned that. Original
 * is not a recovery for a page you need CROPPED: it hands back the desk as
 * well. And retaking does not help when detection fails for a reason the
 * photograph cannot fix — a card too small in frame, an object with a dark band
 * across it, a page the same brightness as the table. Those were unrecoverable.
 */
const corners = readFileSync('src/lib/scan/client/ScanCorners.svelte', 'utf8');
const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');
const preview = readFileSync('src/lib/scan/client/ScanPagePreview.svelte', 'utf8');

describe('the corner editor', () => {
	it('is reachable from the line that says the edges are wrong', () => {
		// The moment someone reads "Edges wrong?" is the moment they want this,
		// so the way in belongs on that line rather than behind an icon.
		expect(preview).toContain('Adjust the edges');
		// The wording covers what the screen actually does. It offered only corner
		// handles when it was called "Adjust the corners"; it now bends edges too,
		// and a name that undersells a control is a control people do not find.
		expect(preview).toContain('Crop wrong?');
		expect(preview).toMatch(/onclick=\{onedges\}/);
		expect(flow).toMatch(/onedges=\{openCorners\}/);
	});

	it("draws on the phone's own copy of the photograph, costing no network", () => {
		// The browser still holds the file it just took, so the handles go over
		// that rather than over anything fetched back. It used to encode a draft
		// of a decoded frame for this, which was the slowest thing the component
		// did; now there is no decoded frame to draft.
		expect(flow).toMatch(/cornersUrl = held\.localUrl \|\| originalUrl\(/);
	});

	it('falls back to the server when the phone has no usable copy', () => {
		// Two cases, and both are ordinary rather than exotic: a page already
		// KEPT has released its blob, and a HEIC is a picture most browsers will
		// not display at all — which is an iPhone photographing anything at
		// default settings.
		expect(flow).toMatch(/function cornersFallback\(\)/);
		expect(flow).toMatch(/onunavailable=\{cornersFallback\}/);
		expect(corners).toMatch(/onerror=\{\(\) => onunavailable\?\.\(\)\}/);
	});

	it("hands its corners back in the photograph's own pixels", () => {
		// `Corners` is only ever allowed to be in the SOURCE's coordinate space.
		// The editor is given the true width and height and reports in them, so
		// nothing has to be scaled on the way out and nothing can be scaled
		// twice — which is what shrank a crop a little on every pass.
		expect(flow).toMatch(/width=\{held\.width\}/);
		expect(flow).toMatch(/height=\{held\.height\}/);
		expect(flow).toMatch(/onapply=\{\(next\) => void show\(mode, next\)\}/);
	});

	it('gives a thumb more room than the dot it is placing', () => {
		// A dot big enough to hit is a dot that covers the corner it is placing.
		const dot = corners.match(/const dotRadius = \$derived\(unit \* ([\d.]+)\)/);
		const grab = corners.match(/const grabRadius = \$derived\(unit \* ([\d.]+)\)/);
		expect(dot).toBeTruthy();
		expect(grab).toBeTruthy();
		expect(Number(grab![1])).toBeGreaterThan(Number(dot![1]) * 2);
	});

	it('maps the pointer through the overlay, not a measured box', () => {
		// An aspect-ratio box under `place-items: center` takes its width from
		// max-content, so a tall photograph grew past the screen and carried the
		// bottom corners off the side. `object-fit: contain` and the overlay's
		// `xMidYMid meet` are defined to produce the same rectangle, and
		// getScreenCTM reports what the browser actually did.
		expect(corners).toMatch(/getScreenCTM\(\)/);
		expect(corners).toMatch(/matrixTransform\(matrix\.inverse\(\)\)/);
		expect(corners).toMatch(/object-fit: contain/);
		expect(corners).toMatch(/preserveAspectRatio="xMidYMid meet"/);
		// The overlay must not be stretched, or the handles drift off the picture.
		expect(corners).not.toMatch(/preserveAspectRatio="none"/);
		// And the surface must not be sized from the photograph's own ratio.
		expect(corners).not.toMatch(/style="aspect-ratio/);
	});

	it('does not let a drag scroll the page underneath', () => {
		expect(corners).toMatch(/touch-action: none/);
	});

	it('can be driven without a pointer', () => {
		expect(corners).toMatch(/ArrowLeft/);
		expect(corners).toMatch(/tabindex="0"/);
		expect(corners).toMatch(/aria-label="\{LABELS\[handle\]\} corner"/);
	});

	it('offers the whole photo as one tap', () => {
		// The other half of a failed detection: sometimes the answer is "no crop".
		expect(corners).toMatch(/quad = fullFrameCorners\(width, height\)/);
	});
});

describe('the corners it hands back', () => {
	it('are ordered, however they were dragged', () => {
		// Dragging the top-left past the top-right is reasonable on a rotated
		// photograph; the warp downstream needs tl/tr/br/bl to mean what they say.
		expect(corners).toMatch(/const ordered = orderCorners\(/);
		expect(corners).toMatch(
			/onapply\(bent \? \{ corners: ordered, edges \} : \{ corners: ordered \}\)/
		);

		// And orderCorners really does sort a quad given in a scrambled order.
		const scrambled = orderCorners([
			{ x: 90, y: 90 },
			{ x: 10, y: 10 },
			{ x: 90, y: 10 },
			{ x: 10, y: 90 }
		]);
		expect(scrambled.tl).toEqual({ x: 10, y: 10 });
		expect(scrambled.tr).toEqual({ x: 90, y: 10 });
		expect(scrambled.br).toEqual({ x: 90, y: 90 });
		expect(scrambled.bl).toEqual({ x: 10, y: 90 });
	});

	it('cannot be dragged outside the photograph', () => {
		expect(corners).toMatch(/const clamp = \(value: number, high: number\) =>/);
	});
});
