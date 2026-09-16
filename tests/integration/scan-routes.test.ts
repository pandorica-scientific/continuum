// SPDX-License-Identifier: AGPL-3.0-or-later
// The whole server-side scan, end to end: upload, inspect, keep, assemble.
// Route handlers are called directly, exercising the real endpoints. No database needed —
// a scan in progress is files and nothing else, which is what lets an abandoned one be swept.
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// $env/dynamic/private snapshots process.env when Vite builds the virtual
// module, which is before this suite picks the directory its scans live in.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

import { POST as uploadPage } from '../../src/routes/scan/page/+server';
import { POST as renderPage } from '../../src/routes/scan/page/[id]/render/+server';
import { POST as keepPage } from '../../src/routes/scan/page/[id]/keep/+server';
import { GET as getPreview } from '../../src/routes/scan/page/[id]/preview/+server';
import { GET as getOriginal } from '../../src/routes/scan/page/[id]/original/+server';
import { POST as makeDocument } from '../../src/routes/scan/document/+server';
import { DELETE as dropSession } from '../../src/routes/scan/session/[id]/+server';
import { DELETE as dropPage } from '../../src/routes/scan/page/[id]/+server';
import { shutdownScanChild } from '$lib/server/scan/child';

const DIRECTORY = resolve('scratch-workspace/scan-route-uploads');
let previousDirectory: string | undefined;

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
});

afterAll(async () => {
	await shutdownScanChild();
	await rm(DIRECTORY, { recursive: true, force: true });
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
});

/** The handlers take a slice of RequestEvent; this is that slice. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const event = (parts: Record<string, unknown>) => parts as any;

async function upload(): Promise<{ sessionId: string; pageId: string; outline: unknown }> {
	const bytes = await readFile('tests/fixtures/scan-page.jpg');
	const form = new FormData();
	form.set('file', new File([bytes], 'page.jpg', { type: 'image/jpeg' }));
	const response = await uploadPage(
		event({ request: new Request('http://localhost/scan/page', { method: 'POST', body: form }) })
	);
	return await response.json();
}

describe('the scan endpoints', () => {
	it('answers with an outline, which is what every later call sends back', async () => {
		// A missing outline is a legal value meaning "nothing was found", so a rename on
		// either side would silently leave every re-render uncropped.
		const { outline } = await upload();
		expect(outline).toHaveProperty('corners.tl.x');
	}, 60_000);

	it('takes a photograph, finds the page, and offers a preview', async () => {
		const { sessionId, pageId, outline } = await upload();
		expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
		expect(outline).not.toBeNull();

		const preview = await getPreview(
			event({
				params: { id: pageId },
				url: new URL(`http://localhost/scan/page/${pageId}/preview?session=${sessionId}`)
			})
		);
		expect(preview.status).toBe(200);
		expect(preview.headers.get('content-type')).toBe('image/png');
		expect((await preview.arrayBuffer()).byteLength).toBeGreaterThan(1000);
	}, 60_000);

	it('serves the uncropped original for the corner screen', async () => {
		// Fallback for a page whose blob the phone has released, or a HEIC the browser
		// can't decode. Decoding happens in the child so libheif's never-shrinking heap
		// stays out of the web server.
		const { sessionId, pageId } = await upload();
		const ask = () =>
			getOriginal(
				event({
					params: { id: pageId },
					url: new URL(`http://localhost/scan/page/${pageId}/original?session=${sessionId}`)
				})
			);
		const original = await ask();
		expect(original.status).toBe(200);
		expect(original.headers.get('content-type')).toBe('image/jpeg');

		// Second call must be served from the file, not another decode.
		const again = await ask();
		expect((await again.arrayBuffer()).byteLength).toBeGreaterThan(1000);
	}, 60_000);

	it('answers a malformed id with a 400 rather than a 500', async () => {
		// Traversal is refused deeper down, but via a plain Error, which SvelteKit
		// would otherwise report as a 500 server fault.
		await expect(
			getPreview(
				event({
					params: { id: 'not-an-id' },
					url: new URL('http://localhost/scan/page/not-an-id/preview?session=nor-is-this')
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('gives back a retaken page rather than keeping it to the end of the scan', async () => {
		// The replacement goes into the SAME session, so without this the rejected
		// original — the 2–4 MB one — sits there until the document is made.
		const { sessionId, pageId } = await upload();
		await dropPage(
			event({
				params: { id: pageId },
				url: new URL(`http://localhost/scan/page/${pageId}?session=${sessionId}`)
			})
		);
		await expect(
			getPreview(
				event({
					params: { id: pageId },
					url: new URL(`http://localhost/scan/page/${pageId}/preview?session=${sessionId}`)
				})
			)
		).rejects.toMatchObject({ status: 404 });
		// And the session it belonged to is still open.
		expect(existsSync(resolve(DIRECTORY, 'scan', sessionId))).toBe(true);
	}, 60_000);

	it('re-renders at a new mode', async () => {
		const { sessionId, pageId, outline } = await upload();
		const response = await renderPage(
			event({
				params: { id: pageId },
				request: new Request('http://localhost/x', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ sessionId, mode: 'color', outline, rotation: 0 })
				})
			})
		);
		expect(response.status).toBe(200);
	}, 60_000);

	it('refuses a mode it does not have', async () => {
		const { sessionId, pageId } = await upload();
		await expect(
			renderPage(
				event({
					params: { id: pageId },
					request: new Request('http://localhost/x', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ sessionId, mode: 'sepia', outline: null, rotation: 0 })
					})
				})
			)
		).rejects.toMatchObject({ status: 400 });
	}, 60_000);

	it('keeps a page and assembles it into a PDF, then forgets the originals', async () => {
		const { sessionId, pageId, outline } = await upload();

		const kept = await keepPage(
			event({
				params: { id: pageId },
				request: new Request('http://localhost/x', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ sessionId, mode: 'color', outline, rotation: 0 })
				})
			})
		);
		expect(kept.status).toBe(200);

		const pdf = await makeDocument(
			event({
				request: new Request('http://localhost/scan/document', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ sessionId, pageIds: [pageId], filename: 'Nájemní smlouva' })
				})
			})
		);
		expect(pdf.headers.get('content-type')).toBe('application/pdf');

		const document = await PDFDocument.load(await pdf.arrayBuffer());
		expect(document.getPageCount()).toBe(1);
		expect(document.getTitle()).toBe('Nájemní smlouva');

		// The originals are scratch, and saving the document is what ends them.
		expect(existsSync(resolve(DIRECTORY, 'scan', sessionId))).toBe(false);
	}, 90_000);

	it('assembles a black-and-white page as a bilevel stream', async () => {
		// bw takes the `frame` shape through assembly rather than the `jpeg` one,
		// because by then it is a 1-bit DeviceGray stream and `packBilevel` needs
		// pixels. Both paths therefore have to work.
		const { sessionId, pageId, outline } = await upload();
		await keepPage(
			event({
				params: { id: pageId },
				request: new Request('http://localhost/x', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ sessionId, mode: 'bw', outline, rotation: 0 })
				})
			})
		);
		const pdf = await makeDocument(
			event({
				request: new Request('http://localhost/scan/document', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ sessionId, pageIds: [pageId], filename: 'Bilevel' })
				})
			})
		);
		expect((await PDFDocument.load(await pdf.arrayBuffer())).getPageCount()).toBe(1);
	}, 90_000);

	it('keeps a page at the mode chosen LAST when it is kept twice', async () => {
		// Black-and-white writes a PNG and every other mode a JPEG, so a page kept
		// twice leaves two artefacts — and the document reads whichever exists,
		// testing the PNG first. The second choice was the one being ignored.
		const { sessionId, pageId, outline } = await upload();
		const keep = (mode: string) =>
			keepPage(
				event({
					params: { id: pageId },
					request: new Request('http://localhost/x', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ sessionId, mode, outline, rotation: 0 })
					})
				})
			);
		await keep('bw');
		await keep('color');

		const dir = resolve(DIRECTORY, 'scan', sessionId);
		expect(existsSync(join(dir, `${pageId}-page.png`))).toBe(false);
		expect(existsSync(join(dir, `${pageId}-page.jpg`))).toBe(true);
	}, 90_000);

	it('abandons a scan on request rather than waiting for the sweep', async () => {
		const { sessionId } = await upload();
		expect(existsSync(resolve(DIRECTORY, 'scan', sessionId))).toBe(true);
		await dropSession(event({ params: { id: sessionId } }));
		expect(existsSync(resolve(DIRECTORY, 'scan', sessionId))).toBe(false);
	}, 60_000);

	it('will not assemble a document with no pages', async () => {
		await expect(
			makeDocument(
				event({
					request: new Request('http://localhost/scan/document', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ sessionId: 'x', pageIds: [], filename: 'Empty' })
					})
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});
});
