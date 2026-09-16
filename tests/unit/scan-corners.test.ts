// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { orderCorners } from '$lib/scan/core/geometry';

/**
 * The floor under the detector: manual correction, needed when detection
 * fails for a reason the photograph itself can't fix (e.g. low contrast).
 */
const corners = readFileSync('src/lib/scan/client/ScanCorners.svelte', 'utf8');
const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');
const preview = readFileSync('src/lib/scan/client/ScanPagePreview.svelte', 'utf8');

describe('the corner editor', () => {
	it('is reachable from the line that says the edges are wrong', () => {
		// The entry point belongs on the "Edges wrong?" line itself, not behind an icon.
		expect(preview).toContain('Adjust the edges');
		// The wording must cover edges too, not just corners, or it undersells the control.
		expect(preview).toContain('Crop wrong?');
		expect(preview).toMatch(/onclick=\{onedges\}/);
		expect(flow).toMatch(/onedges=\{openCorners\}/);
	});

	it("draws on the phone's own copy of the photograph, costing no network", () => {
		// The browser still holds the file it just took; the handles go over that,
		// not a re-fetched or re-encoded copy.
		expect(flow).toMatch(/cornersUrl = held\.localUrl \|\| originalUrl\(/);
	});

	it('falls back to the server when the phone has no usable copy', () => {
		// A KEPT page has released its blob, and a HEIC (an iPhone's default format)
		// can't be displayed by most browsers.
		expect(flow).toMatch(/function cornersFallback\(\)/);
		expect(flow).toMatch(/onunavailable=\{cornersFallback\}/);
		expect(corners).toMatch(/onerror=\{\(\) => onunavailable\?\.\(\)\}/);
	});

	it("hands its corners back in the photograph's own pixels", () => {
		// `Corners` must stay in the SOURCE's coordinate space, or scaling twice
		// shrinks the crop a little on every pass.
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
		// `object-fit: contain` and the overlay's `xMidYMid meet` produce the same
		// rectangle; getScreenCTM reports what the browser actually rendered.
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

	it('takes the bends away with it when the whole photo is asked for', () => {
		// Whole photo must clear any bends, or the renderer mesh-warps a frame
		// this button exists to return whole.
		expect(corners).toMatch(/function wholePhoto\(\)/);
		expect(corners).toMatch(/bends = \{ top: null, right: null, bottom: null, left: null \}/);
		expect(corners).toMatch(/onclick=\{wholePhoto\}/);
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

	it('carries each curve to the edge it was actually pulled on', () => {
		// A bend belongs to the PAIR OF POINTS it was pulled between, not the name
		// that pair had before reordering — otherwise it lands on the wrong edge,
		// pointing the wrong way.
		expect(corners).toMatch(/const edges = edgesFor\(ordered\)/);
		expect(corners).toMatch(/function edgesFor\(ordered: Corners\)/);
		// Reversed when the ordered edge runs the other way: ENDS is also the
		// direction the mesh reads each edge in.
		expect(corners).toMatch(/curveOf\(was\)\.reverse\(\)/);
		expect(corners).not.toMatch(/top: curveOf\('top'\)/);
	});
});
