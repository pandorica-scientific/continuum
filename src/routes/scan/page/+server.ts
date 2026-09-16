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

	// Reclaim any source left behind by an abandoned client (closed tab, dropped
	// connection) now, rather than waiting on the sweep — the page cap only counts
	// kept pages, so an abandoned session could otherwise grow unbounded.
	if (carried) await dropUnkeptScanPages(sessionId);

	// Re-enforced server-side since the browser's cap is bypassable. Counts only
	// kept pages, so a retake doesn't spend one of the twenty.
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
		// Straight edges found in the photograph, so the corner screen can snap a
		// dragged handle onto one instead of leaving it where a thumb landed.
		lines: result.lines,
		width: result.width,
		height: result.height
	});
};
