// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One kept page, as a picture rather than as a document.
 *
 * The scan engine exists to make PDFs of paper, and everything about it is
 * built for that — flatten, threshold, assemble. But the same first half of the
 * journey is exactly what a photograph of a wine label needs: hold the camera
 * over it, drag the corners onto the edges, get back the rectangle de-skewed.
 * What it must NOT do is the second half: no thresholding, no PDF, and nothing
 * read off the picture.
 *
 * So this returns the artefact the page was kept as, untouched. It is already
 * encoded — `keep` is the one full-resolution encode a page receives — so the
 * bytes written then are the bytes handed over here, and the picture is never
 * decoded and re-encoded on its way out.
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

	// Which mode it was kept as is read from the filesystem rather than from the
	// request, like the document endpoint: a client cannot ask for a page as
	// something it was never rendered as. There are only two files it can be —
	// black-and-white is a PNG and colour, grayscale and original all share the
	// one JPEG path — and `dropOtherArtefact` leaves exactly one of them behind.
	for (const [mode, type] of [
		['color', 'image/jpeg'],
		['bw', 'image/png']
	] as const) {
		const path = artefactPath(mode);
		if (!existsSync(path)) continue;
		return new Response(new Uint8Array(await readFile(path)), {
			headers: {
				'content-type': type,
				// The same path is a different picture after every keep, and this
				// one is on its way into a household's own files.
				'cache-control': 'no-store'
			}
		});
	}

	error(404, 'That page has not been kept.');
};
