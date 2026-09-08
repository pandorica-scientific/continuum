// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Re-render a page at a new mode, new corners, or a new rotation.
 *
 * WHERE THE PER-MODE RESOLUTION POLICY LIVES. It looks like an inconsistency
 * and is not, so it is spelled out rather than tidied into one branch by
 * whoever reads it next.
 *
 * Measured on a 12 MP frame rectified to A4 at 300 dpi: the warp is 222 ms, the
 * threshold 214 ms, and the flat-field blur that colour and grayscale need is
 * 1543 ms. So:
 *
 * - Black-and-white renders FULL SIZE. It skips the blur, so it is cheap, and
 *   it is the one mode whose RESULT changes with resolution — a page
 *   thresholded at 1400 px is not the page thresholded at 2480 px, and a draft
 *   preview would have someone approving a different picture from the one they
 *   get.
 * - Colour and grayscale render from the 1400 px draft, as the browser always
 *   did. They are the expensive modes and the ones where downscaling costs no
 *   fidelity: a smaller picture of a flat-fielded page is an honest picture of
 *   the big one.
 */
import { error, json } from '@sveltejs/kit';
import { DRAFT_WIDTH } from '$lib/server/scan/protocol';
import { readJson, scanId, scanWork } from '$lib/server/scan/http';
import { scanPagePaths, scanSourceExt } from '$lib/server/scan/session';
import type { Outline, PageMode, Rotation } from '$lib/scan/core/types';
import type { RequestHandler } from './$types';

const MODES: PageMode[] = ['bw', 'grayscale', 'color', 'original'];
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

interface Body {
	sessionId: string;
	mode: PageMode;
	outline: Outline | null;
	rotation: Rotation;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const body = await readJson<Body>(request);
	if (!MODES.includes(body.mode)) error(400, 'That is not a page mode.');
	if (!ROTATIONS.includes(body.rotation)) error(400, 'That is not a rotation.');

	const sessionId = scanId(body.sessionId, 'scan session');
	const pageId = scanId(params.id, 'scan page');
	const ext = await scanSourceExt(sessionId, pageId);
	if (!ext) error(404, 'That page is no longer being scanned.');

	const { sourcePath, previewPath } = scanPagePaths(sessionId, pageId, ext);

	const result = await scanWork({
		op: 'render',
		sourcePath,
		outPath: null,
		previewPath,
		outline: body.outline,
		mode: body.mode,
		rotation: body.rotation,
		full: body.mode === 'bw',
		previewWidth: DRAFT_WIDTH
	});

	return json({ width: result.width, height: result.height });
};
