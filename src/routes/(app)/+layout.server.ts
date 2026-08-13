import { error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transaction } from '$lib/server/db/schema';
import { getBaseCurrency, getHouseholdName, getModules } from '$lib/server/settings';
import { pathDisabled } from '$lib/modules/registry';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ url }) => {
	const modules = await getModules();

	if (pathDisabled(url.pathname, modules)) {
		error(404, 'This module is switched off');
	}

	const [householdLabel, baseCurrency, badgeRows] = await Promise.all([
		getHouseholdName(),
		getBaseCurrency(),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(transaction)
			.where(sql`${transaction.reviewState} = 'needs_review'`)
	]);

	return {
		modules,
		householdLabel,
		// Net worth becomes real once accounts and assets carry balances.
		netWorth: null as string | null,
		netWorthDelta: null as string | null,
		netWorthDeltaPositive: true,
		baseCurrency: baseCurrency === 'CZK' ? 'Kč' : baseCurrency,
		importBadge: badgeRows[0].count
	};
};
