// SPDX-License-Identifier: AGPL-3.0-or-later
import { error } from '@sveltejs/kit';
import { documentStoredName } from '$lib/server/documents/files';
import { openUpload } from '$lib/server/system/files';
import type { RequestHandler } from './$types';

/** A document's file, resolved through the document, not the filename. */
export const GET: RequestHandler = async ({ params }) => {
	const storedName = await documentStoredName(params.id);
	if (!storedName) error(404, 'No such file');
	const response = await openUpload(storedName);
	if (!response) error(404, 'No such file');
	return response;
};
