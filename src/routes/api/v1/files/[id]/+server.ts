// SPDX-License-Identifier: AGPL-3.0-or-later
// One attached file: its bytes, or its removal. Reach is the records it hangs off.
import { answering, apiError, grantOf, json } from '$lib/server/api/respond';
import { removeFile, storedFileOf } from '$lib/server/api/files';
import { openUpload } from '$lib/server/system/files';
import { asRowId } from '$lib/ids';
import type { RequestHandler } from './$types';

// Served by the same function as the app's own /files route, so a PDF arrives
// with the same content type and the same headers that keep it inert.
export const GET: RequestHandler = ({ params, locals }) =>
	answering(async () => {
		const storedName = await storedFileOf(grantOf(locals), asRowId(params.id));
		return (await openUpload(storedName)) ?? apiError('The file is missing from the disk.', 404);
	});

export const DELETE: RequestHandler = ({ params, locals }) =>
	answering(async () => {
		await removeFile(grantOf(locals), asRowId(params.id));
		return json({ removed: params.id });
	});
