// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The scan engine is meant to lift into another app with only the token names
 * changing. That is a property of its imports, not of where its files sit — so
 * this is the test that actually holds it.
 *
 * The line is drawn at Continuum's DOMAIN, not at its design system. The engine
 * may use `Icon` and `Segmented` and the tokens in `app.css`: those are exactly
 * the names expected to change when it moves, and redrawing twenty icons to
 * avoid one import would be the wrong trade. What it may never touch is the
 * database, the server, the form actions or SvelteKit's app modules — those are
 * what would make it Continuum-shaped rather than portable.
 */
const ROOT = join('src', 'lib', 'scan');
const FOREIGN = /from\s+['"](\$lib\/(server|actions|db|stores)|\$app\/|\$env\/)/;

/**
 * Comments are prose, not dependencies. A file explaining that core never sees
 * an HTMLCanvasElement should not be flagged for containing the words — the
 * first version of this test failed on its own documentation.
 */
function code(path: string): string {
	return readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^[ \t]*\/\/.*$/gm, '');
}

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

describe('the scan engine', () => {
	it('imports nothing from the domain, the server, or SvelteKit app modules', () => {
		const offenders = files(ROOT).filter((path) => FOREIGN.test(code(path)));
		expect(offenders).toEqual([]);
	});

	it('keeps core free of even the design system, so it runs under node', () => {
		// `client` may import a Svelte component; `core` may not import anything
		// through an alias at all. That is what keeps the heap tests runnable.
		const offenders = files(join(ROOT, 'core')).filter((path) => /from\s+['"]\$/.test(code(path)));
		expect(offenders).toEqual([]);
	});

	it('keeps every browser API out of core', () => {
		// A canvas, a File or a URL.createObjectURL in here breaks the node
		// tests — and breaking them silently is how the heap test quietly stops
		// running while still reporting green.
		const browserOnly =
			/\b(document|window|HTMLCanvasElement|OffscreenCanvas|createImageBitmap|URL\.createObjectURL)\b/;
		const offenders = files(join(ROOT, 'core')).filter((path) => browserOnly.test(code(path)));
		expect(offenders).toEqual([]);
	});

	it('gives each half an entry point', () => {
		for (const half of ['core', 'client']) {
			expect(readdirSync(join(ROOT, half))).toContain('index.ts');
		}
	});
});
