// SPDX-License-Identifier: AGPL-3.0-or-later
// The supervisor around the scan child.
//
// These fork a real process and load a real OpenCV, so they are slower than the
// rest of the unit suite. That is deliberate: every bug this file exists to
// catch — a dropped IPC message, a promise that never settles, two 12 MP
// pipelines running at once — is invisible to a test that mocks the fork.
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKER_PATH, ask, scanChildAlive, shutdownScanChild } from '$lib/server/scan/child';

const FIXTURE = 'tests/fixtures/scan-page.jpg';

/**
 * Source with its comments stripped.
 *
 * `entry.ts` documents the hanging dynamic import at length, in order to stop
 * anyone reintroducing it — so a test that greps the raw text fails on the very
 * warning that exists to prevent the failure. `scan-boundaries.test.ts` learned
 * this first and says so: comments are prose, not dependencies.
 */
function code(path: string): string {
	return readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^[ \t]*\/\/.*$/gm, '');
}

afterAll(async () => {
	await shutdownScanChild();
});

async function detectFixture(previewName: string) {
	const dir = await mkdtemp(join(tmpdir(), 'scan-child-'));
	return await ask({
		op: 'detect',
		sourcePath: FIXTURE,
		previewPath: join(dir, previewName),
		previewWidth: 400
	});
}

describe('the scan worker bundle', () => {
	it('reaches OpenCV through require and never through a dynamic import', () => {
		// Not a style preference. `await import('@techstark/opencv-js')` under node
		// does not fail, it HANGS — so an ESM tidy-up would break scanning with
		// nothing pointing at the cause.
		const source = code('src/lib/server/scan/worker/entry.ts');
		expect(source).toContain('createRequire');
		expect(source).not.toMatch(/import\(\s*['"]@techstark\/opencv-js/);
	});

	it('detaches Emscripten"s self-resolving thenable before awaiting the module', () => {
		// Module.then hands back Module, which is thenable, for ever. Resolving a
		// promise with it starves the event loop with no error and no stack: the
		// child loads OpenCV, reports initialisation, and then answers nothing.
		const source = code('src/lib/server/scan/worker/entry.ts');
		expect(source).toMatch(/delete \(cv as \{ then\?: unknown \}\)\.then/);
		expect(source).toMatch(/resolve\(detach\(cv\)\)/);
	});

	it('is built before it is forked', () => {
		// `npm run predev` and the build script both produce it. A missing bundle
		// is a wiring mistake, and it should say so here rather than as an ENOENT
		// from deep inside a fork during a scan.
		expect(existsSync(WORKER_PATH())).toBe(true);
	});
});

describe('the scan child', () => {
	it('is not running before anything has been asked of it', async () => {
		await shutdownScanChild();
		expect(scanChildAlive()).toBe(false);
	});

	it('detects a page and writes a preview', async () => {
		const reply = await detectFixture('preview.png');
		expect(reply.ok).toBe(true);
		expect(reply.width).toBe(1200);
		expect(reply.height).toBe(1600);
		// The fixture is a pale page tilted on a dark desk, with its true corners
		// at (180,150) (1010,255) (955,1430) (130,1330). Detection runs at
		// REFINE_WIDTH and the corners come back in the SOURCE's pixels, so this
		// also holds the scale-back: without it they would be 1280/1200 out.
		expect(reply.outline).not.toBeNull();
		expect(reply.outline!.corners.tl.x).toBeCloseTo(180, -1);
		expect(reply.outline!.corners.tl.y).toBeCloseTo(150, -1);
		expect(reply.outline!.corners.br.x).toBeCloseTo(955, -1);
		expect(reply.outline!.corners.br.y).toBeCloseTo(1430, -1);
	}, 60_000);

	it('reads a HEIC, which is what an iPhone actually sends', async () => {
		// mupdf answers "unknown image file format" for HEIC, and an iPhone shoots
		// it BY DEFAULT — so this is not an edge case, it is the single most
		// common input the scanner receives. libheif handles it and the corners
		// come out where they do for the same page as a JPEG.
		const dir = await mkdtemp(join(tmpdir(), 'scan-child-'));
		const reply = await ask({
			op: 'detect',
			sourcePath: 'tests/fixtures/scan-page.heic',
			previewPath: join(dir, 'heic.png'),
			previewWidth: 400
		});
		expect(reply.width).toBe(1200);
		expect(reply.height).toBe(1600);
		expect(reply.outline).not.toBeNull();
		expect(reply.outline!.corners.tl.x).toBeCloseTo(180, -1);
	}, 60_000);

	it('measures the bow of a page that is not flat', async () => {
		// A perspective transform maps a quadrilateral exactly and a curve not at
		// all, so a bowed sheet has to be MEASURED as curved or it is rendered
		// with its edges bent inward and the desk showing at the corners. The
		// fixture is a page bowed 45px out on every edge.
		const dir = await mkdtemp(join(tmpdir(), 'scan-child-'));
		const reply = await ask({
			op: 'detect',
			sourcePath: 'tests/fixtures/scan-page-bowed.jpg',
			previewPath: join(dir, 'bowed.png'),
			previewWidth: 400
		});
		expect(reply.outline).not.toBeNull();
		expect(reply.outline!.edges).toBeDefined();
		const bent = Object.values(reply.outline!.edges!).filter((points) => points.length > 0);
		expect(bent.length).toBeGreaterThan(0);
	}, 60_000);

	it('reports a flat page as flat, so an ordinary photograph carries no curve', async () => {
		// The mesh remap is only worth its cost on a page that needs it, and a
		// flat page reporting four tiny curves would put one in the path of every
		// scan for nothing.
		const reply = await detectFixture('flat.png');
		expect(reply.outline?.edges).toBeUndefined();
	}, 60_000);

	it('runs one request at a time even when several are asked at once', async () => {
		// Two 12 MP pipelines at once is the out-of-memory this whole architecture
		// exists to prevent. Overlap is MEASURED rather than assumed, because a
		// supervisor that awaits the wrong promise looks correct and serialises
		// nothing at all.
		// The directory is made FIRST. Awaiting inside the map would issue the
		// three requests in whatever order those awaits happened to settle, and
		// the test would then be measuring mkdtemp rather than the supervisor.
		const dir = await mkdtemp(join(tmpdir(), 'scan-child-'));
		const detect = (tag: string) =>
			ask({
				op: 'detect',
				sourcePath: FIXTURE,
				previewPath: join(dir, `${tag}.png`),
				previewWidth: 300
			});

		// One request against an already-warm child, to price the work.
		const warm = Date.now();
		await detect('warm');
		const single = Date.now() - warm;

		const together = Date.now();
		await Promise.all(['a', 'b', 'c'].map(detect));
		const three = Date.now() - together;

		// Serialised, three cost about three of them. Run in parallel they would
		// cost about one — which is the OOM this exists to prevent, and the only
		// difference visible from outside the child. Two is a generous floor that
		// still cannot be reached by a supervisor that lets them overlap.
		expect(three).toBeGreaterThan(single * 2);
	}, 90_000);

	it('reports a failure as a rejection rather than a hang', async () => {
		// A child that dies quietly leaves the caller on a promise that never
		// settles, which on a phone is a reading screen that stays up for ever.
		await expect(detectFixture('nope.png').then(() => 'resolved')).resolves.toBe('resolved');
		await expect(
			ask({
				op: 'detect',
				sourcePath: 'does-not-exist.jpg',
				previewPath: join(tmpdir(), 'x.png'),
				previewWidth: 200
			})
		).rejects.toThrow();
	}, 60_000);

	it('leaves the web server"s own memory where it found it', async () => {
		// The claim the whole architecture rests on: OpenCV's heap never enters
		// this process. Emscripten memory grows and never shrinks, so if the
		// pipeline ran here instead, this would climb by ~165 MB and stay there.
		const before = process.memoryUsage().rss;
		await detectFixture('rss.png');
		await shutdownScanChild();
		const after = process.memoryUsage().rss;
		expect((after - before) / 1024 / 1024).toBeLessThan(60);
	}, 60_000);
});
