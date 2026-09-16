// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One kept page, as a picture rather than as a document.
 *
 * Reuses the scan engine's de-skew/crop step for non-document photos (e.g. a
 * wine label) without the PDF-specific second half (thresholding, assembly).
 * Returns the artefact exactly as `keep` encoded it — never re-encoded here.
 */
import { error } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { scanId } from '$lib/server/scan/http';
import { scanPagePaths } from '$lib/server/scan/session';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const sessionId = scanId(url.searchParams.get('session'), 'scan session');
	const { artefactPath } = scanPagePaths(sessionId, scanId(params.id, 'scan page'));

	// Mode is read from the filesystem, not the request, so a client can't ask for a
	// page as something it was never rendered as. `dropOtherArtefact` leaves exactly
	// one of these two files behind (black-and-white PNG, everything else JPEG).
	for (const [mode, type] of [
		['color', 'image/jpeg'],
		['bw', 'image/png']
	] as const) {
		const path = artefactPath(mode);
		if (!existsSync(path)) continue;
		return new Response(new Uint8Array(await readFile(path)), {
			headers: {
				'content-type': type,
				// The same path is a different picture after every keep.
				'cache-control': 'no-store'
			}
		});
	}

	error(404, 'That page has not been kept.');
};
