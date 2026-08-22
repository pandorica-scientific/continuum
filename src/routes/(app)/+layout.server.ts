// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transaction } from '$lib/server/db/schema';
import { computeNetWorth } from '$lib/server/networth';
import { missingRateCurrencies } from '$lib/server/fx';
import { getHouseholdName, getModules } from '$lib/server/settings';
import { pathDisabled } from '$lib/modules/registry';
import { displayCurrency, formatMinor } from '$lib/money';
import { THEME_COOKIE, themeCookieOptions, themeOrDefault } from '$lib/theme';
import { installFacts } from '$lib/server/system/status';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ url, cookies, locals }) => {
	const modules = await getModules();

	if (pathDisabled(url.pathname, modules)) {
		error(404, 'This module is switched off');
	}

	const [householdLabel, badgeRows, netWorth, install] = await Promise.all([
		getHouseholdName(),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(transaction)
			.where(sql`${transaction.reviewState} = 'needs_review'`),
		computeNetWorth(),
		// Cached after the first call: neither fact can change without a restart.
		installFacts()
	]);

	// Every converted total falls back to face value when a rate is unknown,
	// which is the least-bad arithmetic but silently understates the figure by
	// the size of the rate. Naming the currencies here is what keeps it from
	// being silent, on every screen at once.
	const missingRates = await missingRateCurrencies(netWorth.baseCurrency);
	// Read here rather than in the browser so a dismissed banner is never
	// rendered at all — reading it after hydration made it flash on every load.
	const rateWarningDismissed = cookies.get('continuum_rate_dismissed') ?? null;

	// The person's theme, mirrored into the cookie `app.html` reads before paint.
	// Written on every load rather than only when it changes, so signing in on a
	// second device — or as somebody else on this one — is corrected by the first
	// page rather than by the second.
	const theme = themeOrDefault(locals.person?.theme);
	if (cookies.get(THEME_COOKIE) !== theme) {
		cookies.set(THEME_COOKIE, theme, themeCookieOptions());
	}

	return {
		modules,
		// Carried on every screen, not just Settings: an instance anyone can walk
		// into should say so wherever you are looking, or the state is a surprise.
		householdLabel,
		missingRates,
		rateWarningDismissed,
		netWorth:
			netWorth.totalMinor !== 0n ? formatMinor(netWorth.totalMinor, netWorth.baseCurrency) : null,
		netWorthDelta:
			netWorth.deltaThisMonthMinor !== null
				? formatMinor(netWorth.deltaThisMonthMinor, netWorth.baseCurrency, { signed: true })
				: null,
		netWorthDeltaPositive: (netWorth.deltaThisMonthMinor ?? 0n) >= 0n,
		baseCurrency: displayCurrency(netWorth.baseCurrency),
		importBadge: badgeRows[0].count,
		theme,
		version: install.version,
		runtime: install.runtime
	};
};
