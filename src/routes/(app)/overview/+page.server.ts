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

	// The newest month with data, read once — reused for both the caption and
	// the panels' default anchor so they can't disagree at a month boundary.
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

	// Null means never chosen (offer the picker); an empty array means every
	// panel was deliberately removed (do not ask again) — the two must stay distinct.
	const stored = rows[0]?.overviewLayout ?? null;
	const layout = normalise(stored ?? [], PANEL_BOUNDS);
	const shown = visible(layout, (key) => panelAvailable(key, modules));

	// Memoised across panels (not across the request — the sidebar's net worth
	// is computed separately, since load functions run in parallel).
	let netWorthPromise: ReturnType<typeof computeNetWorth> | null = null;
	let ratesPromise: ReturnType<typeof loadRateTable> | null = null;
	let spendingPromise: ReturnType<typeof expenseSpendingByMonth> | null = null;

	const rates = () => (ratesPromise ??= loadRateTable());
	const spending = () =>
		(spendingPromise ??= rates().then((table) =>
			expenseSpendingByMonth(baseCurrency, { rates: table })
		));

	const panels = await panelData(
		shown.map((placement) => placement.k),
		{
			baseCurrency,
			period,
			// The URL wins when it names a month; otherwise the newest month with data.
			anchorMonth: anchor ?? dataMonth,
			netWorth: () => (netWorthPromise ??= computeNetWorth()),
			rates,
			spending
		}
	);

	return { baseCurrency, dataMonth, layout, panels, firstRun: stored === null };
};
