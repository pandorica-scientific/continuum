// SPDX-License-Identifier: AGPL-3.0-or-later
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

// A jurisdiction's readable name, from the one place countries are named.
// Re-exported rather than moved outright: the tax screen asks a hue module for
// the name beside the hue, and both of its callers read it from here.
export { countryName } from './countries';
