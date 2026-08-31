// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
// `detect.ts` imports opencv for its TYPE only, which is erased — so this pulls
// no WASM and runs like any other unit test. `detectOnce` itself needs a real
// runtime and is verified on a device, not here.
import { readFileSync } from 'node:fs';
import { DETECT_WIDTH } from '$lib/scan/core/detect';
import { orderCorners } from '$lib/scan/core/geometry';

describe('orderCorners', () => {
	it('names the four points regardless of the order they arrive in', () => {
		// findContours returns them in whatever order it walked the edge, and a
		// mislabelled corner warps the page inside out.
		const shuffled = [
			{ x: 10, y: 90 },
			{ x: 80, y: 10 },
			{ x: 10, y: 10 },
			{ x: 80, y: 90 }
		];
		expect(orderCorners(shuffled)).toEqual({
			tl: { x: 10, y: 10 },
			tr: { x: 80, y: 10 },
			br: { x: 80, y: 90 },
			bl: { x: 10, y: 90 }
		});
	});

	it('handles a tilted page, where no two corners share an axis', () => {
		const tilted = [
			{ x: 92, y: 34 },
			{ x: 566, y: 58 },
			{ x: 548, y: 330 },
			{ x: 74, y: 306 }
		];
		const { tl, tr, br, bl } = orderCorners(tilted);
		expect(tl).toEqual({ x: 92, y: 34 });
		expect(tr).toEqual({ x: 566, y: 58 });
		expect(br).toEqual({ x: 548, y: 330 });
		expect(bl).toEqual({ x: 74, y: 306 });
	});

	it('does not mutate the array it was given', () => {
		const points = [
			{ x: 10, y: 90 },
			{ x: 80, y: 10 },
			{ x: 10, y: 10 },
			{ x: 80, y: 90 }
		];
		const copy = [...points];
		orderCorners(points);
		expect(points).toEqual(copy);
	});
});

describe('DETECT_WIDTH', () => {
	it('is the one width every corner is measured against', () => {
		// The stability tolerance and the corner rescale both divide by this. If
		// it drifts from what the client actually downscales to, every captured
		// page is cropped wrong.
		expect(DETECT_WIDTH).toBe(640);
	});
});

describe('the two readings of a still', () => {
	const source = readFileSync('src/lib/scan/core/detect.ts', 'utf8');
	// The search that pulls a rough quad onto the page's real edges lives beside
	// it rather than inside it: one file, one job.
	const refine = readFileSync('src/lib/scan/core/refine.ts', 'utf8');
	const capture = readFileSync('src/lib/scan/client/ScanCapture.svelte', 'utf8');

	it('is off while the phone is moving', () => {
		// The loop has about 110 ms a frame and the outline only has to help
		// someone aim.
		expect(source).toMatch(/const refining = options\?\.refine \?\? 'none';/);
	});

	it('reads the mask outline, not the photograph', () => {
		// The measurement that decided this: over real captures, Canny on the
		// photo returned 383-557 segments and the sixteen longest near-horizontal
		// ones all lay inside the text block, while the page's own top edge
		// produced none. The mask's outline returns 29-82 and no typography.
		expect(refine).toMatch(/cv\.MORPH_GRADIENT/);
		expect(refine).toMatch(/cv\.HoughLinesP\(\s*outline,/);
		expect(refine).not.toMatch(/cv\.Canny\(/);
		expect(source).not.toMatch(/cv\.Canny\(/);
	});

	it('scores a candidate on support, contrast and area together', () => {
		// Support alone cropped four paragraphs out of the middle of the page:
		// a line of type is a strong straight edge too. Contrast is what tells
		// a page edge from a text edge — paper on one side, desk on the other.
		expect(refine).toMatch(/WEIGHT_SUPPORT \* worstSupport/);
		expect(refine).toMatch(/WEIGHT_CONTRAST \* Math\.min\(1, meanContrast \/ CONTRAST_FULL\)/);
		expect(refine).toMatch(/WEIGHT_AREA \* area/);
	});

	it('keeps the rough edges among the candidates', () => {
		// So a quad that was already right cannot be talked out of it.
		expect(refine).toMatch(/return \[\s*base,\s*\.\.\.candidateLines\(/);
	});

	it('names the corners by where they are, not by which line found them', () => {
		// Four lines bound a quad without saying which corner is the top-left.
		// Labelling by line role mirrored the page on five of fourteen real
		// captures, and scored the mirror exactly as well as the right way up
		// because both are built from the same four lines.
		expect(refine).toMatch(
			/const quad = orderCorners\(\[meeting\.tl, meeting\.tr, meeting\.br, meeting\.bl\]\);/
		);
		expect(refine).toMatch(/if \(quadWinding\(quad\) <= 0\) continue;/);
	});

	it('takes the page boundary from a PADDED mask', () => {
		// A page held close runs off the edge of the frame. Without the margin
		// there is no gradient along the image border, so the one side hardest to
		// frame scored zero and the search kept pulling the quad away from it.
		// With it, four real captures moved onto A4: 1.33 to 1.43, 1.37 to 1.42.
		expect(refine).toMatch(/cv\.morphologyEx\(bordered, wide, cv\.MORPH_GRADIENT, thin\)/);
	});

	it('proposes generously only when there is a pass to check the answer', () => {
		// Measured: a page with a shadow across it fills 0.68 of its own hull, a
		// page with a second sheet touching it 0.87, two more real captures 0.76
		// and 0.84. The strict floor called all four nothing at all.
		expect(source).toMatch(
			/const solidityFloor =\s*refining === 'none' \? MIN_SOLIDITY : SEARCH_MIN_SOLIDITY;/
		);
	});

	it('will not accept a quad no better placed than the one it started from', () => {
		// Putting the edges ON the page's boundary is the one thing this exists
		// to do. Measured over real captures, every good outcome improves that a
		// lot — 0.12 to 0.87, 0.16 to 0.70 — while the capture that produced a
		// visibly loose crop was the only one to go backwards, 0.27 to 0.24.
		expect(refine).toMatch(/return bestSupport > roughSupport \? best : null;/);
	});

	it('drops a loose candidate the search cannot confirm', () => {
		// Otherwise loosening the floor just trades a missed page for the sheared
		// crop across two objects that the search exists to prevent.
		expect(source).toMatch(/if \(found\) best = found;\s*else if \(!bestIsClean\) best = null;/);
	});

	it('still trusts a clean region when the search finds nothing', () => {
		// That is the answer this detector gave before there was a search, and on
		// a clean sheet it is a good one.
		expect(source).toMatch(/bestIsClean = solidity >= MIN_SOLIDITY;/);
	});

	it('never runs on a live frame', () => {
		// The viewfinder outline is a framing aid and nothing else — it does not
		// fire the shutter, so it has no reason to be more than the cheap
		// reading, and the loop keeps its tenth of a second.
		expect(capture).toMatch(/const next = detectOnce\(cv, frame\);/);
		expect(capture).not.toMatch(/detectOnce\(cv, frame, \{ refine/);
	});

	it('runs once on the still, both ways', () => {
		// Where there is a second or two to spend rather than a tenth of one.
		expect(capture).toMatch(/const settled = detectBest\(cv, measured\);/);
		expect(source).toMatch(
			/const plain = detectOnce\(cv, frame, \{ gates: false, refine: 'thorough' \}\)/
		);
		expect(source).toMatch(/detectOnce\(cv, flattenLighting\(cv, frame\)/);
	});

	it('judges the two readings on the photograph, not on their own masks', () => {
		// Support against a mask says only "these lines sit on the boundary MY
		// segmentation drew", which is not a claim two segmentations can argue
		// about. Brightness either side of an edge is.
		expect(source).toMatch(/JUDGE_CONTRAST \* Math\.min\(1, meanContrast \/ CONTRAST_FULL\)/);
		expect(source).toMatch(/JUDGE_SQUARE \* square/);
		expect(source).toMatch(/JUDGE_AREA \* area/);
	});

	it('lets the chooser choose, not veto', () => {
		// Gating there as well threw away a perfectly good crop whose one weak
		// edge lay against a background nearly the same brightness as the paper.
		expect(source).not.toContain('JUDGE_CONTRAST_FLOOR');
	});

	it('will not build a quad out of a dart', () => {
		// Perspective skews a rectangle; it does not turn it into one. Four lines
		// picked from a pool are under no such obligation, and one wildly skewed
		// quad scored respectably on support and contrast without this.
		expect(refine).toMatch(/if \(worstCornerSkew\(quad\) > MAX_CORNER_SKEW\) continue;/);
	});
});
