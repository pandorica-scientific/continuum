// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Commit a page at the mode and corners it is showing.
 *
 * This is the one full-resolution render of the mode actually chosen, and the
 * ONLY encode the page ever receives: the artefact written here is embedded
 * into the PDF as it stands. Every earlier pass was a preview.
 */
import { error, json } from '@sveltejs/kit';
import { DRAFT_WIDTH } from '$lib/server/scan/protocol';
import { readJson, scanWork } from '$lib/server/scan/http';
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

	const ext = await scanSourceExt(body.sessionId, params.id);
	if (!ext) error(404, 'That page is no longer being scanned.');

	const { sourcePath, artefactPath } = scanPagePaths(body.sessionId, params.id, ext);

	const result = await scanWork({
		op: 'render',
		sourcePath,
		outPath: artefactPath(body.mode),
		previewPath: null,
		outline: body.outline,
		mode: body.mode,
		rotation: body.rotation,
		full: true,
		previewWidth: DRAFT_WIDTH
	});

	return json({ kept: true, width: result.width, height: result.height });
};
