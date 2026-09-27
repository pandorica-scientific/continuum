// SPDX-License-Identifier: AGPL-3.0-or-later
// PDFs attached to records. The boundary has decided the token and that a
// write needs read-write; which RECORD it may touch is decided per call, in
// $lib/server/api/files, because a file's area is the record it hangs off.
import { answering, apiError, grantOf, json } from '$lib/server/api/respond';
import { attachFile, listAttached } from '$lib/server/api/files';
import { bodyTooLarge } from '$lib/server/api/errors';
import { MAX_UPLOAD_BYTES } from '$lib/server/import/safety';
import { asRowId } from '$lib/ids';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, locals }) =>
	answering(async () => {
		const recordId = url.searchParams.get('attached_to');
		if (!recordId) return apiError('Name the record: ?attached_to=<id>.', 400);
		return json({ files: await listAttached(grantOf(locals), asRowId(recordId)) });
	});

export const POST: RequestHandler = ({ request, locals }) =>
	answering(async () => {
		const tooLarge = () =>
			apiError(`A file may be at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`, 413);
		let form: FormData;
		try {
			form = await request.formData();
		} catch (error) {
			// The server's own body limit is the same size as the file limit, so a
			// file over it never reaches the check below: the read itself fails.
			if (bodyTooLarge(error)) return tooLarge();
			return apiError('Send multipart/form-data with a "file" and an "attach_to".', 400);
		}
		const file = form.get('file');
		const attachTo = form.get('attach_to');
		if (!(file instanceof File) || file.size === 0) return apiError('"file" is missing.', 400);
		if (typeof attachTo !== 'string' || !attachTo) return apiError('"attach_to" is missing.', 400);
		if (file.size > MAX_UPLOAD_BYTES) return tooLarge();
		const name = form.get('name');
		const attached = await attachFile(grantOf(locals), {
			attachTo: asRowId(attachTo),
			// The file's own name without its extension when none is given, which
			// is what the Trips screen does with a confirmation.
			name: typeof name === 'string' && name.trim() ? name : file.name.replace(/\.[^.]+$/, ''),
			file
		});
		return json({ file: attached }, 201);
	});
