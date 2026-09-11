// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One country's province outlines, straight off the disk.
 *
 * The bytes on the wire are the bytes on disk: the file was gzipped once when
 * it was fetched and is served with `Content-Encoding: gzip`, so nothing is
 * decompressed here in order to be compressed again by something downstream.
 *
 * The filename is validated against the generated manifest and never used to
 * build a path — `countryOutlines` looks the slug up and opens the manifest's
 * own answer. Same lesson as `/files/[name]`.
 *
 * Auth is the `(app)` layout's, as for every other route under it.
 */
import { error } from '@sveltejs/kit';
import { countryOutlines, hasGeodata } from '$lib/server/life/geodata';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	// Told apart from a bad slug on purpose: one is a developer who has not run
	// the fetch, the other is a request for a country nobody has outlines for.
	if (!hasGeodata()) error(503, 'The map outlines have not been fetched.');

	// `.json.gz` is the extension on disk; the route is addressed by the stem,
	// so a request may carry either and neither reaches a path.
	const slug = params.file.replace(/\.json(\.gz)?$/, '');
	const bytes = await countryOutlines(slug);
	if (!bytes) error(404, 'No outlines for that country.');

	// `bytes.buffer` rather than the view: a `Uint8Array` over a `SharedArrayBuffer`
	// is not a `BodyInit`, and TypeScript cannot tell which kind this is.
	return new Response(bytes.buffer as ArrayBuffer, {
		headers: {
			'content-type': 'application/json',
			'content-encoding': 'gzip',
			// These files change only when the image is rebuilt, and the fetch
			// script writes them by a name that carries the country. A year is the
			// honest answer to how long this byte sequence is good for.
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
