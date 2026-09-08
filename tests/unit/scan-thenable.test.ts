// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * OpenCV's Emscripten module is a thenable that resolves to ITSELF:
 *
 *   Module.then = function (func) {
 *     if (calledRun) func(Module); else …onRuntimeInitialized = () => func(Module);
 *     return Module;
 *   };
 *
 * It never removes itself, so handing the module to `resolve()` — or awaiting
 * it — sends the promise machinery into an endless unwrap. No error, no stack,
 * no crash. In a browser that was a frozen tab.
 *
 * These guards used to point at `src/lib/scan/client/opencv-load.ts`. v0.8.6
 * deleted that file and moved OpenCV into a forked server child, and the trap
 * did not move with it — it was rediscovered from scratch, in a child that
 * loaded the runtime correctly, announced initialisation, and then answered
 * nothing at all.
 *
 * It also has a second face on a server that it never had in a tab: the unwrap
 * is a SPIN, not a block. Twelve orphaned children accumulated during this
 * feature's development, each holding a core at about 70% and reparented to
 * init when the process that forked them exited — and unreachable by
 * `disconnect`, because an event needs an event loop that is not busy. So the
 * guards below are worth more than they were, not less.
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
		// Every settle must go through detach(). A bare `resolve(cv)` is the exact
		// line that starves the loop.
		const resolves = entry.match(/resolve\([^)]*\)/g) ?? [];
		expect(resolves.filter((call) => /resolve\(cv\)/.test(call))).toEqual([]);
	});

	it('never awaits the module', () => {
		// `await cv` unwraps the same way resolve() does.
		expect(entry).not.toMatch(/await\s+cv\b/);
	});

	it('reaches OpenCV by require, because the dynamic import hangs', () => {
		expect(entry).toContain('createRequire');
	});
});

/**
 * A runtime that never starts.
 *
 * Emscripten does not reject anything when it cannot get a heap: it aborts by
 * throwing inside its own callback, so `onRuntimeInitialized` never fires. With
 * nothing else watching, every request waits for the life of the process —
 * which on a phone is the reading screen staying up for ever, with no error and
 * no way out. That was the v0.8.5 bug, and moving the work to a server does not
 * fix it by itself; it only changes where the silence is.
 */
describe('a scan that cannot start', () => {
	it('gives the runtime a deadline rather than waiting on it forever', () => {
		expect(entry).toMatch(/const READY_TIMEOUT_MS = [\d_]+;/);
	});

	it('says what actually went wrong, so the message names memory', () => {
		expect(entry).toMatch(/short of memory/i);
	});

	it('clears the deadline on every settled path, success included', () => {
		// A timer left running would reject a promise that already resolved, and
		// keep a handle alive doing it.
		expect((entry.match(/clearTimeout\(deadline\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
	});

	it('has a deadline on the REQUEST as well, for a child stuck in native code', () => {
		// The child reports its own failures; this catches the case where it
		// cannot report anything, and kills it rather than leaving it holding
		// 165 MB and answering nothing.
		expect(child).toMatch(/const REQUEST_TIMEOUT_MS = /);
		expect(child).toMatch(/kill\('SIGKILL'\)/);
	});

	it('lets an orphaned child end itself, without needing an event to arrive', () => {
		// `disconnect` is an event. A child whose loop is busy cannot hear one,
		// which is exactly how twelve of them survived their parents.
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
		// What the build produces instead: the child, bundled into build/ where
		// the runtime image already copies from.
		expect(pkg.scripts.build).toContain('build-scan-worker');
	});
});
