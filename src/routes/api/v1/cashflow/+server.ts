import { apiError, json } from '$lib/server/api/respond';
import { flowData, type Period } from '$lib/server/cashflow';
import { money } from '$lib/api/serialise';
import { fromMajor } from '$lib/money';
import { getBaseCurrency } from '$lib/server/settings';
import type { RequestHandler } from './$types';

const PERIODS: Period[] = ['ytd', 'month'];

export const GET: RequestHandler = async ({ url }) => {
	// The screen's own vocabulary rather than a second one invented here.
	const raw = (url.searchParams.get('period') ?? 'ytd') as Period;
	if (!PERIODS.includes(raw)) return apiError(`Unknown period "${raw}".`, 400);

	const [flow, base] = await Promise.all([flowData(raw), getBaseCurrency()]);

	// flowData works in base-currency MAJOR units as Numbers, because that is
	// what the waterfall draws. Re-expressing them as minor units keeps one money
	// shape across the API — but be honest about what these are: display-grade
	// figures from a pipeline that already rounded, not ledger-grade sums. The
	// per-transaction endpoints are the exact ones.
	const toMoney = (major: number) => money(fromMajor(major, base), base);

	return json({
		period: raw,
		caption: flow.caption,
		totals: {
			in: toMoney(flow.totals.in),
			out: toMoney(flow.totals.out),
			kept: toMoney(flow.totals.kept)
		}
	});
};
