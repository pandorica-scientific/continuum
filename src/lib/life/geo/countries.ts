// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Naming a country, and drawing its flag, from its two letters. Neither is a
 * table (which would go stale and need translating):
 * - NAME comes from `Intl.DisplayNames`, which already knows the awkward ones.
 * - FLAG is arithmetic — the two letters as regional indicator symbols.
 *
 * The map's own dataset names countries too (`geodata/manifest.json`), but
 * those are abbreviated cartographic labels, wrong to print on a card.
 */

/** One instance, not one per call — constructing `Intl.DisplayNames` isn't free. */
let display: Intl.DisplayNames | null = null;

function displayNames(): Intl.DisplayNames | null {
	if (display) return display;
	try {
		display = new Intl.DisplayNames(['en'], { type: 'region' });
		return display;
	} catch {
		// Runtime built without full ICU — fall back to the code itself.
		return null;
	}
}

const ALPHA2 = /^[A-Za-z]{2}$/;

/** "PT" → "Portugal". The code itself where the runtime cannot do better. */
export function countryName(code: string): string {
	if (!ALPHA2.test(code)) return code;
	const upper = code.toUpperCase();
	return displayNames()?.of(upper) ?? upper;
}

/**
 * "PT" → 🇵🇹, by arithmetic on the two letters. Returns empty string (not a
 * placeholder box) for anything that isn't two letters.
 */
export function countryFlag(code: string): string {
	if (!ALPHA2.test(code)) return '';
	return [...code.toUpperCase()]
		.map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
		.join('');
}

/** The flag and the name, as one label: "🇵🇹 Portugal". */
export const countryLabel = (code: string): string =>
	[countryFlag(code), countryName(code)].filter(Boolean).join(' ');
