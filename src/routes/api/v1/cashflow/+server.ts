// SPDX-License-Identifier: AGPL-3.0-or-later
import { apiError, json } from '$lib/server/api/respond';
import { flowData } from '$lib/server/cashflow';
import { parsePeriodParams, PERIODS, type Period } from '$lib/cashflow/period';
import { money } from '$lib/api/serialise';
import { fromMajor } from '$lib/money';
import { getBaseCurrency } from '$lib/server/settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	// Refuses an unknown period rather than falling back to the default, so a
	// client can fix its call once told.
	const raw = (url.searchParams.get('period') ?? 'ytd') as Period;
	if (!PERIODS.includes(raw)) return apiError(`Unknown period "${raw}".`, 400);

	const { period, anchor } = parsePeriodParams(url.searchParams);
	const [flow, base] = await Promise.all([flowData(period, { anchor }), getBaseCurrency()]);

	// Re-expressed as minor units for one money shape across the API, though these
	// are display-grade, already-rounded figures, not ledger-exact sums.
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
		// The prior window, for the same comparison the screens draw. Null when there's
		// nothing before it. Group heads are omitted — that's the transactions endpoint.
		previous: flow.previous
			? { caption: flow.previous.caption, totals: totals(flow.previous.totals) }
			: null
	});
};
