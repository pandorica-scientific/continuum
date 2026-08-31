// SPDX-License-Identifier: AGPL-3.0-or-later
import { error } from '@sveltejs/kit';
import { storedNameIsVisible } from '$lib/server/documents/files';
import { openUpload } from '$lib/server/system/files';
import type { RequestHandler } from './$types';

// Uploaded images and property media, auth-guarded by the (app) layout via
// hooks. Documents are served through `/documents/[id]/file` instead — but a
// name that belongs to one is still checked against the document here, because
// the old route knowing only a filename is precisely how a member could open a
// restricted document by holding its stored name.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!(await storedNameIsVisible(params.name, locals.person))) error(404, 'No such file');
	const response = await openUpload(params.name);
	if (!response) error(404, 'No such file');
	return response;
};
