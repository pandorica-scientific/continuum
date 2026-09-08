// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One photograph, uploaded and read.
 *
 * The phone keeps its own copy of the file for the corner screen to draw on;
 * this is the copy the server crops from, and it is scratch — deleted when the
 * document is saved or when the sweep reaches an abandoned session.
 */
import { error, json } from '@sveltejs/kit';
import { DRAFT_WIDTH } from '$lib/server/scan/protocol';
import { scanId, scanWork } from '$lib/server/scan/http';
import {
	MAX_PAGES,
	addScanPage,
	countScanPages,
	createScanSession,
	dropUnkeptScanPages,
	scanPagePaths
} from '$lib/server/scan/session';
import { extname } from 'node:path';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No photograph was sent.');

	// A session carries across pages; the first page of a scan makes one.
	const existing = form.get('sessionId');
	const carried = typeof existing === 'string' && existing ? existing : null;
	const sessionId = carried ? scanId(carried, 'scan session') : (await createScanSession()).id;

	// A new photograph means the last one is finished with. One page is in flight
	// at a time, so any source still sitting here without an artefact beside it
	// was abandoned by a client that never got its `DELETE` out — a closed tab, a
	// phone off the network. Reclaimed HERE rather than left to the sweep,
	// because the page cap counts kept pages and these are not kept: without
	// this, a session could grow all afternoon while its page count stayed at
	// zero.
	if (carried) await dropUnkeptScanPages(sessionId);

	// Enforced here as well as in the browser. The browser's cap is now advice —
	// this endpoint is reachable without it. Counted on the pages already KEPT,
	// so a retake does not spend one of the twenty.
	if ((await countScanPages(sessionId)) >= MAX_PAGES) {
		error(409, `A document holds at most ${MAX_PAGES} pages.`);
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	const { pageId } = await addScanPage(sessionId, bytes, file.name);
	const { sourcePath, previewPath } = scanPagePaths(
		sessionId,
		pageId,
		extname(file.name).toLowerCase()
	);

	const result = await scanWork({
		op: 'detect',
		sourcePath,
		previewPath,
		previewWidth: DRAFT_WIDTH
	});

	return json({
		sessionId,
		pageId,
		outline: result.outline,
		// A handful of triples of numbers: the straight edges found in this
		// photograph, so the corner screen can pull a dragged handle onto one
		// rather than leaving it where a thumb happened to land.
		lines: result.lines,
		width: result.width,
		height: result.height
	});
};
