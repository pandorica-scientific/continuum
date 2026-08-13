import { error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transaction } from '$lib/server/db/schema';
import { computeNetWorth } from '$lib/server/networth';
import { getHouseholdName, getModules } from '$lib/server/settings';
import { pathDisabled } from '$lib/modules/registry';
import { displayCurrency, formatMinor } from '$lib/money';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ url }) => {
	const modules = await getModules();

	if (pathDisabled(url.pathname, modules)) {
		error(404, 'This module is switched off');
	}

	const [householdLabel, badgeRows, netWorth] = await Promise.all([
		getHouseholdName(),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(transaction)
			.where(sql`${transaction.reviewState} = 'needs_review'`),
		computeNetWorth()
	]);

	return {
		modules,
		householdLabel,
		netWorth:
			netWorth.totalMinor !== 0n ? formatMinor(netWorth.totalMinor, netWorth.baseCurrency) : null,
		netWorthDelta:
			netWorth.deltaThisMonthMinor !== null
				? formatMinor(netWorth.deltaThisMonthMinor, netWorth.baseCurrency, { signed: true })
				: null,
		netWorthDeltaPositive: (netWorth.deltaThisMonthMinor ?? 0n) >= 0n,
		baseCurrency: displayCurrency(netWorth.baseCurrency),
		importBadge: badgeRows[0].count
	};
};
