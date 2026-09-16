// SPDX-License-Identifier: AGPL-3.0-or-later
// These fork a real process and load a real OpenCV, so they are slower than the
// rest of the unit suite — deliberately, since mocking the fork would hide the
// bugs this file exists to catch.
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKER_PATH, ask, scanChildAlive, shutdownScanChild } from '$lib/server/scan/child';

const FIXTURE = 'tests/fixtures/scan-page.jpg';

/** Source with its comments stripped, so grepping it doesn't match warning prose in a comment. */
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
		// `await import('@techstark/opencv-js')` under node HANGS rather than failing.
		const source = code('src/lib/server/scan/worker/entry.ts');
		expect(source).toContain('createRequire');
		expect(source).not.toMatch(/import\(\s*['"]@techstark\/opencv-js/);
	});

	it('detaches Emscripten"s self-resolving thenable before awaiting the module', () => {
		// Module.then hands back Module, which is thenable forever; resolving a promise
		// with it starves the event loop silently.
		const source = code('src/lib/server/scan/worker/entry.ts');
		expect(source).toMatch(/delete \(cv as \{ then\?: unknown \}\)\.then/);
		expect(source).toMatch(/resolve\(detach\(cv\)\)/);
	});

	it('stops the idle clock on the way INTO a request, not only on the way out', () => {
		// Regression: touching the clock only in `cleanup` let the idle timer SIGKILL
		// a child mid-request.
		const source = code('src/lib/server/scan/child.ts');
		expect(source).toMatch(/function once\([\s\S]{0,200}holdIdle\(\);/);
	});

	it('is built before it is forked', () => {
		// A missing bundle is a wiring mistake; it should say so here, not as an ENOENT mid-scan.
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
		// Corners come back in the SOURCE's pixels, not REFINE_WIDTH's — this also checks the scale-back.
		expect(reply.outline).not.toBeNull();
		expect(reply.outline!.corners.tl.x).toBeCloseTo(180, -1);
		expect(reply.outline!.corners.tl.y).toBeCloseTo(150, -1);
		expect(reply.outline!.corners.br.x).toBeCloseTo(955, -1);
		expect(reply.outline!.corners.br.y).toBeCloseTo(1430, -1);
	}, 60_000);

	it('reads a HEIC, which is what an iPhone actually sends', async () => {
		// mupdf can't read HEIC directly; libheif must handle it since iPhones shoot HEIC by default.
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
		// A perspective transform maps a quadrilateral exactly but not a curve, so a
		// bowed sheet must be MEASURED as curved. Fixture is bowed 45px out on every edge.
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
		// The mesh remap is only worth its cost on a page that needs it.
		const reply = await detectFixture('flat.png');
		expect(reply.outline?.edges).toBeUndefined();
	}, 60_000);

	it('runs one request at a time even when several are asked at once', async () => {
		// Two 12 MP pipelines at once is the OOM this architecture exists to prevent;
		// overlap is MEASURED rather than assumed.
		// The directory is made FIRST so the three requests aren't ordered by mkdtemp instead.
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

		// Serialised, three cost about three; in parallel they would cost about one.
		// Two is a generous floor unreachable if the supervisor lets them overlap.
		expect(three).toBeGreaterThan(single * 2);
	}, 90_000);

	it('reports a failure as a rejection rather than a hang', async () => {
		// A silently dying child would leave the caller on a promise that never settles.
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
		// OpenCV's heap must never enter this process — Emscripten memory grows and never shrinks.
		const before = process.memoryUsage().rss;
		await detectFixture('rss.png');
		await shutdownScanChild();
		const after = process.memoryUsage().rss;
		expect((after - before) / 1024 / 1024).toBeLessThan(60);
	}, 60_000);
});
