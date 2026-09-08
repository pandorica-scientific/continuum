// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The kept pages, in the order given, as one PDF.
 *
 * Each page's artefact was rendered and encoded once when it was kept, so
 * colour and grayscale go into the document as the bytes already on disk —
 * `assemblePdf`'s `jpeg` shape — and are never decoded and re-encoded here.
 * Black-and-white is the exception and has to be: by the time it reaches the
 * document it is a 1-bit DeviceGray stream, and `packBilevel` needs the pixels
 * to build one.
 *
 * The mode is read from WHICH artefact exists rather than from the request. It
 * is the same fact either way, and taking it from the filesystem means a client
 * cannot ask for a page to be assembled as something it was never rendered as.
 */
import { error } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { assemblePdf, type PageProvider } from '$lib/scan/core/pdf';
import { decodeToFrame, encodeFrame } from '$lib/server/scan/worker/codec';
import { readJson, scanId } from '$lib/server/scan/http';
import { MAX_PAGES, dropScanSession, scanPagePaths } from '$lib/server/scan/session';
import type { RequestHandler } from './$types';

interface Body {
	sessionId: string;
	pageIds: string[];
	filename: string;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson<Body>(request);
	if (!Array.isArray(body.pageIds) || body.pageIds.length === 0) {
		error(400, 'A document needs at least one page.');
	}
	if (body.pageIds.length > MAX_PAGES) {
		error(400, `A document holds at most ${MAX_PAGES} pages.`);
	}

	// Checked before any of them is joined to a path, and checked HERE so a stale
	// id is the 400 it is rather than a 500 raised from inside a page provider
	// halfway through assembling a PDF.
	const sessionId = scanId(body.sessionId, 'scan session');
	const pageIds = body.pageIds.map((pageId) => scanId(pageId, 'scan page'));

	const pages: PageProvider[] = pageIds.map((pageId) => async () => {
		const { artefactPath } = scanPagePaths(sessionId, pageId);
		const bilevel = artefactPath('bw');
		const colour = artefactPath('color');

		if (existsSync(bilevel)) {
			const bytes = new Uint8Array(await readFile(bilevel));
			return { frame: await decodeToFrame(bytes), mode: 'bw' as const };
		}
		if (existsSync(colour)) {
			// Straight through, unopened. This is the whole of the "one encode"
			// claim: the bytes written when the page was kept are the bytes in the
			// document.
			return { jpeg: new Uint8Array(await readFile(colour)), mode: 'color' as const };
		}
		error(409, 'A page was not finished before the document was made.');
	});

	const title = body.filename?.trim() || 'Scan';
	const bytes = await assemblePdf(pages, {
		title,
		// Reached only by a black-and-white page that turned out not to be
		// bilevel after all — `assemblePdf` checks before packing, and falls back
		// rather than writing a broken stream.
		encodeJpeg: (frame) => encodeFrame(frame, 'jpeg', 95)
	});

	// The originals were scratch and their job is done. Dropped HERE rather than
	// left to the sweep, because the document now exists and every byte behind
	// it is a copy of something already saved.
	await dropScanSession(sessionId);

	return new Response(bytes, {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `attachment; filename="${encodeURIComponent(title)}.pdf"`
		}
	});
};
