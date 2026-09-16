// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
// `detect.ts` imports opencv for its TYPE only (erased), so this needs no WASM.
// `detectOnce` itself is verified on a device, not here.
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
	// Detection moved to the server in v0.8.6, so the file that shows HOW it is
	// called is the pipeline rather than the viewfinder component.
	const pipeline = readFileSync('src/lib/server/scan/worker/pipeline.ts', 'utf8');

	it('is off while the phone is moving', () => {
		// The loop has about 110 ms a frame and the outline only has to help
		// someone aim.
		expect(source).toMatch(/const refining = options\?\.refine \?\? 'none';/);
	});

	it('reads the mask outline, not the photograph', () => {
		// Canny on the photo picks up text lines as edges; the mask's outline doesn't.
		expect(refine).toMatch(/cv\.MORPH_GRADIENT/);
		expect(refine).toMatch(/cv\.HoughLinesP\(\s*outline,/);
		expect(refine).not.toMatch(/cv\.Canny\(/);
		expect(source).not.toMatch(/cv\.Canny\(/);
	});

	it('scores a candidate on support, contrast and area together', () => {
		// Support alone crops to text lines, which are strong straight edges too;
		// contrast is what tells a page edge from a text edge.
		expect(refine).toMatch(/WEIGHT_SUPPORT \* worstSupport/);
		expect(refine).toMatch(/WEIGHT_CONTRAST \* Math\.min\(1, meanContrast \/ CONTRAST_FULL\)/);
		expect(refine).toMatch(/WEIGHT_AREA \* area/);
	});

	it('keeps the rough edges among the candidates', () => {
		// So a quad that was already right cannot be talked out of it.
		expect(refine).toMatch(/return \[\s*base,\s*\.\.\.candidateLines\(/);
	});

	it('names the corners by where they are, not by which line found them', () => {
		// Four lines bound a quad without saying which corner is the top-left;
		// labelling by line role can mirror the page and score identically.
		expect(refine).toMatch(
			/const quad = orderCorners\(\[meeting\.tl, meeting\.tr, meeting\.br, meeting\.bl\]\);/
		);
		expect(refine).toMatch(/if \(quadWinding\(quad\) <= 0\) continue;/);
	});

	it('takes the page boundary from a PADDED mask', () => {
		// A page held close runs off the edge of the frame; without padding there
		// is no gradient along the image border, so that side scores zero.
		expect(refine).toMatch(/cv\.morphologyEx\(bordered, wide, cv\.MORPH_GRADIENT, thin\)/);
	});

	it('proposes generously only when there is a pass to check the answer', () => {
		// A shadow or a touching second sheet lowers solidity below the strict floor
		// without being an actual miss.
		expect(source).toMatch(
			/const solidityFloor =\s*refining === 'none' \? MIN_SOLIDITY : SEARCH_MIN_SOLIDITY;/
		);
	});

	it('will not accept a quad no better placed than the one it started from', () => {
		// Putting the edges ON the page's boundary is the one thing this exists
		// to do — a candidate that doesn't improve support isn't kept.
		expect(refine).toMatch(/corners: bestSupport > roughSupport \? best : null/);
	});

	it('drops a loose candidate the search cannot confirm', () => {
		// Loosening the floor without a search would trade a missed page for a
		// sheared crop across two objects.
		expect(source).toMatch(
			/if \(found\.corners\) best = found\.corners;\s*else if \(!bestIsClean\) best = null;/
		);
	});

	it('hands back the lines it fitted even when it found no page', () => {
		// A photograph the detector can't confirm is exactly the one someone is
		// about to place corners on by hand, so the fitted lines must ride out
		// on `searching` too, as a placement aid.
		expect(source).toMatch(/return \{ kind: 'searching', lines \};/);
		expect(source).toMatch(
			/if \(candidates\.length === 0\)\s*return \{ kind: 'searching', lines: anyLines \};/
		);
		expect(source).toMatch(
			/return \{ kind: 'searching', lines: best\?\.lines\?\.length \? best\.lines : anyLines \};/
		);
		// And the worker must not filter them back out by kind on the way through.
		const pipeline = readFileSync('src/lib/server/scan/worker/pipeline.ts', 'utf8');
		expect(pipeline).toMatch(/'lines' in state \? \(state\.lines \?\? \[\]\) : \[\]/);
	});

	it('still trusts a clean region when the search finds nothing', () => {
		// A clean sheet's own solidity is already a good enough answer.
		expect(source).toMatch(/bestIsClean = solidity >= MIN_SOLIDITY;/);
	});

	it('never runs on a live frame, because there is no longer a live frame to run on', () => {
		// v0.8.6 removed the live-frame loop entirely — running OpenCV repeatedly
		// in the browser was more heap than an iPhone could reliably allocate.
		const capture = readFileSync('src/lib/scan/client/ScanCapture.svelte', 'utf8');
		expect(capture).not.toContain('detectOnce');
		expect(capture).not.toContain('detectBest');
	});

	it('runs once on the still, both ways', () => {
		// Where there is a second or two to spend rather than a tenth of one.
		expect(pipeline).toMatch(/const state = detectBest\(cv, measured\);/);
		expect(source).toMatch(
			/const plain = detectOnce\(cv, frame, \{ gates: false, refine: 'thorough' \}\)/
		);
		expect(source).toMatch(/detectOnce\(cv, flattenLighting\(cv, frame\)/);
	});

	it('judges the two readings on the photograph, not on their own masks', () => {
		// Support against a mask is circular between two segmentations; brightness
		// either side of an edge is a claim both can be judged on.
		expect(source).toMatch(/JUDGE_CONTRAST \* Math\.min\(1, meanContrast \/ CONTRAST_FULL\)/);
		expect(source).toMatch(/JUDGE_SQUARE \* square/);
		expect(source).toMatch(/JUDGE_AREA \* area/);
	});

	it('lets the chooser choose, not veto', () => {
		// A hard gate here would throw away a good crop whose one weak edge lies
		// against a background nearly the same brightness as the paper.
		expect(source).not.toContain('JUDGE_CONTRAST_FLOOR');
	});

	it('will not build a quad out of a dart', () => {
		// Perspective skews a rectangle but doesn't turn it into a dart; four
		// lines picked from a pool have no such obligation.
		expect(refine).toMatch(/if \(worstCornerSkew\(quad\) > MAX_CORNER_SKEW\) continue;/);
	});
});
