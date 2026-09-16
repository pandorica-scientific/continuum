// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One place's engraving, straight off the disk. The id never reaches a path
 * unchecked — `sightArt` validates its shape and opens its own answer, same
 * lesson as `/files/[name]`.
 */
import { error } from '@sveltejs/kit';
import { sightArt } from '$lib/server/life/places';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	// Extension accepted and ignored, so a hand-typed URL behaves.
	const bytes = await sightArt(params.id.replace(/\.webp$/, ''));
	if (!bytes) error(404, 'No engraving for that place.');

	return new Response(bytes.buffer as ArrayBuffer, {
		headers: {
			'content-type': 'image/webp',
			// Changes only when the image is rebuilt; the URL carries the build
			// stamp so a corrected engraving lands at a new address.
			'cache-control': 'private, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff'
		}
	});
};
