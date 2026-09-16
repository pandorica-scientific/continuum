// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

/**
 * v0.8.6 moved rendering to the server; these assert against the render/keep
 * endpoints and the pipeline rather than the client component.
 */
const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');
const render = readFileSync('src/routes/scan/page/[id]/render/+server.ts', 'utf8');
const keep = readFileSync('src/routes/scan/page/[id]/keep/+server.ts', 'utf8');
const pipeline = readFileSync('src/lib/server/scan/worker/pipeline.ts', 'utf8');
const protocol = readFileSync('src/lib/server/scan/protocol.ts', 'utf8');

describe('the flow around it', () => {
	it('shows the capture before keeping it', () => {
		// A wrong crop must be seen and refusable, not filed straight away.
		expect(flow).toMatch(/let screen = \$state<[^>]*'preview'[^>]*>/);
		expect(flow).toContain('ScanPagePreview');
	});

	it('previews colour and grayscale from a downscaled draft', () => {
		// The flat-field blur these modes need is slow at full resolution and costs
		// no fidelity at draft width.
		expect(protocol).toMatch(/export const DRAFT_WIDTH = \d+;/);
		expect(render).toMatch(/previewWidth: DRAFT_WIDTH/);
	});

	it('previews black-and-white at full resolution, because thresholding is not scale-free', () => {
		// The one mode whose result changes with resolution, so a draft preview
		// would show a different picture than what gets kept. Also the cheap mode.
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
		// Re-processing an already-thresholded page would compound the loss.
		expect(pipeline).toMatch(/const source = await openSource\(request\.sourcePath\)/);
	});

	it('turns the corners with the page rather than dropping them', () => {
		// Regression: discarding corners on rotation silently swapped the crop for
		// the whole photograph.
		expect(pipeline).toMatch(/turnCorners\(turned\.corners, turnedFrame\.height\)/);
		// A quarter turn also shifts which edge is which (top becomes right), so a
		// rotated bowed page must not be creased along the wrong axis.
		expect(pipeline).toMatch(/turnEdges\(turned\.edges, turnedFrame\.height\)/);
	});

	it('does not leak an object URL per mode switch', () => {
		// The preview is a server URL, not a blob; only the inspected photograph
		// itself needs revoking, when the page is kept.
		expect(flow).toContain('URL.revokeObjectURL');
		expect(flow).toMatch(/function releaseLocal\(\)/);
	});
});
