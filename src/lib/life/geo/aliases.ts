// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the two map datasets call the same country.
 *
 * The world outline comes from world-atlas and the province outlines from
 * Natural Earth, and they do not agree on names. world-atlas writes "Czechia",
 * "Bosnia and Herz." and "Dem. Rep. Congo"; Natural Earth writes "Czech
 * Republic", "Bosnia and Herzegovina" and "Democratic Republic of the Congo".
 * Forty-eight of the 241 differ.
 *
 * Without this table a country silently falls back to scratching as one piece
 * — which does not look like a bug, it looks like a design choice, so nobody
 * reports it. `scripts/fetch-geodata.mjs` therefore FAILS when a name it cannot
 * resolve appears, rather than carrying on.
 *
 * Shared by the build script and the runtime on purpose: two copies of this is
 * two chances for one of them to learn a name the other has not.
 */

/**
 * world-atlas name → Natural Earth `admin` name.
 *
 * Only the ones that actually differ. Twenty-two of them are pure
 * abbreviation — "Is." for "Islands", "St." for "Saint" — and are listed
 * explicitly rather than expanded by a rule, because a rule that rewrote "S."
 * to "South" would also rewrite "S. Sudan" correctly and "St-Martin" wrongly,
 * and a table is a thing you can read.
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
 * Countries the province dataset has no rows for at all.
 *
 * Natural Earth's admin-1 file covers 253 administrations; world-atlas draws a
 * few outlines that are not among them, so their alpha-2 code cannot be read
 * off a province. They scratch as one piece, correctly — there are no province
 * outlines to cut them along — and this is what gives them a code to be
 * recorded as visited under.
 */
export const COUNTRY_CODE_OVERRIDES: Readonly<Record<string, string>> = {
	Palestine: 'PS'
};

/**
 * Regions Natural Earth files under a country that does not control them.
 *
 * Crimea and Sevastopol are recorded with `admin: "Russia"`, which is de facto
 * control rather than sovereignty. They are moved to Ukraine, matching on the
 * English and local spellings both datasets use.
 *
 * Applied at BUILD time, in the trim script, so there is one place to correct
 * and no branch in the runtime. Russia is left with 83 regions.
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
