// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One bank's logo, straight off the disk. The key never reaches a path
 * unchecked — `bankLogo` validates its shape and opens its own answer, same
 * lesson as `/files/[name]` and the place engravings.
 */
import { error } from '@sveltejs/kit';
import { bankLogo } from '$lib/server/banks/logos';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	// Extension accepted and ignored, so a hand-typed URL behaves.
	const bytes = await bankLogo(params.key.replace(/\.webp$/, ''));
	if (!bytes) error(404, 'No logo for that bank.');

	return new Response(bytes.buffer as ArrayBuffer, {
		headers: {
			'content-type': 'image/webp',
			// The URL is bare (`logoHref` carries no stamp), so a logo replaced by
			// re-running the fetch script would sit behind a cached copy under the
			// old one's address. A day is the compromise between that and refetching
			// a file that almost never changes.
			'cache-control': 'private, max-age=86400',
			'x-content-type-options': 'nosniff'
		}
	});
};
