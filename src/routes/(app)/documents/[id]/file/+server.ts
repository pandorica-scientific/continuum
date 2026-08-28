// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { error } from '@sveltejs/kit';
import { visibleStoredName } from '$lib/server/documents/files';
import { openUpload } from '$lib/server/system/files';
import type { RequestHandler } from './$types';

/**
 * A document's file, authorised against the DOCUMENT rather than the filename.
 *
 * 404 rather than 403, deliberately: a 403 confirms the document exists, which
 * is exactly the fact being protected.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const storedName = await visibleStoredName(params.id, locals.person);
	if (!storedName) error(404, 'No such file');
	const response = await openUpload(storedName);
	if (!response) error(404, 'No such file');
	return response;
};
