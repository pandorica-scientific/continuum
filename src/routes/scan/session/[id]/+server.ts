// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Abandon a scan.
 *
 * The sweep would reach it in two hours anyway; this is for the case where the
 * person said so, and there is no reason to keep their originals for the two
 * hours after they closed the screen.
 */
import { json } from '@sveltejs/kit';
import { dropScanSession } from '$lib/server/scan/session';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params }) => {
	await dropScanSession(params.id);
	return json({ dropped: true });
};
