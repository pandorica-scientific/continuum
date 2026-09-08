// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The uncropped photograph, downscaled, for the corner screen.
 *
 * Normally unused: the phone still holds the file it took, and drawing handles
 * over its own copy costs no network at all. This is the fallback for the two
 * cases where it cannot —
 *
 *   1. the page was KEPT, so the phone released the blob and kept only the
 *      small preview, and the user has come back to re-edit its edges;
 *   2. the local copy is a HEIC the browser will not decode, which is an
 *      iPhone photographing anything at default settings.
 *
 * The decode happens IN THE CHILD, like every other decode. It used to happen
 * here, and that was the one path undoing the architecture: libheif's heap
 * grows and never shrinks, the child makes that floor temporary by exiting, and
 * a web server that never exits made it permanent again. Going through
 * `scanWork` also puts it behind the same one-at-a-time queue, so two people on
 * the corner screen no longer decode two photographs at once.
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

	// Written once per page. The photograph does not change, so a second visit
	// to the corner screen — cancelling out of it and going back in is one tap —
	// is a file read rather than another decode of a 12 MP HEIC.
	if (!existsSync(originalPath)) {
		await scanWork({ op: 'original', sourcePath, outPath: originalPath, width: MAX_WIDTH });
	}

	return new Response(new Uint8Array(await readFile(originalPath)), {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }
	});
};
