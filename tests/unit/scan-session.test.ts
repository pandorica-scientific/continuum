// SPDX-License-Identifier: AGPL-3.0-or-later
// A scan in progress, on disk. Originals are scratch; the sweep is what removes
// them if a phone goes flat mid-stack.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `$env/dynamic/private` snapshots process.env when Vite builds the virtual
 * module, which is BEFORE this suite picks its directory — without this mock the
 * module under test would write into the developer's own uploads directory.
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

		// A stray original in the uploads directory would look like a document with no row.
		expect(page.sourcePath).toContain(join('scan', session.id));
		expect(existsSync(page.sourcePath)).toBe(true);
	});

	it('keeps the extension the photograph arrived with', async () => {
		const { createScanSession, addScanPage, scanSourceExt } = await load();
		const session = await createScanSession();
		const page = await addScanPage(session.id, new Uint8Array([1]), 'IMG_0042.HEIC');
		// The decoder needs to know the format before it opens the file.
		expect(await scanSourceExt(session.id, page.pageId)).toBe('.heic');
	});

	it('refuses a file that is not a photograph', async () => {
		const { createScanSession, addScanPage } = await load();
		const session = await createScanSession();
		await expect(addScanPage(session.id, new Uint8Array([1]), 'statement.pdf')).rejects.toThrow();
	});

	it('refuses an id that tries to leave its directory', async () => {
		// These arrive from a URL parameter; a `..` that gets through is a read or
		// delete anywhere the server can reach.
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
		// Counting every upload would count retakes too; the cap is a statement about
		// the document, not the shutter.
		const { createScanSession, addScanPage, countScanPages, scanPagePaths } = await load();
		const session = await createScanSession();
		const first = await addScanPage(session.id, new Uint8Array([1]), 'a.jpg');
		await addScanPage(session.id, new Uint8Array([2]), 'b.jpg');
		expect(await countScanPages(session.id)).toBe(0);

		const { artefactPath } = scanPagePaths(session.id, first.pageId);
		await writeFile(artefactPath('color'), 'kept');
		expect(await countScanPages(session.id)).toBe(1);

		// The two modes write different extensions, so a page kept twice leaves two
		// files; it is still one page.
		await writeFile(artefactPath('bw'), 'kept');
		expect(await countScanPages(session.id)).toBe(1);
	});

	it('drops one page without ending the scan', async () => {
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

	it('reclaims a source nobody kept when the next photograph arrives', async () => {
		// A source with no artefact when a new photograph lands is one whose `DELETE`
		// never arrived (closed tab, phone off the network). Without this, a client
		// that never says goodbye could add originals forever at zero page count.
		const { createScanSession, addScanPage, dropUnkeptScanPages, scanPagePaths } = await load();
		const session = await createScanSession();
		const abandoned = await addScanPage(session.id, new Uint8Array([1]), 'a.jpg');
		const finished = await addScanPage(session.id, new Uint8Array([2]), 'b.jpg');
		await writeFile(scanPagePaths(session.id, finished.pageId).artefactPath('color'), 'kept');

		expect(await dropUnkeptScanPages(session.id)).toBe(1);
		expect(existsSync(abandoned.sourcePath)).toBe(false);
		// A page that WAS kept keeps its source, so re-editing renders from the original.
		expect(existsSync(finished.sourcePath)).toBe(true);
	});

	it('leaves exactly one artefact behind when a page is kept twice', async () => {
		// The document reader would otherwise pick up the mode the person changed their mind about.
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

		// The sweep reads the newest mtime INSIDE the session, since that's the one a
		// re-render moves.
		const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
		await utimes(page.sourcePath, old, old);
		await utimes(sessionDir(session.id), old, old);

		expect(await sweepScanSessions()).toBe(1);
		expect(existsSync(page.sourcePath)).toBe(false);
	});

	it('leaves a scan that is still being taken', async () => {
		const { createScanSession, sweepScanSessions } = await load();
		await createScanSession();
		expect(await sweepScanSessions()).toBe(0);
	});

	it('leaves a scan whose only recent work was re-rendering one page', async () => {
		// A directory's mtime moves on add/remove/rename, not when a file inside it is
		// overwritten — so a mode tap or corner drag alone must not look abandoned.
		const { createScanSession, addScanPage, sessionDir, scanPagePaths, sweepScanSessions } =
			await load();
		const session = await createScanSession();
		const page = await addScanPage(session.id, new Uint8Array([1]), 'a.jpg');
		const { previewPath } = scanPagePaths(session.id, page.pageId);
		await writeFile(previewPath, 'first render');

		const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
		await utimes(sessionDir(session.id), old, old);
		await utimes(page.sourcePath, old, old);

		// Another mode is tapped, rewriting the preview and nothing else.
		await writeFile(previewPath, 'second render');

		expect(await sweepScanSessions()).toBe(0);
		expect(existsSync(page.sourcePath)).toBe(true);
	});

	it('sweeps nothing at all when no scanning has ever happened', async () => {
		const { sweepScanSessions } = await load();
		expect(await sweepScanSessions()).toBe(0);
	});
});

describe('the reclaim of a scan nobody finished', () => {
	it('runs on the server"s own tick and not only in this file', () => {
		// Read from source rather than the boot registry, since importing that would
		// pull the database into a test whose subject is a temporary directory.
		expect(readFileSync('src/lib/server/boot/defaults.ts', 'utf8')).toContain('sweepScanSessions');
	});

	it('is not the only thing that reclaims one, because two hours is a long time', () => {
		// Closing the tab reaches none of the buttons that say a scan is done;
		// `keepalive` is what lets the request leave anyway.
		const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');
		expect(flow).toMatch(/addEventListener\('pagehide', leave\)/);
		expect(readFileSync('src/lib/scan/client/api.ts', 'utf8')).toMatch(/keepalive: true/);
	});
});
