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
import { scanWork } from '$lib/server/scan/http';
import {
	MAX_PAGES,
	addScanPage,
	countScanPages,
	createScanSession,
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
	const sessionId =
		typeof existing === 'string' && existing ? existing : (await createScanSession()).id;

	// Enforced here as well as in the browser. The browser's cap is now advice —
	// this endpoint is reachable without it.
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
		width: result.width,
		height: result.height
	});
};
