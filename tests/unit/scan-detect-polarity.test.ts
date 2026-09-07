// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The detector segments on brightness, and it assumed which side of that split
 * was the thing being photographed: the bright one.
 *
 * That assumption is invisible on the case it was tuned for — white paper on a
 * dark desk — and total everywhere else. A black wallet on a white floor, a
 * dark passport cover, an ID card on a pale counter: the mask came back as the
 * GROUND with the object as a hole in it. Not a bad crop; no crop at all.
 *
 * There were TWO of them, and either alone was fatal:
 *   1. `THRESH_BINARY` made the bright side the foreground.
 *   2. `edgeContrast` returned a SIGNED `inside - outside`, so a dark object
 *      scored negative on 45% of judgeQuad's marks and was thrown out by
 *      searchQuad's `< CONTRAST_FLOOR` gate before scoring at all.
 *
 * Read from source rather than executed: OpenCV cannot be loaded under Vitest
 * (Vite tries to transform the 10 MB Emscripten bundle and never finishes),
 * which is why every scan test in this directory is written this way. The
 * behaviour was verified out of band against the real detector — a 320x427
 * frame with a rectangle covering 0.314 of it:
 *
 *   light-on-dark, no invert     detected   cov=0.309
 *   dark-on-light, invert        detected   cov=0.309
 *   dark-on-light, NO invert     searching  cov=0.000   <- the bug
 *   dark-on-light, detectBest    detected   cov=0.309
 *   light-on-dark, detectBest    detected   cov=0.309
 */
const detect = readFileSync('src/lib/scan/core/detect.ts', 'utf8');
const refine = readFileSync('src/lib/scan/core/refine.ts', 'utf8');

describe('which side of the split is the object', () => {
	it('does not hard-code the bright side as the foreground', () => {
		expect(detect).toMatch(/invert \? cv\.THRESH_BINARY_INV : cv\.THRESH_BINARY/);
	});

	it('reads every photograph both ways round', () => {
		// A candidate, not an override: judgeQuad scores it against the others.
		expect(detect).toMatch(/detectOnce\(cv, frame, \{[^}]*invert: true[^}]*\}\)/s);
		expect(detect).toMatch(/const candidates = \[plain, evened, darker\]/);
	});
});

describe('edge contrast', () => {
	it('measures the size of the step, not its direction', () => {
		// Signed, this says "a page is brighter than what it lies on".
		expect(refine).toMatch(/return Math\.abs\(differences\[differences\.length >> 1\]\) \/ 255/);
	});

	it('takes the absolute of the MEDIAN, never the median of absolutes', () => {
		// A boundary whose samples disagree in sign is noise, not an edge. The
		// signed median collapses it to zero; absolutes first would dress it up
		// as strong contrast and hand back a quad drawn around nothing.
		expect(refine).not.toMatch(/differences\.push\(Math\.abs\(/);
		expect(refine).toMatch(/differences\.push\(gray\.ucharPtr/);
	});
});
