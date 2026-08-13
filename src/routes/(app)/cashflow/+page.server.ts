import { flowData, monthlyHistory, type Period } from '$lib/server/cashflow';
import { getBaseCurrency } from '$lib/server/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const period: Period = url.searchParams.get('period') === 'month' ? 'month' : 'ytd';
	const [flow, history, baseCurrency] = await Promise.all([
		flowData(period),
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
		period,
		flow,
		baseCurrency,
		metrics: {
			moneyIn: flow.totals.in,
			moneyOut: flow.totals.out,
			saved: flow.totals.kept,
			biggest: biggest ?? null
		},
		history: {
			months: history,
			years: [...new Set(history.map((m) => m.month.slice(0, 4)))],
			negativeMonths,
			savedRate
		}
	};
};
