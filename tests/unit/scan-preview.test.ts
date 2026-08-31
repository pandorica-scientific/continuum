// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

describe('the flow around it', () => {
	const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');

	it('shows the capture before keeping it', () => {
		// Previously a capture went straight into the field: a wrong crop was
		// filed with no moment at which it could be seen, let alone refused.
		// The screen union must include a preview step, and the flow must render
		// it. Written against the states rather than one literal, so adding
		// another (a dropped photo decodes on a 'reading' screen) does not break
		// a test that is really about the preview existing at all.
		expect(flow).toMatch(/let screen = \$state<[^>]*'preview'[^>]*>/);
		expect(flow).toContain('ScanPagePreview');
	});

	it('previews from a downscaled draft, not the capture resolution', () => {
		// Switching mode re-runs the pipeline. Doing that at capture resolution
		// warps and filters 13 megapixels to fill a box about 800px wide — wasted
		// work, and felt: a dropped 48MP photo took roughly five times as long as
		// a phone capture, which is why the same switch felt quick on a phone and
		// slow on a Mac.
		expect(flow).toMatch(/const PREVIEW_WIDTH = \d+;/);
		expect(flow).toMatch(/renderPage\(cv, draft\.frame, draft\.corners, next\)/);
	});

	it('renders the kept page once, at full resolution', () => {
		// Nothing may be lost from the output: the draft is for looking at.
		expect(flow).toMatch(/renderPage\(cv, source\.frame, source\.corners, mode\)/);
	});

	it('rebuilds the draft after a rotation', () => {
		// It describes the frame as it was; keeping it would preview the old one.
		expect(flow).toMatch(/applyOrientation\(source\.frame, 6\),[\s\S]{0,160}?draft = null;/);
	});

	it('holds the source frame so a mode change can re-render it', () => {
		// Switching mode has to go back to the original pixels; re-processing the
		// already-thresholded result would compound the loss.
		expect(flow).toMatch(/frameFromBitmapSource\(source\.frame, PREVIEW_WIDTH\)/);
	});

	it('revokes the preview URL rather than leaking one per mode switch', () => {
		expect(flow).toContain('URL.revokeObjectURL');
	});

	it('turns the corners with the page rather than dropping them', () => {
		// They describe the frame as it was, but a quarter turn is exact
		// arithmetic on four points. Discarding them, which is what this did,
		// silently swapped the cropped page for the whole photograph.
		expect(flow).toMatch(/turnCorners\(source\.corners, was\)/);
	});
});
