// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * OpenCV's Emscripten module is a thenable that resolves to ITSELF:
 *
 *   Module.then = function (func) {
 *     if (calledRun) func(Module); else …onRuntimeInitialized = () => func(Module);
 *     return Module;
 *   };
 *
 * It never removes itself, so handing the module to `resolve()` — or awaiting
 * it — sends the promise machinery into an endless unwrap. The event loop
 * starves: no error, no stack, no crash, just a tab that stops. It took a long
 * afternoon to find, and the shape of the mistake is a one-liner anyone would
 * write, so it is worth a guard.
 */
const loader = readFileSync('src/lib/scan/client/opencv-load.ts', 'utf8');

describe('the OpenCV loader', () => {
	it('detaches `then` before the module meets a promise', () => {
		expect(loader).toMatch(/delete \(cv as \{ then\?: unknown \}\)\.then/);
	});

	it('never resolves with the module without detaching it first', () => {
		// Every resolve() must go through detach(). A bare `resolve(cv)` is the
		// exact line that froze the browser.
		const resolves = loader.match(/resolve\([^)]*\)/g) ?? [];
		const bare = resolves.filter((r) => /resolve\((cv|already)\)/.test(r));
		expect(bare).toEqual([]);
	});

	it('never awaits the module', () => {
		// `await cv` unwraps the same way resolve() does.
		expect(loader).not.toMatch(/await\s+(cv|already|globalThis\.cv)\b/);
	});
});

describe('the split OpenCV build', () => {
	const script = readFileSync('scripts/prepare-opencv.mjs', 'utf8');

	it('points the loader at a file, not a data URI', () => {
		// Emscripten skips WebAssembly.instantiateStreaming when the binary is a
		// data URI, so the inlined build must decode 10.6 million base64
		// characters and compile them in one uninterruptible go.
		expect(script).toContain("const WASM_URL = 'opencv.wasm'");
	});

	it('names the wasm relative to the loader, never as an absolute path', () => {
		// `locateFile` prepends the loader's own directory. An absolute path
		// becomes /opencv//opencv/opencv.wasm — a 404 whose HTML error page
		// Emscripten then tries to compile, reporting only "HTTP status code is
		// not ok".
		expect(script).not.toMatch(/WASM_URL = '\/;/);
		expect(script).not.toContain("WASM_URL = '/opencv");
	});

	it('checks that what it extracted is really WebAssembly', () => {
		expect(script).toContain("'\\0asm'");
	});

	it('is wired into the build, so it cannot be forgotten', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
		expect(pkg.scripts.build).toContain('prepare-opencv');
	});

	it('keeps the package out of the runtime image', () => {
		// Only the build needs it; the server never imports OpenCV.
		const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
		expect(pkg.dependencies['@techstark/opencv-js']).toBeUndefined();
		expect(pkg.devDependencies['@techstark/opencv-js']).toBeDefined();
	});
});
