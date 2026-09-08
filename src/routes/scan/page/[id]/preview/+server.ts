// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The preview the inspection screen shows.
 *
 * Served as a file rather than returned inside the render response: a preview
 * is a couple of hundred kilobytes, and base64 in JSON would carry it a third
 * larger through a parser that has to hold the whole string. An `<img src>`
 * streams it and the browser caches nothing it should not.
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
			// Each render overwrites this path, so the client cache-busts with a
			// token of its own. Nothing here may be held: the same URL is a
			// different picture after every mode tap.
			'cache-control': 'no-store'
		}
	});
};
