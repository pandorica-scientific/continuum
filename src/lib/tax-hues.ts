// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Which fill a jurisdiction is drawn in, and what it is called.

/**
 * The four measured soft steps, then the ranked reserve.
 *
 * Assigned by order of appearance in the data rather than from a fixed country
 * table: a household that starts filing in Portugal should not need this file
 * edited. The soft four were measured together for colour-vision separation
 * (see scratch-workspace/v0.4.3/soft-token-contrast.md); past them the reserve
 * takes over, ranked as it is for the category palette.
 */
const SOFT = [
	'--series-health-soft',
	'--series-income-soft',
	'--series-bills-soft',
	'--series-taxes-soft'
] as const;

const RESERVE = ['--series-r1', '--series-r2', '--series-r3', '--series-r4'] as const;

const PALETTE = [...SOFT, ...RESERVE];

/**
 * Stable across loads, because the codes are sorted before they are assigned.
 * A jurisdiction that changed colour when an unrelated one was added would make
 * every earlier screenshot of this screen quietly wrong.
 */
export function hueTokens(countries: string[]): Map<string, string> {
	const sorted = [...new Set(countries)].sort();
	return new Map(sorted.map((code, i) => [code, PALETTE[i % PALETTE.length]]));
}

/**
 * A jurisdiction's readable name.
 *
 * Codes are what the statement stores, but a header row is read once and a name
 * costs nothing. An unrecognised code shows as itself rather than as a blank —
 * `country` is free text on the statement, so it is not guaranteed to be ISO.
 */
export function countryName(code: string): string {
	const trimmed = code.trim().toUpperCase();
	// Intl only knows two-letter regions; anything else is a name already, or a
	// typo the household can see and fix.
	if (!/^[A-Z]{2}$/.test(trimmed)) return code.trim();
	try {
		return new Intl.DisplayNames(['en'], { type: 'region' }).of(trimmed) ?? trimmed;
	} catch {
		return trimmed;
	}
}
