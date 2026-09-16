// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Throw away one page, without ending the scan.
 *
 * A retake's replaced page must be dropped here rather than left in place, or a
 * stack photographed twice keeps twice the scratch (2-4 MB originals) until the
 * document is made. Deleting an already-kept page is legal and means what it says.
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
