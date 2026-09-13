// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One place's engraving, straight off the disk.
 *
 * Auth is the `(app)` layout's, as for every other route under it. The id never
 * reaches a path unchecked — `sightArt` validates its shape against what the
 * dataset mints and opens its own answer, the same lesson as `/files/[name]`.
 *
 * A 404 here is ordinary rather than exceptional: 386 of 3,422 places have an
 * engraving today, and a place without one is not offered as a coin at all, so
 * nothing in the product should ever ask for a missing one.
 */
import { error } from '@sveltejs/kit';
import { sightArt } from '$lib/server/life/places';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	// Addressed by the bare id; the extension is accepted and ignored so a
	// hand-typed URL behaves, and neither form reaches a path.
	const bytes = await sightArt(params.id.replace(/\.webp$/, ''));
	if (!bytes) error(404, 'No engraving for that place.');

	return new Response(bytes.buffer as ArrayBuffer, {
		headers: {
			'content-type': 'image/webp',
			// A year, honestly: this byte sequence changes only when the image is
			// rebuilt, and the URL carries the build stamp so a corrected engraving
			// arrives at a new address rather than never.
			'cache-control': 'private, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff'
		}
	});
};
