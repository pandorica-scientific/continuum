// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	COUNTRY_CODES,
	EU_MEMBERS,
	countryName,
	countryOptions,
	flagEmoji,
	isCountryCode,
	isEuCountry
} from '$lib/countries';

describe('the country list', () => {
	it('is alpha-2 codes, each one once', () => {
		expect(COUNTRY_CODES.length).toBeGreaterThan(240);
		expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
		for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
	});

	it('is sorted, so a code can be found by eye in the source', () => {
		expect([...COUNTRY_CODES]).toEqual([...COUNTRY_CODES].sort());
	});

	it('names every code it holds', () => {
		// A code the platform cannot name would show as itself in the picker,
		// which reads as a bug rather than as a country.
		for (const code of COUNTRY_CODES) expect(countryName(code)).not.toBe(code);
	});
});

describe('flagEmoji', () => {
	it('spells the code in regional indicators', () => {
		expect(flagEmoji('CZ')).toBe('\u{1F1E8}\u{1F1FF}');
		expect(flagEmoji('PL')).toBe('\u{1F1F5}\u{1F1F1}');
	});

	it('reads a code however it was cased or spaced', () => {
		expect(flagEmoji('cz')).toBe(flagEmoji('CZ'));
		expect(flagEmoji(' cz ')).toBe(flagEmoji('CZ'));
	});

	it('gives nothing for what is not a code', () => {
		// Nothing, rather than a placeholder glyph: the chip beside it already
		// says the country, and a tofu box says the app is broken.
		expect(flagEmoji('Czechia')).toBe('');
		expect(flagEmoji('C')).toBe('');
		expect(flagEmoji('')).toBe('');
		expect(flagEmoji(null)).toBe('');
		expect(flagEmoji(undefined)).toBe('');
	});
});

describe('isCountryCode', () => {
	it('accepts two letters in any case and nothing else', () => {
		expect(isCountryCode('CZ')).toBe(true);
		expect(isCountryCode(' cz ')).toBe(true);
		expect(isCountryCode('CZE')).toBe(false);
		expect(isCountryCode('')).toBe(false);
		expect(isCountryCode(null)).toBe(false);
	});
});

describe('countryOptions', () => {
	it('offers every country, sorted by the name a person reads', () => {
		const options = countryOptions();
		expect(options.length).toBe(COUNTRY_CODES.length);
		expect(options.map((o) => o.name)).toEqual(
			[...options.map((o) => o.name)].sort((a, b) => a.localeCompare(b))
		);
		expect(options.find((o) => o.code === 'CZ')?.name).toBe('Czechia');
	});
});

describe('the European Union', () => {
	it('is twenty-seven countries, all of them real codes', () => {
		expect(EU_MEMBERS.size).toBe(27);
		for (const code of EU_MEMBERS) expect(COUNTRY_CODES).toContain(code);
	});

	it('agrees with the card artwork about who is a member', () => {
		// The artwork's manifest marks members too, and drew each one's card with
		// the Union's ring on it. Two lists of the same fact drift the year one
		// changes, so this is the check that says so out loud.
		const manifest = JSON.parse(
			readFileSync('src/lib/assets/doc-placeholders/manifest.json', 'utf8')
		) as { countries: { code: string; eu?: boolean }[] };

		for (const country of manifest.countries) {
			expect(isEuCountry(country.code)).toBe(Boolean(country.eu));
		}
	});

	it('reads a code however it was cased or spaced, and refuses what is not one', () => {
		expect(isEuCountry('cz')).toBe(true);
		expect(isEuCountry(' PL ')).toBe(true);
		expect(isEuCountry('GB')).toBe(false);
		expect(isEuCountry('UA')).toBe(false);
		expect(isEuCountry('Czechia')).toBe(false);
		expect(isEuCountry(null)).toBe(false);
	});
});
