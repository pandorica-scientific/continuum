// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Reuse of the shared figure frame can't be enforced by a rendered assertion
// (a screenshot doesn't say which component drew it), so this reads the source.
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

	it('the layout has a skip link to the content', () => {
		// Nine sidebar rows on every screen is a long way to tab to the first
		// heading. The link is the first focusable thing in the shell.
		const layout = readFileSync('src/routes/(app)/+layout.svelte', 'utf8');
		expect(layout).toMatch(/<a class="skip-link" href="#content">/);
		expect(layout).toMatch(/<main id="content"/);
	});
});
