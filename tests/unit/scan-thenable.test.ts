// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * OpenCV's Emscripten module is a thenable that resolves to ITSELF, so handing
 * it to `resolve()` or awaiting it sends the promise machinery into an endless
 * unwrap — no error, no stack, just a frozen tab (or, on the server, a busy
 * event loop that leaves orphaned children unreachable by `disconnect`).
 */
const ENTRY = 'src/lib/server/scan/worker/entry.ts';
const CHILD = 'src/lib/server/scan/child.ts';
const entry = readFileSync(ENTRY, 'utf8');
const child = readFileSync(CHILD, 'utf8');

describe('the scan child', () => {
	it('detaches `then` before the module meets a promise', () => {
		expect(entry).toMatch(/delete \(cv as \{ then\?: unknown \}\)\.then/);
	});

	it('never resolves with the module without detaching it first', () => {
		// A bare `resolve(cv)` is the exact line that starves the loop.
		const resolves = entry.match(/resolve\([^)]*\)/g) ?? [];
		expect(resolves.filter((call) => /resolve\(cv\)/.test(call))).toEqual([]);
	});

	it('never awaits the module', () => {
		expect(entry).not.toMatch(/await\s+cv\b/);
	});

	it('reaches OpenCV by require, because the dynamic import hangs', () => {
		expect(entry).toContain('createRequire');
	});
});

/**
 * Emscripten does not reject anything when it cannot get a heap: it aborts inside
 * its own callback, so `onRuntimeInitialized` never fires and, with nothing else
 * watching, every request waits for the life of the process.
 */
describe('a scan that cannot start', () => {
	it('gives the runtime a deadline rather than waiting on it forever', () => {
		expect(entry).toMatch(/const READY_TIMEOUT_MS = [\d_]+;/);
	});

	it('says what actually went wrong, so the message names memory', () => {
		expect(entry).toMatch(/short of memory/i);
	});

	it('clears the deadline on every settled path, success included', () => {
		// A timer left running would reject an already-resolved promise and keep a handle alive.
		expect((entry.match(/clearTimeout\(deadline\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
	});

	it('has a deadline on the REQUEST as well, for a child stuck in native code', () => {
		// Catches the case where the child cannot report its own failure, and kills it.
		expect(child).toMatch(/const REQUEST_TIMEOUT_MS = /);
		expect(child).toMatch(/kill\('SIGKILL'\)/);
	});

	it('lets an orphaned child end itself, without needing an event to arrive', () => {
		// `disconnect` is an event; a child whose loop is busy cannot hear one.
		expect(entry).toMatch(/IDLE_SELF_EXIT_MS/);
		expect(entry).toMatch(/setInterval\(/);
	});
});

describe('the OpenCV that used to ship to the browser', () => {
	it('is gone from the client, along with the script that split it out', () => {
		expect(existsSync('src/lib/scan/client/opencv-load.ts')).toBe(false);
		expect(existsSync('scripts/prepare-opencv.mjs')).toBe(false);
	});

	it('is a runtime dependency now, because the server is what needs it', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
		expect(pkg.dependencies['@techstark/opencv-js']).toBeDefined();
		expect(pkg.devDependencies?.['@techstark/opencv-js']).toBeUndefined();
	});

	it('is no longer split into static/ at build time', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
		expect(pkg.scripts.build).not.toContain('prepare-opencv');
		expect(pkg.scripts.build).toContain('build-scan-worker');
	});
});
