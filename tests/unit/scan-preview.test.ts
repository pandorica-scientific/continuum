// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import ScanPagePreview from '$lib/scan/client/ScanPagePreview.svelte';

const props = {
	previewUrl: 'blob:page',
	mode: 'bw' as const,
	source: 'camera' as const,
	onkeep: () => {},
	onreplace: () => {},
	onmode: () => {},
	onrotate: () => {}
};

describe('the page preview', () => {
	it('offers two answers, not an editor', () => {
		// There are no corner handles by decision. What makes that safe is that
		// the crop is visible before it is kept and Replace costs one tap.
		const { body } = render(ScanPagePreview, { props });
		expect(body).toContain('Keep page');
		expect(body).not.toMatch(/drag the corners/i);
	});

	it('says Replace on the camera path, where there is a viewfinder to return to', () => {
		const { body } = render(ScanPagePreview, { props });
		expect(body).toContain('Replace');
	});

	it('says Choose another file on the upload path, where there is not', () => {
		const { body } = render(ScanPagePreview, { props: { ...props, source: 'upload' } });
		expect(body).toContain('Choose another file');
	});

	it('offers four modes — Original is the recovery for a wrong crop', () => {
		const { body } = render(ScanPagePreview, { props });
		for (const label of ['B&amp;W', 'Grayscale', 'Colour', 'Original']) {
			expect(body).toContain(label);
		}
	});

	it('points at Original when the edges come out wrong', () => {
		// The detector is good, not certain. The user needs to be told what to do
		// about that in the moment they can see it went wrong.
		const { body } = render(ScanPagePreview, { props });
		expect(body).toMatch(/Edges wrong\? Try Original\./);
	});

	it('explains what Original actually does once chosen', () => {
		const { body } = render(ScanPagePreview, { props: { ...props, mode: 'original' } });
		expect(body).toMatch(/no cropping, no clean-up/);
	});

	it('marks the mode in force', () => {
		const { body } = render(ScanPagePreview, { props: { ...props, mode: 'grayscale' } });
		expect(body).toMatch(/class="[^"]*active[^"]*"[^>]*>\s*Grayscale/);
	});

	it('names the wait rather than freezing silently while re-processing', () => {
		const { body } = render(ScanPagePreview, { props: { ...props, busy: true } });
		expect(body).toContain('Cleaning up this page');
	});

	it('meets the touch floor on every control', () => {
		const source = readFileSync('src/lib/scan/client/ScanPagePreview.svelte', 'utf8');
		expect(source).toContain('min-height: var(--touch-min)');
	});
});

describe('the flow around it', () => {
	const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');

	it('shows the capture before keeping it', () => {
		// Previously a capture went straight into the field: a wrong crop was
		// filed with no moment at which it could be seen, let alone refused.
		expect(flow).toMatch(/screen = \$state<'capture' \| 'preview'>\('capture'\)/);
		expect(flow).toContain('ScanPagePreview');
	});

	it('holds the source frame so a mode change can re-render it', () => {
		// Switching mode has to go back to the original pixels; re-processing the
		// already-thresholded result would compound the loss.
		expect(flow).toMatch(/renderPage\(cv, source\.frame, source\.corners, next\)/);
	});

	it('revokes the preview URL rather than leaking one per mode switch', () => {
		expect(flow).toContain('URL.revokeObjectURL');
	});

	it('drops the corners when the page is rotated', () => {
		// They describe the frame as it was; after a quarter turn they point at
		// the wrong edges entirely.
		expect(flow).toMatch(/applyOrientation\(source\.frame, 6\), corners: null/);
	});
});
