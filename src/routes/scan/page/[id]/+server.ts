// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Throw away one page, without ending the scan.
 *
 * A retake uploads a new page into the same session, and the one being replaced
 * used to stay where it was: nothing asked for it again, but it is the 2–4 MB
 * ORIGINAL, and a stack photographed twice held twice the scratch until the
 * document was made. The session-wide DELETE next door is the other end of the
 * same idea — this is the one page, that is all of them.
 *
 * Deleting a page that was already kept is legal and means what it says. The
 * client only sends this for a page it is discarding.
 */
import { json } from '@sveltejs/kit';
import { scanId } from '$lib/server/scan/http';
import { dropScanPage } from '$lib/server/scan/session';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, url }) => {
	const sessionId = scanId(url.searchParams.get('session'), 'scan session');
	await dropScanPage(sessionId, scanId(params.id, 'scan page'));
	return json({ dropped: true });
};
