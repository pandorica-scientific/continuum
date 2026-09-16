// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Regression: the detector assumed the bright side of a brightness split was
 * always the object, which returns no crop at all for a dark object on a
 * light background (e.g. a black wallet on a white floor).
 *
 * Read from source rather than executed: OpenCV cannot load under Vitest
 * (Vite hangs transforming the 10 MB Emscripten bundle), so every scan test
 * in this directory is written this way.
 */
const detect = readFileSync('src/lib/scan/core/detect.ts', 'utf8');
const refine = readFileSync('src/lib/scan/core/refine.ts', 'utf8');

describe('which side of the split is the object', () => {
	it('does not hard-code the bright side as the foreground', () => {
		expect(detect).toMatch(/wantsInverse \? cv\.THRESH_BINARY_INV : cv\.THRESH_BINARY/);
	});

	it('reverses the sense of the split when segmenting on saturation', () => {
		// On brightness the object is usually LIGHT; on saturation it is DULL
		// (paper is nearly grey, a carpet is not). Backwards masks the page as furniture.
		expect(detect).toMatch(/const wantsInverse = segment === 'saturation' \? !invert : invert;/);
	});

	it('reads every photograph both ways round, and by colourfulness too', () => {
		// Candidates, not overrides: judgeQuad scores them against each other.
		expect(detect).toMatch(/detectOnce\(cv, frame, \{[^}]*invert: true[^}]*\}\)/s);
		expect(detect).toMatch(/segment: 'saturation'/);
		expect(detect).toMatch(/const readings = \[plain, evened, darker, dull\];/);
		expect(detect).toMatch(/const candidates = readings/);
	});

	it('refuses a quad that scores like nothing at all', () => {
		// Genuine pages score well above shadows read as objects; the floor rejects the latter.
		expect(detect).toMatch(/const MIN_JUDGED_SCORE = 0\.6;/);
		expect(detect).toMatch(/bestScore < MIN_JUDGED_SCORE/);
	});
});

describe('edge contrast', () => {
	it('measures the size of the step, not its direction', () => {
		// Signed, this says "a page is brighter than what it lies on".
		expect(refine).toMatch(/return Math\.abs\(differences\[differences\.length >> 1\]\) \/ 255/);
	});

	it('takes the absolute of the MEDIAN, never the median of absolutes', () => {
		// A boundary whose samples disagree in sign is noise, not an edge; the
		// signed median collapses it to zero. Absolutes-first would hide that.
		expect(refine).not.toMatch(/differences\.push\(Math\.abs\(/);
		expect(refine).toMatch(/differences\.push\(gray\.ucharPtr/);
	});
});
