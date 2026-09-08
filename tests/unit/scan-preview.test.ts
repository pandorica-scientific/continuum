// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

/**
 * These used to read `ScanFlow.svelte` for all of it, because all of it was
 * there: the browser held the capture, built a downscaled draft, re-rendered
 * from it on every mode tap, and rendered once at full resolution when the page
 * was kept.
 *
 * v0.8.6 moved that work to the server. The DECISIONS did not change — draft
 * for looking at, full resolution for keeping, corners turned rather than
 * dropped — so the tests did not go away with the code; they follow it to where
 * the decisions are now made, which is the render and keep endpoints and the
 * pipeline behind them.
 */
const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');
const render = readFileSync('src/routes/scan/page/[id]/render/+server.ts', 'utf8');
const keep = readFileSync('src/routes/scan/page/[id]/keep/+server.ts', 'utf8');
const pipeline = readFileSync('src/lib/server/scan/worker/pipeline.ts', 'utf8');
const protocol = readFileSync('src/lib/server/scan/protocol.ts', 'utf8');

describe('the flow around it', () => {
	it('shows the capture before keeping it', () => {
		// Previously a capture went straight into the field: a wrong crop was
		// filed with no moment at which it could be seen, let alone refused.
		expect(flow).toMatch(/let screen = \$state<[^>]*'preview'[^>]*>/);
		expect(flow).toContain('ScanPagePreview');
	});

	it('previews colour and grayscale from a downscaled draft', () => {
		// Switching mode re-runs the pipeline, and the flat-field blur those two
		// modes need measures 1543 ms on an A4 page at 300 dpi. Downscaling costs
		// them no fidelity, so they are rendered at the draft width the browser
		// always used.
		expect(protocol).toMatch(/export const DRAFT_WIDTH = \d+;/);
		expect(render).toMatch(/previewWidth: DRAFT_WIDTH/);
	});

	it('previews black-and-white at full resolution, because thresholding is not scale-free', () => {
		// The one mode whose RESULT changes with resolution: a page thresholded at
		// 1400 px is not the page thresholded at 2480 px, so a draft preview would
		// have someone approving a different picture from the one they get. It is
		// also the cheap mode — it skips the blur — which is what makes this
		// affordable rather than merely correct.
		expect(render).toMatch(/full: body\.mode === 'bw'/);
	});

	it('renders the kept page once, at full resolution', () => {
		// Nothing may be lost from the output: the draft is for looking at.
		expect(keep).toMatch(/full: true/);
		// And the artefact it writes is what the PDF embeds, so it is encoded
		// once for the whole journey.
		expect(keep).toMatch(/outPath: artefactPath\(body\.mode\)/);
	});

	it('re-renders from the original rather than from the last result', () => {
		// Switching mode has to go back to the original pixels; re-processing an
		// already-thresholded page would compound the loss. The server re-reads
		// the stored photograph every time rather than caching a decoded frame,
		// which also keeps its idle memory flat.
		expect(pipeline).toMatch(/const source = await openSource\(request\.sourcePath\)/);
	});

	it('turns the corners with the page rather than dropping them', () => {
		// They describe the frame as it was, but a quarter turn is exact
		// arithmetic on four points. Discarding them, which is what this once did,
		// silently swapped the cropped page for the whole photograph.
		expect(pipeline).toMatch(/turnCorners\(turned\.corners, turnedFrame\.height\)/);
		// And the bend travels with them. A quarter turn also SHIFTS an edge round
		// — what was the top is the right — so a rotated bowed page would
		// otherwise be creased along the wrong axis.
		expect(pipeline).toMatch(/turnEdges\(turned\.edges, turnedFrame\.height\)/);
	});

	it('does not leak an object URL per mode switch', () => {
		// The preview is now a URL the server serves, so there is no blob to
		// revoke for it at all. What the browser does still hold is the ONE
		// photograph being inspected, and that is revoked when the page is kept.
		expect(flow).toContain('URL.revokeObjectURL');
		expect(flow).toMatch(/function releaseLocal\(\)/);
	});
});
