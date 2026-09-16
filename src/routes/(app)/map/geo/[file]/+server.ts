// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One country's province outlines, straight off the disk. The file was
 * gzipped once at fetch time and is served as-is with `Content-Encoding:
 * gzip`. The filename is validated against the manifest and never used to
 * build a path directly — same lesson as `/files/[name]`.
 */
import { error } from '@sveltejs/kit';
import { countryOutlines, hasGeodata } from '$lib/server/life/geodata';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
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
			// These files change only when the image is rebuilt.
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
