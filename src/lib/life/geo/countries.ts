// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Naming a country, and drawing its flag, from its two letters.
 *
 * Neither is a table. A list of 250 country names is a list that goes out of
 * date and that somebody has to translate; both of these are already in the
 * platform, on the server and in the browser alike.
 *
 * - The NAME comes from `Intl.DisplayNames`, which ships with the runtime and
 *   knows the awkward ones — Kosovo, Côte d'Ivoire, Eswatini, Timor-Leste —
 *   without being told. It is also what would let the app speak another
 *   language later without a second table being written.
 * - The FLAG is arithmetic: a flag emoji is the country's two letters as
 *   regional indicator symbols, which is a fact about Unicode rather than data
 *   about countries. No image, no sprite sheet, nothing fetched.
 *
 * The map's own dataset names countries too, in `geodata/manifest.json`, but
 * those are cartographic labels — "Bosnia and Herz.", "Dem. Rep. Congo" —
 * abbreviated to fit on a map. They are the wrong thing to print on a card.
 */

/**
 * One instance, not one per call.
 *
 * Constructing an `Intl.DisplayNames` is not free, and a trip list asks for a
 * name per destination per row.
 */
let display: Intl.DisplayNames | null = null;

function displayNames(): Intl.DisplayNames | null {
	if (display) return display;
	try {
		display = new Intl.DisplayNames(['en'], { type: 'region' });
		return display;
	} catch {
		// A runtime built without full ICU. The code itself is a poor name but an
		// honest one, and it is better than a screen that will not render.
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
 * "PT" → 🇵🇹, by arithmetic on the two letters.
 *
 * Returns an empty string rather than a placeholder box for anything that is
 * not two letters: a card with no flag reads fine, and a card with a tofu
 * glyph reads as broken.
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
