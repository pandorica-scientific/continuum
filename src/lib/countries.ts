// SPDX-License-Identifier: AGPL-3.0-or-later
// Countries, as codes rather than as names.

/**
 * ISO 3166-1 alpha-2, every currently assigned code.
 *
 * Codes only. The names come from `Intl.DisplayNames`, which the browser and
 * Node both already ship and both keep current — a table of names written here
 * would be a translation nobody maintains and a rename nobody notices.
 *
 * The list itself has to be written down because there is no `Intl` API that
 * enumerates regions: `Intl.supportedValuesOf` covers calendars, currencies and
 * time zones, and not this.
 */
export const COUNTRY_CODES: readonly string[] = [
	'AD',
	'AE',
	'AF',
	'AG',
	'AI',
	'AL',
	'AM',
	'AO',
	'AQ',
	'AR',
	'AS',
	'AT',
	'AU',
	'AW',
	'AX',
	'AZ',
	'BA',
	'BB',
	'BD',
	'BE',
	'BF',
	'BG',
	'BH',
	'BI',
	'BJ',
	'BL',
	'BM',
	'BN',
	'BO',
	'BQ',
	'BR',
	'BS',
	'BT',
	'BV',
	'BW',
	'BY',
	'BZ',
	'CA',
	'CC',
	'CD',
	'CF',
	'CG',
	'CH',
	'CI',
	'CK',
	'CL',
	'CM',
	'CN',
	'CO',
	'CR',
	'CU',
	'CV',
	'CW',
	'CX',
	'CY',
	'CZ',
	'DE',
	'DJ',
	'DK',
	'DM',
	'DO',
	'DZ',
	'EC',
	'EE',
	'EG',
	'EH',
	'ER',
	'ES',
	'ET',
	'FI',
	'FJ',
	'FK',
	'FM',
	'FO',
	'FR',
	'GA',
	'GB',
	'GD',
	'GE',
	'GF',
	'GG',
	'GH',
	'GI',
	'GL',
	'GM',
	'GN',
	'GP',
	'GQ',
	'GR',
	'GS',
	'GT',
	'GU',
	'GW',
	'GY',
	'HK',
	'HM',
	'HN',
	'HR',
	'HT',
	'HU',
	'ID',
	'IE',
	'IL',
	'IM',
	'IN',
	'IO',
	'IQ',
	'IR',
	'IS',
	'IT',
	'JE',
	'JM',
	'JO',
	'JP',
	'KE',
	'KG',
	'KH',
	'KI',
	'KM',
	'KN',
	'KP',
	'KR',
	'KW',
	'KY',
	'KZ',
	'LA',
	'LB',
	'LC',
	'LI',
	'LK',
	'LR',
	'LS',
	'LT',
	'LU',
	'LV',
	'LY',
	'MA',
	'MC',
	'MD',
	'ME',
	'MF',
	'MG',
	'MH',
	'MK',
	'ML',
	'MM',
	'MN',
	'MO',
	'MP',
	'MQ',
	'MR',
	'MS',
	'MT',
	'MU',
	'MV',
	'MW',
	'MX',
	'MY',
	'MZ',
	'NA',
	'NC',
	'NE',
	'NF',
	'NG',
	'NI',
	'NL',
	'NO',
	'NP',
	'NR',
	'NU',
	'NZ',
	'OM',
	'PA',
	'PE',
	'PF',
	'PG',
	'PH',
	'PK',
	'PL',
	'PM',
	'PN',
	'PR',
	'PS',
	'PT',
	'PW',
	'PY',
	'QA',
	'RE',
	'RO',
	'RS',
	'RU',
	'RW',
	'SA',
	'SB',
	'SC',
	'SD',
	'SE',
	'SG',
	'SH',
	'SI',
	'SJ',
	'SK',
	'SL',
	'SM',
	'SN',
	'SO',
	'SR',
	'SS',
	'ST',
	'SV',
	'SX',
	'SY',
	'SZ',
	'TC',
	'TD',
	'TF',
	'TG',
	'TH',
	'TJ',
	'TK',
	'TL',
	'TM',
	'TN',
	'TO',
	'TR',
	'TT',
	'TV',
	'TW',
	'TZ',
	'UA',
	'UG',
	'UM',
	'US',
	'UY',
	'UZ',
	'VA',
	'VC',
	'VE',
	'VG',
	'VI',
	'VN',
	'VU',
	'WF',
	'WS',
	'YE',
	'YT',
	'ZA',
	'ZM',
	'ZW'
];

/**
 * The European Union, as of this release.
 *
 * Written down because there is no `Intl` answer to "is this country in the
 * EU": it is a political fact, not a locale one. Twenty-seven codes, and the
 * list changes about once a decade — a member joining or leaving is a one-line
 * edit here, and `tests/unit/countries` checks it against the card artwork's
 * own manifest so the two cannot drift apart quietly.
 */
export const EU_MEMBERS: ReadonlySet<string> = new Set([
	'AT',
	'BE',
	'BG',
	'CY',
	'CZ',
	'DE',
	'DK',
	'EE',
	'ES',
	'FI',
	'FR',
	'GR',
	'HR',
	'HU',
	'IE',
	'IT',
	'LT',
	'LU',
	'LV',
	'MT',
	'NL',
	'PL',
	'PT',
	'RO',
	'SE',
	'SI',
	'SK'
]);

/** Whether a country's documents carry the Union's mark alongside its own. */
export function isEuCountry(code: string | null | undefined): boolean {
	return EU_MEMBERS.has((code ?? '').trim().toUpperCase());
}

/** Two upper-case letters, which is the only shape anything here understands. */
export function isCountryCode(value: string | null | undefined): boolean {
	return /^[A-Z]{2}$/.test((value ?? '').trim().toUpperCase());
}

/**
 * A country's readable name.
 *
 * An unrecognised code shows as itself rather than as a blank: `country` also
 * arrives from bank statements, where it is free text and not guaranteed to be
 * ISO at all.
 */
export function countryName(code: string): string {
	// Intl only knows two-letter regions; anything else is a name already, or a
	// typo the household can see and fix.
	if (!isCountryCode(code)) return code.trim();
	const trimmed = code.trim().toUpperCase();
	try {
		return new Intl.DisplayNames(['en'], { type: 'region' }).of(trimmed) ?? trimmed;
	} catch {
		return trimmed;
	}
}

/**
 * The flag, as the two regional indicator symbols the code spells.
 *
 * No sprite sheet, no SVG per country, nothing to add when a household files
 * paper from somewhere the set of card artwork does not cover: the font already
 * has every flag, and a platform that draws the letters instead still says
 * which country it is.
 */
export function flagEmoji(code: string | null | undefined): string {
	if (!isCountryCode(code)) return '';
	const trimmed = (code ?? '').trim().toUpperCase();
	const BASE = 0x1f1e6; // REGIONAL INDICATOR SYMBOL LETTER A
	return String.fromCodePoint(
		...[...trimmed].map((letter) => BASE + letter.charCodeAt(0) - 'A'.charCodeAt(0))
	);
}

/** Every country, named and sorted, for a picker. */
export function countryOptions(): { code: string; name: string }[] {
	return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
		a.name.localeCompare(b.name)
	);
}
