import { json, requireToken } from '$lib/server/api/respond';
import { money } from '$lib/api/serialise';
import { tagTotals } from '$lib/server/tags';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	const refused = await requireToken(request, getClientAddress());
	if (refused) return refused;

	const totals = await tagTotals();
	return json({
		tags: totals.map((t) => ({
			id: t.id,
			name: t.name,
			// Per-currency: a tag can span currencies and stored amounts are
			// never re-denominated.
			totals: t.totals.map((part) => money(part.sumMinor, part.currency))
		}))
	});
};
