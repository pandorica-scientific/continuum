// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { json, apiError } from '$lib/server/api/respond';
import { money } from '$lib/api/serialise';
import { getBaseCurrency } from '$lib/server/settings';
import { parseFilter } from '$lib/transactions/filter';
import { registerPage } from '$lib/server/transactions';
import { loadSplits } from '$lib/server/splits';
import { loadTagsFor } from '$lib/server/tags';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	// The same pair the register screen calls, so a filter cannot mean one thing
	// on the screen and another over the wire.
	const baseCurrency = await getBaseCurrency();
	const filter = parseFilter(url.searchParams, baseCurrency);
	const page = await registerPage(filter);

	const ids = page.rows.map((r) => r.id);
	const [splitsByTxn, tagsByTxn] = await Promise.all([loadSplits(ids), loadTagsFor(ids)]);

	try {
		return json({
			page: filter.page,
			pageCount: page.pageCount,
			total: page.total,
			totals: page.totals.map((t) => money(t.sumMinor, t.currency)),
			rows: page.rows.map((r) => ({
				id: r.id,
				bookedAt: r.bookedAt,
				amount: money(r.amount, r.currency),
				counterparty: r.counterparty,
				description: r.description,
				categoryId: r.categoryId,
				reviewState: r.reviewState,
				accountId: r.accountId,
				isTransfer: r.isTransfer,
				splits: (splitsByTxn.get(r.id) ?? [])
					.sort((a, b) => a.sort - b.sort)
					.map((s) => ({
						amount: money(s.amountMinor, r.currency),
						categoryId: s.categoryId,
						note: s.note
					})),
				tags: (tagsByTxn.get(r.id) ?? []).map((t) => ({ id: t.id, name: t.name }))
			}))
		});
	} catch (e) {
		return apiError(e instanceof Error ? e.message : 'Serialisation failed.', 500);
	}
};
