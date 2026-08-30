// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { apiError, json } from '$lib/server/api/respond';
import { flowData } from '$lib/server/cashflow';
import { parsePeriodParams, PERIODS, type Period } from '$lib/cashflow/period';
import { money } from '$lib/api/serialise';
import { fromMajor } from '$lib/money';
import { getBaseCurrency } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	// The screens' own vocabulary rather than a second one invented here — and
	// the one caller that refuses an unknown window instead of falling back to
	// the default, because a client asking over the wire can fix its call once
	// it is told. `?anchor` is read the same way the screens read it: a month
	// outside the record is clamped rather than rejected.
	const raw = (url.searchParams.get('period') ?? 'ytd') as Period;
	if (!PERIODS.includes(raw)) return apiError(`Unknown period "${raw}".`, 400);

	const { period, anchor } = parsePeriodParams(url.searchParams);
	const [flow, base] = await Promise.all([flowData(period, { anchor }), getBaseCurrency()]);

	// flowData works in base-currency MAJOR units as Numbers, because that is
	// what the waterfall draws. Re-expressing them as minor units keeps one money
	// shape across the API — but be honest about what these are: display-grade
	// figures from a pipeline that already rounded, not ledger-grade sums. The
	// per-transaction endpoints are the exact ones.
	const toMoney = (major: number) => money(fromMajor(major, base), base);
	const totals = (four: typeof flow.totals) => ({
		in: toMoney(four.in),
		out: toMoney(four.out),
		saved: toMoney(four.saved),
		kept: toMoney(four.kept)
	});

	return json({
		period,
		caption: flow.caption,
		totals: totals(flow.totals),
		// The window before this one, so a client can draw the same comparison the
		// screens do rather than asking twice and working out which window it just
		// asked for. Null where there is nothing behind this window to compare it
		// with. The group heads are left out: a caller that wants those wants the
		// transactions, which is a different endpoint.
		previous: flow.previous
			? { caption: flow.previous.caption, totals: totals(flow.previous.totals) }
			: null
	});
};
