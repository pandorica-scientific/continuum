// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The uncropped photograph, downscaled, for the corner screen.
 *
 * Fallback for when the phone no longer holds its own copy: the page was
 * already kept (phone released the blob), or the local copy is a HEIC the
 * browser won't decode.
 *
 * Decode happens in the child (via `scanWork`), not here — libheif's heap
 * never shrinks, so decoding in the long-lived server process would leak.
 * `scanWork` also serializes decodes one at a time.
 */
import { error } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { scanId, scanWork } from '$lib/server/scan/http';
import { scanPagePaths, scanSourceExt } from '$lib/server/scan/session';
import type { RequestHandler } from './$types';

/** Enough to place a corner accurately on any phone screen, and no more. */
const MAX_WIDTH = 1600;

export const GET: RequestHandler = async ({ params, url }) => {
	const sessionId = scanId(url.searchParams.get('session'), 'scan session');
	const pageId = scanId(params.id, 'scan page');
	const ext = await scanSourceExt(sessionId, pageId);
	if (!ext) error(404, 'That page is no longer being scanned.');

	const { sourcePath, originalPath } = scanPagePaths(sessionId, pageId, ext);

	// Written once per page: a second visit reads the cached file instead of re-decoding.
	if (!existsSync(originalPath)) {
		await scanWork({ op: 'original', sourcePath, outPath: originalPath, width: MAX_WIDTH });
	}

	return new Response(new Uint8Array(await readFile(originalPath)), {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }
	});
};
