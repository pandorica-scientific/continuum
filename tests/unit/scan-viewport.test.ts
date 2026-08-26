// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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

	it('pin the page underneath, rather than trusting overflow: hidden', () => {
		// `overflow: hidden` on the body is the obvious lock and iOS Safari
		// ignores it for touch scrolling. Pinning with `position: fixed` takes
		// the body out of flow, so there is nothing left to scroll at all.
		const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');
		expect(flow).toMatch(/body\.style\.position = 'fixed';/);
		expect(flow).toMatch(/body\.style\.top = `-\$\{offset\}px`;/);
	});

	it('put the reader back where they were on the way out', () => {
		// Pinning scrolls the body to the top. Leaving them there means closing
		// the scanner dumps them at the top of a long list.
		const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');
		expect(flow).toMatch(/window\.scrollTo\(0, offset\);/);
		expect(flow).toMatch(/body\.style\.position = previous\.position;/);
	});
});

describe('landscape', () => {
	it('re-measures the picture when the window turns', () => {
		// The video's own `resize` event fires when the STREAM's intrinsic size
		// changes, not when its element does. Rotating the phone changes the box
		// the picture is drawn into while the stream stays 4:3, so without this
		// the measurement goes stale and the outline drifts off the page.
		const capture = readFileSync('src/lib/scan/client/ScanCapture.svelte', 'utf8');
		expect(capture).toMatch(/addEventListener\('resize', remeasure\)/);
		// iOS does not always fire `resize` on a turn.
		expect(capture).toMatch(/addEventListener\('orientationchange', remeasure\)/);
	});

	it('removes those listeners again', () => {
		const capture = readFileSync('src/lib/scan/client/ScanCapture.svelte', 'utf8');
		expect(capture).toMatch(/removeEventListener\('resize', remeasure\)/);
		expect(capture).toMatch(/removeEventListener\('orientationchange', remeasure\)/);
	});

	it('puts the preview controls beside the page, not under it', () => {
		// Stacked in landscape, the fixed-height controls eat most of a 390px
		// viewport and leave the page — the thing being judged — a sliver.
		const preview = readFileSync('src/lib/scan/client/ScanPagePreview.svelte', 'utf8');
		expect(preview).toMatch(/@media \(orientation: landscape\) and \(max-height: 620px\)/);
		expect(preview).toMatch(/grid-template-columns: 1fr minmax\(240px, 32%\)/);
	});

	it('bounds the landscape rules by height, so a desktop is unaffected', () => {
		// A desktop is landscape too, and tall. Without the height bound these
		// rules would reflow every wide screen.
		for (const path of [
			'src/lib/scan/client/ScanPagePreview.svelte',
			'src/lib/scan/client/ScanCapture.svelte'
		]) {
			const source = readFileSync(path, 'utf8');
			// A landscape query NOT followed by a height bound.
			const unbounded =
				source.match(/@media \(orientation: landscape\)(?! and \(max-height)/g) ?? [];
			expect(unbounded, path).toEqual([]);
		}
	});
});
