// SPDX-License-Identifier: AGPL-3.0-or-later
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

	it('never pulls the OpenCV package into a bundle', () => {
		// It must be imported for TYPES only. A value import drags 10 MB of
		// JavaScript, with 7.6 MB of base64 WebAssembly inside it, into whichever
		// chunk touches it — which does not merely load slowly: it hangs the tab
		// with no error at all. The runtime copy is loaded as a script from
		// static/opencv/, split out of node_modules at build time.
		const offenders = files(ROOT).filter((path) => {
			const source = code(path);
			if (!source.includes('@techstark/opencv-js')) return false;
			return !/import type .*from '@techstark\/opencv-js'/.test(source);
		});
		expect(offenders).toEqual([]);
	});

	it('has no entry point nothing enters through', () => {
		// This used to demand an `index.ts` in each half, and both halves grew one
		// that nothing ever imported: every caller reaches for the module it
		// actually wants — `core/accept`, `client/camera.svelte` — which for an
		// engine meant to be lifted whole is the RIGHT shape, since a barrel over
		// `core` would drag the HEIC and OpenCV paths into a caller that only
		// wanted `admitsPdf`.
		//
		// What portability actually rests on is the four import rules above. An
		// unused barrel adds a second way in that nobody takes, so the rule is
		// now that one must not exist unless it is used.
		const sources = files('src').concat(files('tests'));
		const text = sources.map((path) => readFileSync(path, 'utf8')).join('\n');
		// Both spellings count. Inside the engine the halves reach each other by
		// relative path — `../core/index.ts`, which is what keeps `core` portable
		// — and only code outside it uses the alias.
		const unused = ['core', 'client'].filter(
			(half) =>
				readdirSync(join(ROOT, half)).includes('index.ts') &&
				!text.includes(`$lib/scan/${half}'`) &&
				!text.includes(`${half}/index`)
		);
		expect(unused, 'delete these, or import the half through them').toEqual([]);
	});
});
