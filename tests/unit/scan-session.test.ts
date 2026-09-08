// SPDX-License-Identifier: AGPL-3.0-or-later
// A scan in progress, on disk.
//
// The originals are scratch and the sweep is what makes that true rather than
// aspirational — a phone that goes flat mid-stack leaves 60 MB behind, and
// nothing else in the product will ever remove it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `$env/dynamic/private` snapshots process.env when Vite builds the virtual
 * module, which is BEFORE this suite picks its directory — so without this the
 * module under test reads the default `data`, and a test that thinks it is
 * writing to a temporary directory quietly drops files into the developer's
 * own uploads. It did exactly that before this mock was added.
 *
 * `document-file-route.test.ts` mocks it the same way, for the same reason.
 */
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One directory for the whole file, emptied between tests. */
let root: string;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'scan-session-'));
	process.env.UPLOAD_DIR = root;
});

beforeEach(async () => {
	await rm(join(root, 'scan'), { recursive: true, force: true });
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
	delete process.env.UPLOAD_DIR;
});

const load = () => import('$lib/server/scan/session');

describe('a scan session', () => {
	it('keeps its originals under scan/, away from filed documents', async () => {
		const { createScanSession, addScanPage } = await load();
		const session = await createScanSession();
		const page = await addScanPage(session.id, new Uint8Array([1, 2, 3]), 'photo.jpg');

		// Never beside filed documents: these are scratch, and a stray original in
		// the uploads directory would look exactly like a document with no row.
		expect(page.sourcePath).toContain(join('scan', session.id));
		expect(existsSync(page.sourcePath)).toBe(true);
	});

	it('keeps the extension the photograph arrived with', async () => {
		const { createScanSession, addScanPage, scanSourceExt } = await load();
		const session = await createScanSession();
		const page = await addScanPage(session.id, new Uint8Array([1]), 'IMG_0042.HEIC');
		// An iPhone hands over a HEIC and the decoder needs to know that before it
		// opens the file, so the extension is carried rather than normalised away.
		expect(await scanSourceExt(session.id, page.pageId)).toBe('.heic');
	});

	it('refuses a file that is not a photograph', async () => {
		const { createScanSession, addScanPage } = await load();
		const session = await createScanSession();
		await expect(addScanPage(session.id, new Uint8Array([1]), 'statement.pdf')).rejects.toThrow();
	});

	it('refuses an id that tries to leave its directory', async () => {
		// These arrive from a URL parameter. A `..` that gets through is a read or
		// a delete anywhere the server can reach; `system/files.ts` checks names
		// for the same reason.
		const { scanPagePaths, sessionDir } = await load();
		expect(() =>
			scanPagePaths('7f3d5a9c-1111-4222-8333-444455556666', '../../etc/passwd')
		).toThrow();
		expect(() => sessionDir('../..')).toThrow();
	});

	it('deletes everything when the session is dropped', async () => {
		const { createScanSession, addScanPage, dropScanSession } = await load();
		const session = await createScanSession();
		const page = await addScanPage(session.id, new Uint8Array([1]), 'a.jpg');
		await dropScanSession(session.id);
		expect(existsSync(page.sourcePath)).toBe(false);
	});

	it('counts the pages a document would hold rather than the photographs taken', async () => {
		// Every upload writes a source whether its page survives or not, so
		// counting THOSE counted retakes: someone who photographed six pages twice
		// was refused at twenty shutter presses while the review screen in front
		// of them showed fourteen. The cap is a statement about the document.
		const { createScanSession, addScanPage, countScanPages, scanPagePaths } = await load();
		const session = await createScanSession();
		const first = await addScanPage(session.id, new Uint8Array([1]), 'a.jpg');
		await addScanPage(session.id, new Uint8Array([2]), 'b.jpg');
		expect(await countScanPages(session.id)).toBe(0);

		const { artefactPath } = scanPagePaths(session.id, first.pageId);
		await writeFile(artefactPath('color'), 'kept');
		expect(await countScanPages(session.id)).toBe(1);

		// The two modes write different extensions, so a page kept twice leaves
		// two files. It is still one page.
		await writeFile(artefactPath('bw'), 'kept');
		expect(await countScanPages(session.id)).toBe(1);
	});

	it('drops one page without ending the scan', async () => {
		// A retake uploads its replacement into the same session, and the rejected
		// original is the 2–4 MB one.
		const { createScanSession, addScanPage, dropScanPage, scanPagePaths } = await load();
		const session = await createScanSession();
		const first = await addScanPage(session.id, new Uint8Array([1]), 'a.jpg');
		const second = await addScanPage(session.id, new Uint8Array([2]), 'b.jpg');
		await writeFile(scanPagePaths(session.id, first.pageId).previewPath, 'preview');

		await dropScanPage(session.id, first.pageId);
		expect(existsSync(first.sourcePath)).toBe(false);
		expect(existsSync(scanPagePaths(session.id, first.pageId).previewPath)).toBe(false);
		expect(existsSync(second.sourcePath)).toBe(true);
	});

	it('leaves exactly one artefact behind when a page is kept twice', async () => {
		// `document/+server.ts` reads whichever artefact exists and tests the PNG
		// first, so a page kept as colour after black-and-white would go into the
		// document as the mode the person changed their mind about.
		const { createScanSession, addScanPage, dropOtherArtefact, scanPagePaths } = await load();
		const session = await createScanSession();
		const page = await addScanPage(session.id, new Uint8Array([1]), 'a.jpg');
		const { artefactPath } = scanPagePaths(session.id, page.pageId);

		await writeFile(artefactPath('bw'), 'first');
		await writeFile(artefactPath('color'), 'second');
		await dropOtherArtefact(session.id, page.pageId, 'color');

		expect(existsSync(artefactPath('bw'))).toBe(false);
		expect(existsSync(artefactPath('color'))).toBe(true);
	});

	it('sweeps a session whose phone never came back', async () => {
		const { createScanSession, addScanPage, sessionDir, sweepScanSessions } = await load();
		const session = await createScanSession();
		const page = await addScanPage(session.id, new Uint8Array([1]), 'a.jpg');

		// Aged through the module's OWN idea of where the session lives rather
		// than a path rebuilt here, so this keeps testing the right directory
		// even if where sessions live ever changes.
		const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
		await utimes(sessionDir(session.id), old, old);

		expect(await sweepScanSessions()).toBe(1);
		expect(existsSync(page.sourcePath)).toBe(false);
	});

	it('leaves a scan that is still being taken', async () => {
		// The directory's mtime moves whenever a page is added, so a long session
		// is never swept out from under the person taking it.
		const { createScanSession, sweepScanSessions } = await load();
		await createScanSession();
		expect(await sweepScanSessions()).toBe(0);
	});

	it('sweeps nothing at all when no scanning has ever happened', async () => {
		const { sweepScanSessions } = await load();
		expect(await sweepScanSessions()).toBe(0);
	});
});

describe('the reclaim of a scan nobody finished', () => {
	it('runs on the server"s own tick and not only in this file', () => {
		// The failure this exists for. The sweep was written, documented as
		// "Required, not housekeeping", and called from nowhere but the test above
		// — so every abandoned scan kept its 2–4 MB a page for ever, on the
		// smallest disk the product runs on.
		expect(readFileSync('src/hooks.server.ts', 'utf8')).toContain('sweepScanSessions');
	});

	it('is not the only thing that reclaims one, because two hours is a long time', () => {
		// Closing the tab is how a scan usually ends, and it reaches none of the
		// buttons that say so. `keepalive` is what lets the request leave anyway.
		const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');
		expect(flow).toMatch(/addEventListener\('pagehide', leave\)/);
		expect(readFileSync('src/lib/scan/client/api.ts', 'utf8')).toMatch(/keepalive: true/);
	});
});
