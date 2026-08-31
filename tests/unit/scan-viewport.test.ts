// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The scan screens must fit the visible viewport, not the layout one.
 *
 * `position: fixed; inset: 0` sounds like "fill the screen" and on a desktop it
 * is. On iOS Safari it resolves against the LARGE viewport — the full height
 * including the strip behind the collapsing browser chrome — so the panel comes
 * out taller than the visible area and the page scrolls to make up the
 * difference. On the preview that means having to scroll to see the bottom of
 * the page you are being asked to approve; on the viewfinder it means the
 * camera slides under your thumb.
 */
const PANELS = [
	['src/lib/scan/client/ScanCapture.svelte', '.capture'],
	['src/lib/scan/client/ScanPagePreview.svelte', '.preview'],
	['src/lib/scan/client/ScanPermission.svelte', '.screen']
] as const;

describe('the scan screens', () => {
	it('are sized to the dynamic viewport', () => {
		for (const [path] of PANELS) {
			const source = readFileSync(path, 'utf8');
			expect(source, path).toContain('height: 100dvh;');
		}
	});

	it('keep a plain viewport-height fallback beneath it', () => {
		// `dvh` is iOS 16.4 and later. Anything older must still get the height
		// `inset: 0` would have produced rather than no height at all.
		for (const [path] of PANELS) {
			const source = readFileSync(path, 'utf8');
			const dvh = source.indexOf('height: 100dvh;');
			const vh = source.indexOf('height: 100vh;');
			expect(vh, path).toBeGreaterThan(-1);
			expect(vh, path).toBeLessThan(dvh);
		}
	});

	it('do not let content escape them', () => {
		for (const [path] of PANELS) {
			expect(readFileSync(path, 'utf8'), path).toContain('overflow: hidden;');
		}
	});

	it('do not treat a drag as a scroll', () => {
		for (const [path] of PANELS) {
			const source = readFileSync(path, 'utf8');
			expect(source, path).toContain('touch-action: none;');
			expect(source, path).toContain('overscroll-behavior: none;');
		}
	});
});
