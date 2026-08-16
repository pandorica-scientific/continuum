import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { computeNetWorth } from '$lib/server/networth';
import { loadRateTable } from '$lib/server/fx/table';
import { panelData } from '$lib/server/overview';
import { getBaseCurrency, getModules } from '$lib/server/settings';
import { normalise, visible } from '$lib/overview/layout';
import { DEFAULT_LAYOUT, PANEL_BOUNDS, panelAvailable } from '$lib/overview/panels';
import type { Period } from '$lib/server/cashflow';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const period: Period = url.searchParams.get('period') === 'month' ? 'month' : 'ytd';

	const [baseCurrency, modules, rows] = await Promise.all([
		getBaseCurrency(),
		getModules(),
		locals.person
			? db
					.select({ overviewLayout: person.overviewLayout })
					.from(person)
					.where(eq(person.id, locals.person.id))
			: Promise.resolve([])
	]);

	// Null means this person has never customised, so they get the default —
	// which is the pre-V2 Overview exactly. An empty array is different: it is
	// someone who removed every panel, and it stays empty.
	const stored = rows[0]?.overviewLayout ?? null;
	const layout = normalise(stored ?? DEFAULT_LAYOUT, PANEL_BOUNDS);
	const shown = visible(layout, (key) => panelAvailable(key, modules));

	// Memoised across panels, not across the request: several panels want the
	// rate table and more than one wants net worth, and this stops them each
	// fetching their own. The (app) layout still computes net worth separately
	// for the sidebar card — load functions run in parallel, so sharing that
	// would need a request-scoped cache this screen has no business adding.
	let netWorthPromise: ReturnType<typeof computeNetWorth> | null = null;
	let ratesPromise: ReturnType<typeof loadRateTable> | null = null;

	const panels = await panelData(
		shown.map((placement) => placement.k),
		{
			baseCurrency,
			period,
			netWorth: () => (netWorthPromise ??= computeNetWorth()),
			rates: () => (ratesPromise ??= loadRateTable())
		}
	);

	return { period, baseCurrency, layout, shown, panels, customised: stored !== null };
};
