// SPDX-License-Identifier: AGPL-3.0-or-later
import { flowData, monthlyHistory } from '$lib/server/cashflow';
import { parsePeriodParams } from '$lib/cashflow/period';
import { getBaseCurrency } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

/** How many months the "Month by month" panel draws. */
const HISTORY_MONTHS = 6;

export const load: PageServerLoad = async ({ url }) => {
	const { period, anchor } = parsePeriodParams(url.searchParams);
	const [flow, history, baseCurrency] = await Promise.all([
		flowData(period, { anchor }),
		monthlyHistory(),
		getBaseCurrency()
	]);

	// Metric tiles for the period.
	const biggest = flow.breakdown
		.flatMap((g) => g.leaves.map((l) => ({ group: g.label, ...l })))
		.sort((a, b) => b.value - a.value)[0];

	// The six months up to the one the screen is anchored on, so stepping the
	// window back walks the bars back with it.
	const upTo = flow.anchor ? history.filter((m) => m.month <= flow.anchor!) : history;

	return {
		flow,
		baseCurrency,
		metrics: {
			moneyIn: flow.totals.in,
			moneyOut: flow.totals.out,
			saved: flow.totals.saved,
			biggest: biggest ?? null
		},
		history: upTo.slice(-HISTORY_MONTHS)
	};
};
