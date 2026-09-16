// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The preview the inspection screen shows.
 *
 * Served as a file rather than base64 in the render response — avoids the ~33%
 * size overhead and the whole-string parse cost for a few-hundred-KB image.
 */
import { error } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { scanId } from '$lib/server/scan/http';
import { scanPagePaths } from '$lib/server/scan/session';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const sessionId = scanId(url.searchParams.get('session'), 'scan session');
	const { previewPath } = scanPagePaths(sessionId, scanId(params.id, 'scan page'));
	if (!existsSync(previewPath)) error(404, 'There is no preview for that page.');

	return new Response(new Uint8Array(await readFile(previewPath)), {
		headers: {
			'content-type': 'image/png',
			// Each render overwrites this path — the same URL is a different picture each time.
			'cache-control': 'no-store'
		}
	});
};
