// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The engine must stay portable: it may use the design system (`Icon`,
// `Segmented`, app.css tokens) but never the domain, server, db, form actions,
// or SvelteKit's app modules.
const ROOT = join('src', 'lib', 'scan');
const FOREIGN = /from\s+['"](\$lib\/(server|actions|db|stores)|\$app\/|\$env\/)/;

// Comments are prose, not dependencies — strip them so a file merely
// mentioning a forbidden name isn't flagged.
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
		// `core` may not import anything through an alias at all — that keeps the heap tests runnable.
		const offenders = files(join(ROOT, 'core')).filter((path) => /from\s+['"]\$/.test(code(path)));
		expect(offenders).toEqual([]);
	});

	it('keeps every browser API out of core', () => {
		// A browser API here breaks the node tests, and silently — the heap test would still report green.
		const browserOnly =
			/\b(document|window|HTMLCanvasElement|OffscreenCanvas|createImageBitmap|URL\.createObjectURL)\b/;
		const offenders = files(join(ROOT, 'core')).filter((path) => browserOnly.test(code(path)));
		expect(offenders).toEqual([]);
	});

	it('never pulls the OpenCV package into a bundle', () => {
		// Must be imported for TYPES only — a value import drags in the WASM bundle
		// and hangs the tab with no error. The real thing loads in the scan child.
		const offenders = files(ROOT).filter((path) => {
			const source = code(path);
			if (!source.includes('@techstark/opencv-js')) return false;
			return !/import type .*from '@techstark\/opencv-js'/.test(source);
		});
		expect(offenders).toEqual([]);
	});

	it('keeps OpenCV and libheif out of the browser half entirely', () => {
		// `client` may not reach either package by any import form (type or dynamic
		// included) — both live in the scan child, whose heap can be reclaimed by
		// exiting, unlike Emscripten memory in a tab.
		const offenders = files(join(ROOT, 'client')).filter((path) =>
			/@techstark\/opencv-js|libheif-js/.test(code(path))
		);
		expect(offenders).toEqual([]);
	});

	it('has no entry point nothing enters through', () => {
		// A barrel over `core` would drag HEIC/OpenCV paths into callers that don't need them.
		const sources = files('src').concat(files('tests'));
		const text = sources.map((path) => readFileSync(path, 'utf8')).join('\n');
		// Both spellings count: the alias, and the relative path used inside the engine.
		const unused = ['core', 'client'].filter(
			(half) =>
				readdirSync(join(ROOT, half)).includes('index.ts') &&
				!text.includes(`$lib/scan/${half}'`) &&
				!text.includes(`${half}/index`)
		);
		expect(unused, 'delete these, or import the half through them').toEqual([]);
	});
});
