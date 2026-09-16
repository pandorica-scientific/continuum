// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the two map datasets call the same country.
 *
 * world-atlas (world outline) and Natural Earth (province outlines) disagree
 * on 48 of 241 country names — e.g. "Czechia" vs "Czech Republic". Without
 * this table a country silently falls back to scratching as one piece, so
 * `scripts/fetch-geodata.mjs` FAILS on an unresolved name instead. Shared by
 * the build script and the runtime so there is one copy to keep current.
 */

/**
 * world-atlas name → Natural Earth `admin` name. Only the ones that differ,
 * listed explicitly rather than by an abbreviation rule (a rule expanding
 * "S." to "South" would break "St-Martin").
 */
export const COUNTRY_NAME_ALIASES: Readonly<Record<string, string>> = {
	'Antigua and Barb.': 'Antigua and Barbuda',
	'Ashmore and Cartier Is.': 'Ashmore and Cartier Islands',
	Bahamas: 'The Bahamas',
	'Bosnia and Herz.': 'Bosnia and Herzegovina',
	'Br. Indian Ocean Ter.': 'British Indian Ocean Territory',
	'British Virgin Is.': 'British Virgin Islands',
	'Cabo Verde': 'Cape Verde',
	'Cayman Is.': 'Cayman Islands',
	'Central African Rep.': 'Central African Republic',
	Congo: 'Republic of the Congo',
	'Cook Is.': 'Cook Islands',
	Czechia: 'Czech Republic',
	"Côte d'Ivoire": 'Ivory Coast',
	'Dem. Rep. Congo': 'Democratic Republic of the Congo',
	'Dominican Rep.': 'Dominican Republic',
	'Eq. Guinea': 'Equatorial Guinea',
	'Faeroe Is.': 'Faroe Islands',
	'Falkland Is.': 'Falkland Islands',
	'Fr. Polynesia': 'French Polynesia',
	'Fr. S. Antarctic Lands': 'French Southern and Antarctic Lands',
	'Guinea-Bissau': 'Guinea Bissau',
	'Heard I. and McDonald Is.': 'Heard Island and McDonald Islands',
	'Hong Kong': 'Hong Kong S.A.R.',
	'Indian Ocean Ter.': 'Indian Ocean Territories',
	Macao: 'Macau S.A.R',
	'Marshall Is.': 'Marshall Islands',
	Micronesia: 'Federated States of Micronesia',
	'N. Cyprus': 'Northern Cyprus',
	'N. Mariana Is.': 'Northern Mariana Islands',
	'Pitcairn Is.': 'Pitcairn Islands',
	'S. Geo. and the Is.': 'South Georgia and the Islands',
	Serbia: 'Republic of Serbia',
	'Solomon Is.': 'Solomon Islands',
	'St-Barthélemy': 'Saint Barthelemy',
	'St-Martin': 'Saint Martin',
	'St. Kitts and Nevis': 'Saint Kitts and Nevis',
	'St. Pierre and Miquelon': 'Saint Pierre and Miquelon',
	'St. Vin. and Gren.': 'Saint Vincent and the Grenadines',
	'São Tomé and Principe': 'Sao Tome and Principe',
	Tanzania: 'United Republic of Tanzania',
	'Timor-Leste': 'East Timor',
	'Turks and Caicos Is.': 'Turks and Caicos Islands',
	'U.S. Virgin Is.': 'United States Virgin Islands',
	'W. Sahara': 'Western Sahara',
	'Wallis and Futuna Is.': 'Wallis and Futuna',
	eSwatini: 'Swaziland',
	Åland: 'Aland'
};

/**
 * Countries with no province rows at all in Natural Earth's admin-1 file, so
 * their alpha-2 code can't be read off a province. They scratch as one piece.
 */
export const COUNTRY_CODE_OVERRIDES: Readonly<Record<string, string>> = {
	Palestine: 'PS'
};

/**
 * Regions Natural Earth files under a country that does not control them.
 * Crimea and Sevastopol are recorded as `admin: "Russia"` (de facto control,
 * not sovereignty) and moved to Ukraine here, at build time.
 */
export const REGION_ADMIN_OVERRIDES: readonly {
	from: string;
	to: string;
	names: readonly string[];
}[] = [
	{
		from: 'Russia',
		to: 'Ukraine',
		names: ['Crimea', 'Krym', 'Respublika Krym', 'Sevastopol', "Sevastopol'", 'Sevastopol City']
	}
];

/** The Natural Earth `admin` name for a world-atlas country name. */
export const adminNameFor = (worldAtlasName: string): string =>
	COUNTRY_NAME_ALIASES[worldAtlasName] ?? worldAtlasName;

/**
 * Where Natural Earth's `region` is still not the administrative region a
 * person names, even after the build dissolves provinces onto it.
 *
 * The United Kingdom: Natural Earth splits Scotland/Wales into NUTS-2
 * statistical regions rather than the twelve everyone actually names.
 * Spain: Ceuta and Melilla are autonomous cities, not communities, and too
 * small to scratch — `null` drops them from the map entirely.
 *
 * Keyed by Natural Earth `admin` name, then `region`. Unlisted regions keep their name.
 */
export const REGION_GROUPS: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
	'United Kingdom': {
		// The four Scottish NUTS-2 regions, back into the country they are.
		Eastern: 'Scotland',
		'Highlands and Islands': 'Scotland',
		'North Eastern': 'Scotland',
		'South Western': 'Scotland',
		// Both Welsh ones, likewise.
		'East Wales': 'Wales',
		'West Wales and the Valleys': 'Wales',
		// Named as the statistics office writes them rather than as a person does.
		East: 'East of England',
		'Greater London': 'London'
	},
	Spain: {
		Ceuta: null,
		Melilla: null
	}
};

/**
 * The administrative region a Natural Earth `region` belongs to, or null when
 * it is not drawn at all.
 */
export function regionGroupFor(admin: string, region: string): string | null {
	const groups = REGION_GROUPS[admin];
	if (!groups || !(region in groups)) return region;
	return groups[region];
}
