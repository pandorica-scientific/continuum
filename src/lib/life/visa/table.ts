// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a passport needs to get in, as of one stated day.
 *
 * **The date is the only promise this file makes.** Visa policy changes on a
 * government's timetable and nothing here can know when; what the app can do is
 * say exactly how old its answer is and tell the household to check. Every
 * screen that shows a position prints `VISA_AS_OF` beside it, read from this
 * constant rather than written into a template.
 *
 * ## What is here, and what is deliberately not
 *
 * Coverage is by ISSUING passport, and only for passports this household might
 * hold. A table of every pair on earth is 200 × 200 entries that nobody can
 * check and that would rot silently; a short table that is honest about its
 * edges is worth more than a long one that is confidently wrong.
 *
 * Anything not listed returns `unknown`, which renders as "Look it up" in grey.
 * It never renders as visa-free. That asymmetry is the point: the cost of a
 * wrong "you need a visa" is five minutes, and the cost of a wrong "you do not"
 * is a holiday.
 *
 * Bilateral facts only — no transit rules, no purpose-of-visit rules, no
 * length-of-stay limits, no residence-permit exemptions. A household using this
 * for anything beyond "do we need to start an application" is using it for more
 * than it says.
 */
import type { VisaPosition } from '$lib/life/readiness';

/**
 * The day these positions were last checked, as an ISO day.
 *
 * Bump this ONLY after actually re-reading the sources. A date that moves
 * because a file was edited is worse than an old date honestly stated.
 */
export const VISA_AS_OF = '2026-09-11';

/**
 * Passports the table covers, by ISO 3166-1 alpha-2.
 *
 * A passport outside this list gets `unknown` everywhere, which is correct:
 * this file has never been checked for it.
 */
export const COVERED_PASSPORTS = ['CZ', 'PL', 'SK', 'DE', 'AT', 'GB'] as const;

/**
 * Everything an EU passport enters without a visa.
 *
 * The EU and Schengen area first — free movement, so this is a legal fact
 * rather than a policy that changes — then the visa-waiver destinations that
 * have been stable for years.
 */
const EU_VISA_FREE = [
	// The European Union.
	'AT',
	'BE',
	'BG',
	'HR',
	'CY',
	'CZ',
	'DK',
	'EE',
	'FI',
	'FR',
	'DE',
	'GR',
	'HU',
	'IE',
	'IT',
	'LV',
	'LT',
	'LU',
	'MT',
	'NL',
	'PL',
	'PT',
	'RO',
	'SK',
	'SI',
	'ES',
	'SE',
	// Schengen and EFTA outside the Union.
	'IS',
	'LI',
	'NO',
	'CH',
	// The rest of Europe that an EU passport enters freely.
	'AL',
	'AD',
	'BA',
	'GE',
	'MD',
	'MC',
	'ME',
	'MK',
	'RS',
	'SM',
	'UA',
	'VA',
	'GB',
	'XK',
	// Further afield, long-standing and stable.
	'AR',
	'BR',
	'CA',
	'CL',
	'CO',
	'CR',
	'IL',
	'JP',
	'MY',
	'MX',
	'NZ',
	'PA',
	'PE',
	'KR',
	'SG',
	'ZA',
	'TH',
	'AE',
	'UY',
	'HK',
	'MO',
	'TR',
	'MA',
	'TN',
	'DO',
	'JM'
] as const;

/** Destinations an EU passport can get a visa for at the border. */
const EU_ON_ARRIVAL = ['EG', 'JO', 'NP', 'ID', 'MV', 'LK', 'KH', 'LA', 'TZ', 'KE', 'BH'] as const;

/** Destinations needing one applied for online before travelling. */
const EU_E_VISA = ['AU', 'IN', 'VN', 'KE', 'TR', 'US'] as const;

/**
 * Destinations an EU passport needs a full visa for.
 *
 * Listed explicitly rather than inferred as "everything else": the difference
 * between "we know a visa is needed" and "we have not checked" is exactly what
 * this module exists to preserve.
 */
const EU_REQUIRED = ['RU', 'CN', 'BY', 'DZ', 'NG', 'GH', 'PK', 'SA', 'IR', 'CU', 'AZ'] as const;

/** One passport's positions, as a flat map. Built once at module load. */
function positionsFor(
	visaFree: readonly string[],
	onArrival: readonly string[],
	eVisa: readonly string[],
	required: readonly string[]
): Record<string, VisaPosition> {
	const table: Record<string, VisaPosition> = {};
	// Applied in order of increasing friction, so a destination listed twice
	// takes the stricter reading rather than whichever came last.
	for (const code of visaFree) table[code] = 'visa-free';
	for (const code of onArrival) table[code] = 'on-arrival';
	for (const code of eVisa) table[code] = 'e-visa';
	for (const code of required) table[code] = 'required';
	return table;
}

const EU = positionsFor(EU_VISA_FREE, EU_ON_ARRIVAL, EU_E_VISA, EU_REQUIRED);

/**
 * Passport country → destination country → position.
 *
 * The five EU passports share one table because they share one policy: this is
 * not five copies, it is one fact referenced five times.
 *
 * A British passport points at the same table, and that is a deliberate
 * simplification rather than a claim the two are identical. For TOURISM the
 * reach is the same; what differs since leaving the Union is how long somebody
 * may stay in the Schengen area, which is a question about duration that this
 * table does not model at all. Splitting the table would imply it did. The
 * caption's "check before you travel" carries the rest, and a household that
 * needs the duration rule needs a border agency rather than this app.
 */
export const VISA_TABLE: Readonly<Record<string, Readonly<Record<string, VisaPosition>>>> = {
	CZ: EU,
	PL: EU,
	SK: EU,
	DE: EU,
	AT: EU,
	GB: EU
};
