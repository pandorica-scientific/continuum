// SPDX-License-Identifier: AGPL-3.0-or-later
import { flowData, monthlyHistory } from '$lib/server/cashflow';
import { parsePeriodParams, periodRange } from '$lib/cashflow/period';
import { getBaseCurrency } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

/**
 * The most months the "Month by month" panel will draw.
 *
 * A ceiling, not a window: the panel shows the period the rest of the screen is
 * showing, and this only stops a ten-year record turning into a picket fence of
 * bars too thin to read.
 */
const HISTORY_MONTHS_MAX = 24;

export const load: PageServerLoad = async ({ url }) => {
	const { period, anchor } = parsePeriodParams(url.searchParams);
	const [flow, history, baseCurrency] = await Promise.all([
		flowData(period, { anchor }),
		monthlyHistory(),
		getBaseCurrency()
	]);

	const biggest = flow.breakdown
		.flatMap((g) => g.leaves.map((l) => ({ group: g.label, ...l })))
		.sort((a, b) => b.value - a.value)[0];

	// The SAME window the figures above and the breakdown beside them are for.
	// A fixed six months read as a mistake next to a panel captioned January to
	// September: two panels on one screen, each covering a different half-year,
	// with nothing saying why.
	const { start, end } = periodRange(flow.period, flow.anchor);
	const within = history.filter((m) => m.month >= start.slice(0, 7) && m.month <= end.slice(0, 7));

	return {
		flow,
		baseCurrency,
		metrics: {
			moneyIn: flow.totals.in,
			moneyOut: flow.totals.out,
			saved: flow.totals.saved,
			biggest: biggest ?? null
		},
		history: within.slice(-HISTORY_MONTHS_MAX)
	};
};
