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
 */
import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { decodeToFrame, downscaleFrame, encodeFrame } from '$lib/server/scan/worker/codec';
import { scanPagePaths, scanSourceExt } from '$lib/server/scan/session';
import { applyOrientation, readOrientation } from '$lib/scan/core/index';
import type { RequestHandler } from './$types';

/** Enough to place a corner accurately on any phone screen, and no more. */
const MAX_WIDTH = 1600;

export const GET: RequestHandler = async ({ params, url }) => {
	const sessionId = url.searchParams.get('session') ?? '';
	const ext = await scanSourceExt(sessionId, params.id);
	if (!ext) error(404, 'That page is no longer being scanned.');

	const { sourcePath } = scanPagePaths(sessionId, params.id, ext);
	const bytes = new Uint8Array(await readFile(sourcePath));

	// Turned the right way up here as well: the handles are placed against what
	// the person sees, and the corners they produce are in the same space the
	// renderer works in only if both have applied the same rotation.
	const frame = applyOrientation(await decodeToFrame(bytes), readOrientation(bytes));
	const asked = Number(url.searchParams.get('w')) || MAX_WIDTH;
	const wanted = Math.min(MAX_WIDTH, Math.max(320, asked));

	return new Response(await encodeFrame(downscaleFrame(frame, wanted), 'jpeg', 80), {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }
	});
};
