// SPDX-License-Identifier: AGPL-3.0-or-later
import { error } from '@sveltejs/kit';
import { documentStoredName } from '$lib/server/documents/files';
import { openUpload } from '$lib/server/system/files';
import type { RequestHandler } from './$types';

/**
 * A document's file, resolved through the DOCUMENT rather than the filename.
 *
 * An id that names no document — or a document carrying no file — gets 404,
 * the same answer paper that was never there gets.
 */
export const GET: RequestHandler = async ({ params }) => {
	const storedName = await documentStoredName(params.id);
	if (!storedName) error(404, 'No such file');
	const response = await openUpload(storedName);
	if (!response) error(404, 'No such file');
	return response;
};
