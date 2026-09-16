// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// On iOS Safari, `inset: 0` resolves against the LARGE viewport (including the
// collapsing browser chrome strip), making fixed panels taller than visible
// and forcing the page to scroll. Screens must size to the dynamic viewport.
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
