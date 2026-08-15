import { db } from '$lib/server/db';
import { category } from '$lib/server/db/schema';
import { json } from '$lib/server/api/respond';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const rows = await db.select().from(category).orderBy(category.groupKey, category.sort);
	return json({
		categories: rows.map((c) => ({ id: c.id, name: c.name, groupKey: c.groupKey, sort: c.sort }))
	});
};
