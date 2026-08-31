// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { computeNetWorth } from '$lib/server/networth';
import { loadRateTable } from '$lib/server/fx/table';
import { panelData } from '$lib/server/overview';
import { expenseSpendingByMonth } from '$lib/server/cashflow/spending';
import { getBaseCurrency, getModules } from '$lib/server/settings';
import { normalise, visible } from '$lib/overview/layout';
import { PANEL_BOUNDS, panelAvailable } from '$lib/overview/panels';
import { latestMonthWithData } from '$lib/server/cashflow';
import { parsePeriodParams } from '$lib/cashflow/period';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const { period, anchor } = parsePeriodParams(url.searchParams);

	// The newest month the record holds, read once. The screen's caption names it
	// — "as of the latest statement" — and it is what the panels anchor to when
	// the URL names no month of its own, so asking twice is how the header and
	// the figures below it come to disagree at a month boundary.
	const [baseCurrency, modules, dataMonth, rows] = await Promise.all([
		getBaseCurrency(),
		getModules(),
		latestMonthWithData(),
		locals.person
			? db
					.select({ overviewLayout: person.overviewLayout })
					.from(person)
					.where(eq(person.id, locals.person.id))
			: Promise.resolve([])
	]);

	// Null means this person has never chosen anything, so the board starts with
	// nothing on it and offers the picker instead of a board nobody asked for.
	// An empty array is a different state that looks the same from here: someone
	// who removed every panel, who has already answered the picker's question
	// and must not be asked it again. Nothing backfills the nulls — everyone
	// already here is shown the picker once and their answer is stored.
	const stored = rows[0]?.overviewLayout ?? null;
	const layout = normalise(stored ?? [], PANEL_BOUNDS);
	const shown = visible(layout, (key) => panelAvailable(key, modules));

	// Memoised across panels, not across the request: several panels want the
	// rate table and more than one wants net worth, and this stops them each
	// fetching their own. The (app) layout still computes net worth separately
	// for the sidebar card — load functions run in parallel, so sharing that
	// would need a request-scoped cache this screen has no business adding.
	let netWorthPromise: ReturnType<typeof computeNetWorth> | null = null;
	let ratesPromise: ReturnType<typeof loadRateTable> | null = null;
	let spendingPromise: ReturnType<typeof expenseSpendingByMonth> | null = null;

	const rates = () => (ratesPromise ??= loadRateTable());
	// The briefing's overspend card and the month-against-its-average panel ask
	// the same question of the whole ledger. Behind one thunk they ask it once,
	// and over the rate table this request has already loaded rather than a
	// second copy of it.
	const spending = () =>
		(spendingPromise ??= rates().then((table) =>
			expenseSpendingByMonth(baseCurrency, { rates: table })
		));

	const panels = await panelData(
		shown.map((placement) => placement.k),
		{
			baseCurrency,
			period,
			// The URL wins when it names a month; otherwise the board reports on
			// the newest month there is data for. Whether that month exists in the
			// record is settled further down, where the bounds are already read.
			anchorMonth: anchor ?? dataMonth,
			netWorth: () => (netWorthPromise ??= computeNetWorth()),
			rates,
			spending,
			actor: locals.person
		}
	);

	return { baseCurrency, dataMonth, layout, panels, firstRun: stored === null };
};
