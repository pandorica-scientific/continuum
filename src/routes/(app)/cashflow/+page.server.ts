// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { flowData, monthlyHistory } from '$lib/server/cashflow';
import { parsePeriodParams } from '$lib/cashflow/period';
import { getBaseCurrency } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

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

	const negativeMonths = history.filter((m) => m.spent > m.earned).length;
	const savedRate =
		history.length > 0
			? Math.round(
					(history.reduce((s, m) => s + (m.earned - m.spent), 0) /
						Math.max(
							history.reduce((s, m) => s + m.earned, 0),
							1
						)) *
						100
				)
			: 0;

	return {
		flow,
		baseCurrency,
		metrics: {
			moneyIn: flow.totals.in,
			moneyOut: flow.totals.out,
			saved: flow.totals.saved,
			biggest: biggest ?? null
		},
		history: {
			months: history,
			negativeMonths,
			savedRate
		}
	};
};
