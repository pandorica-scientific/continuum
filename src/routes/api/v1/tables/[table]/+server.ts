// SPDX-License-Identifier: AGPL-3.0-or-later
// One table, by its database name. Any token reads; only a read-write token
// writes — the boundary in $lib/server/api/respond decides that before this runs.
import { answering, grantOf, json } from '$lib/server/api/respond';
import { ApiError } from '$lib/server/api/errors';
import { deleteRow, insertRows, listRows, updateRow } from '$lib/server/api/tables';
import type { RequestHandler } from './$types';

async function body(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw new ApiError('The body must be JSON.', 400);
	}
}

export const GET: RequestHandler = ({ params, url, locals }) =>
	answering(async () => json(await listRows(grantOf(locals), params.table, url.searchParams)));

export const POST: RequestHandler = ({ params, request, locals }) =>
	answering(async () =>
		json({ rows: await insertRows(grantOf(locals), params.table, await body(request)) }, 201)
	);

export const PATCH: RequestHandler = ({ params, url, request, locals }) =>
	answering(async () =>
		json({
			row: await updateRow(grantOf(locals), params.table, url.searchParams, await body(request))
		})
	);

export const DELETE: RequestHandler = ({ params, url, locals }) =>
	answering(async () =>
		json({ row: await deleteRow(grantOf(locals), params.table, url.searchParams) })
	);
