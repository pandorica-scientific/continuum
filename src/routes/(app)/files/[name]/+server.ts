// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { error } from '@sveltejs/kit';
import { openUpload } from '$lib/server/system/files';
import type { RequestHandler } from './$types';

// Uploaded images/documents, auth-guarded by the (app) layout via hooks.
export const GET: RequestHandler = async ({ params }) => {
	const response = await openUpload(params.name);
	if (!response) error(404, 'No such file');
	return response;
};
