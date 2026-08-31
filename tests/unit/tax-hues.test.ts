// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { countryName, hueTokens } from '$lib/tax-hues';

describe('hueTokens', () => {
	it('gives each jurisdiction one of the measured soft steps first', () => {
		const hues = hueTokens(['CZ', 'DE']);
		expect([...hues.values()]).toEqual(['--series-health-soft', '--series-income-soft']);
	});

	it('assigns the same colour regardless of the order the data arrived in', () => {
		// A jurisdiction that changed colour when an unrelated one was added would
		// make every earlier screenshot of this screen quietly wrong.
		expect(hueTokens(['PL', 'CZ', 'ES']).get('CZ')).toBe(hueTokens(['CZ', 'ES', 'PL']).get('CZ'));
	});

	it('does not spend two tokens on one jurisdiction listed twice', () => {
		expect(hueTokens(['CZ', 'CZ', 'DE']).size).toBe(2);
	});

	it('reaches into the ranked reserve past the measured four', () => {
		const hues = hueTokens(['AT', 'BE', 'CZ', 'DE', 'ES']);
		expect(hues.get('ES')).toBe('--series-r1');
	});

	it('keeps assigning rather than running out', () => {
		const many = Array.from({ length: 12 }, (_, i) => `C${i}`);
		expect(new Set(hueTokens(many).values()).size).toBeGreaterThan(0);
		expect(hueTokens(many).size).toBe(12);
	});
});

describe('countryName', () => {
	it('names a jurisdiction, because a header is read once', () => {
		expect(countryName('CZ')).toBe('Czechia');
		expect(countryName('DE')).toBe('Germany');
	});

	it('tolerates the case and padding the statement stored', () => {
		expect(countryName('  pl  ')).toBe('Poland');
	});

	it('shows an unrecognised code as itself rather than as a blank', () => {
		// `country` is free text on a statement: it is not guaranteed to be ISO.
		expect(countryName('Neverland')).toBe('Neverland');
	});
});
