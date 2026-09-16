// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The kept pages, in the order given, as one PDF.
 *
 * Colour/grayscale pages go in as the bytes already on disk (never re-encoded);
 * black-and-white must be decoded since `packBilevel` needs the raw pixels.
 * Mode is read from which artefact exists on disk, not from the request, so a
 * client can't ask for a page to be assembled as something it was never rendered as.
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

	// Validated before path-joining so a stale id is a 400, not a 500 mid-assembly.
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
			// Straight through, unopened: the bytes written when the page was kept.
			return { jpeg: new Uint8Array(await readFile(colour)), mode: 'color' as const };
		}
		error(409, 'A page was not finished before the document was made.');
	});

	const title = body.filename?.trim() || 'Scan';
	const bytes = await assemblePdf(pages, {
		title,
		// Fallback for a black-and-white page that turns out not to be bilevel after all.
		encodeJpeg: (frame) => encodeFrame(frame, 'jpeg', 95)
	});

	// The document now exists as a copy of everything, so drop the scratch originals now.
	await dropScanSession(sessionId);

	return new Response(bytes, {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `attachment; filename="${encodeURIComponent(title)}.pdf"`
		}
	});
};
