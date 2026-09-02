// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The frame every screen draws, guarded at the only place it can be: the source.
 *
 * Before v0.8.0 a screen that wanted three figures either hand-rolled a `.tiles`
 * grid or grew a summary band of its own, and the app had three of those with
 * different padding, different type sizes and different alignment. Reuse cannot
 * be enforced by a rendered assertion — nothing about a screenshot says which
 * component drew it — so this reads the files.
 */
function pages(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return pages(path);
		return entry === '+page.svelte' ? [path] : [];
	});
}

describe('the screen frame', () => {
	const screens = pages('src/routes/(app)');

	it('finds the screens at all', () => {
		// A broken glob would make every case below pass over an empty list.
		expect(screens.length).toBeGreaterThan(10);
	});

	it('no screen draws its own row of figures', () => {
		for (const path of screens) {
			const source = readFileSync(path, 'utf8');
			expect(source, path).not.toMatch(/class="tiles"/);
			expect(source, path).not.toMatch(/\.tiles\s*\{/);
		}
	});

	it('a screen that shows figures shows them with SummaryBand', () => {
		for (const path of screens) {
			const source = readFileSync(path, 'utf8');
			if (source.includes('<MetricTile')) expect(source, path).toContain('<SummaryBand');
		}
	});
});
