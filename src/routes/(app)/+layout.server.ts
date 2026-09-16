// SPDX-License-Identifier: AGPL-3.0-or-later
import { error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person, transaction } from '$lib/server/db/schema';
import { computeNetWorth } from '$lib/server/networth';
import { missingRateCurrencies } from '$lib/server/fx';
import { getHouseholdName, getModules } from '$lib/server/settings';
import { pathDisabled } from '$lib/modules/registry';
import { personHues } from '$lib/people';
import { displayCurrency, formatMinor } from '$lib/money';
import { THEME_COOKIE, themeCookieOptions, themeOrDefault } from '$lib/theme';
import { installFacts } from '$lib/server/system/status';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ url, cookies, locals }) => {
	const modules = await getModules();

	if (pathDisabled(url.pathname, modules)) {
		error(404, 'This module is switched off');
	}

	const [householdLabel, badgeRows, netWorth, install, household] = await Promise.all([
		getHouseholdName(),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(transaction)
			.where(sql`${transaction.reviewState} = 'needs_review'`),
		computeNetWorth(),
		// Cached after the first call: neither fact can change without a restart.
		installFacts(),
		db.select({ id: person.id, name: person.name }).from(person)
	]);

	// Assigned over the whole household so a person's colour is the same on every screen.
	const hues = personHues(household.map((p) => p.id));

	// A converted total falls back to face value when a rate is unknown; naming
	// the missing currencies keeps that from being silent.
	const missingRates = await missingRateCurrencies(netWorth.baseCurrency);
	// Read here rather than in the browser so a dismissed banner never flashes after hydration.
	const rateWarningDismissed = cookies.get('continuum_rate_dismissed') ?? null;

	// Mirrored into the cookie app.html reads before paint; written on every load
	// so signing in as someone else (or on another device) is corrected immediately.
	const theme = themeOrDefault(locals.person?.theme);
	if (cookies.get(THEME_COOKIE) !== theme) {
		cookies.set(THEME_COOKIE, theme, themeCookieOptions());
	}

	// Sidebar shows the signed-in person, in the same hue their payslips/statements use elsewhere.
	const signedInId = locals.person?.id ?? null;
	const signedIn = locals.person
		? {
				name: locals.person.name,
				initials: locals.person.initials,
				hue: (signedInId ? hues.get(signedInId) : null) ?? '--fg3'
			}
		: null;

	return {
		modules,
		signedIn,
		// Shown on every screen, not just Settings, so a shared instance is identifiable everywhere.
		householdLabel,
		// `householdPeople`, not `people`: several screens load a `people` of their
		// own and SvelteKit merges page data over layout data, so the shared list
		// needs a name a page cannot shadow.
		householdPeople: household.map((p) => ({
			id: p.id,
			name: p.name,
			hue: hues.get(p.id) ?? '--fg3'
		})),
		missingRates,
		rateWarningDismissed,
		netWorth:
			netWorth.totalMinor !== 0n ? formatMinor(netWorth.totalMinor, netWorth.baseCurrency) : null,
		netWorthDelta:
			netWorth.deltaThisMonthMinor !== null
				? formatMinor(netWorth.deltaThisMonthMinor, netWorth.baseCurrency, { signed: true })
				: null,
		netWorthDeltaPositive: (netWorth.deltaThisMonthMinor ?? 0n) >= 0n,
		// How big this month is against the biggest month on record. The pill in
		// the sidebar fills to it; see `deltaShareOfBiggest`.
		netWorthDeltaShare: netWorth.deltaShare,
		baseCurrency: displayCurrency(netWorth.baseCurrency),
		importBadge: badgeRows[0].count,
		theme,
		version: install.version,
		runtime: install.runtime
	};
};
