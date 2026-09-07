// SPDX-License-Identifier: AGPL-3.0-or-later
import { error } from '@sveltejs/kit';
import { openUpload } from '$lib/server/system/files';
import type { RequestHandler } from './$types';

// Uploaded images and property media, auth-guarded by the (app) layout via
// hooks. A document's own file is served through `/documents/[id]/file`
// instead, so that route resolves the document row rather than trusting a
// filename it was handed.
export const GET: RequestHandler = async ({ params }) => {
	const response = await openUpload(params.name);
	if (!response) error(404, 'No such file');
	return response;
};
