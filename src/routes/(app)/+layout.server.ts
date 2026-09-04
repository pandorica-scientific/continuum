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

	// Loaded on the LAYOUT rather than per screen, because a person's colour has
	// to be assigned over the whole household to be the same everywhere. A screen
	// computing it from the people it happens to show would give a household of
	// two different colours on a page where only one of them appears.
	const hues = personHues(household.map((p) => p.id));

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

	// Who is signed in, with their colour. The sidebar's foot used to show the
	// HOUSEHOLD's initial in a grey disc, which said nothing a person could not
	// already see in the line beside it; v0.8.1 puts the person there, in the
	// same hue every screen already tags their payslips and statements with.
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
		// Carried on every screen, not just Settings: an instance anyone can walk
		// into should say so wherever you are looking, or the state is a surprise.
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
