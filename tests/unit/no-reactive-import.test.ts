// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { markupOf } from '../svelte-markup';

/**
 * `{#await import('…')}` in a template hangs the browser.
 *
 * Svelte re-evaluates an await block's expression reactively, and `import()`
 * returns a NEW promise every time it is evaluated. The block's own state
 * change re-triggers the evaluation, which produces another promise, which
 * changes the state again — a synchronous flush loop that never settles.
 *
 * It cost an afternoon to find because of how it fails: the main thread is
 * pegged, so there is no error, no log and no crash — the tab simply stops.
 * A development build throws `effect_update_depth_exceeded`; the production
 * build has no such guard and just freezes.
 *
 * Lazy loading is still right; it belongs in a handler, awaited ONCE, with the
 * resolved component held in state.
 */
function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return svelteFiles(path);
		return path.endsWith('.svelte') ? [path] : [];
	});
}

describe('dynamic imports', () => {
	it('never sit inside an await block', () => {
		const offenders = svelteFiles('src').filter((path) =>
			/\{#await\s+import\(/.test(markupOf(path))
		);
		expect(offenders).toEqual([]);
	});

	it('are still lazy where the payload is large', () => {
		// The guard above must not be satisfied by making the import eager: the
		// scan engine pulls 10 MB of WASM, and a visitor who never scans should
		// not download it.
		const dropzone = readFileSync('src/lib/components/UploadDropzone.svelte', 'utf8');
		expect(dropzone).toMatch(/await import\(\s*'\$lib\/scan\/client\/ScanFlow\.svelte'\s*\)/);
		expect(dropzone).not.toMatch(/^\s*import ScanFlow/m);
	});
});
