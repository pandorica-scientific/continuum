// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Rescaling a recipe for the number of people actually eating.
 *
 * Two rules: (1) always compute from the stored quantity, never the displayed
 * value — scaling from what's on screen compounds rounding so 2→3→2 wouldn't
 * return to the start. (2) An unmeasured quantity ("a splash of milk") stays
 * unmeasured rather than inventing false precision.
 */

/** The fractions a kitchen actually uses — halves, thirds, quarters, sixths, eighths. */
const KITCHEN_FRACTIONS: [numerator: number, denominator: number, glyph: string][] = [
	[1, 8, '⅛'],
	[1, 6, '⅙'],
	[1, 4, '¼'],
	[1, 3, '⅓'],
	[3, 8, '⅜'],
	[1, 2, '½'],
	[5, 8, '⅝'],
	[2, 3, '⅔'],
	[3, 4, '¾'],
	[5, 6, '⅚'],
	[7, 8, '⅞']
];

/** Above this, a fraction is noise — kitchen scales aren't that precise. */
const FRACTION_CEILING = 100;

/** How close a value must be to a fraction before it is shown as one. */
const FRACTION_TOLERANCE = 0.02;

/** Render a number the way a recipe would write it. */
export function formatQuantity(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return '';

	// Near enough to a whole number IS a whole number — guards floating point drift.
	const rounded = Math.round(value);
	if (Math.abs(value - rounded) < 1e-6) return String(rounded);

	if (value < FRACTION_CEILING) {
		const whole = Math.floor(value);
		const remainder = value - whole;
		for (const [numerator, denominator, glyph] of KITCHEN_FRACTIONS) {
			if (Math.abs(remainder - numerator / denominator) < FRACTION_TOLERANCE) {
				return whole > 0 ? `${whole}${glyph}` : glyph;
			}
		}
	}

	// Two decimals at most, no trailing zeros — "1.5", never "1.50".
	return String(Math.round(value * 100) / 100);
}

/**
 * One ingredient's quantity, scaled from the servings it was written for.
 * `quantity` is the Postgres `numeric` string, a number, or null; null or
 * unparseable comes back as an empty string so "a splash of milk" still reads.
 */
export function scaleQuantity(
	quantity: string | number | null | undefined,
	from: number,
	to: number
): string {
	if (quantity === null || quantity === undefined || quantity === '') return '';

	const value = typeof quantity === 'number' ? quantity : Number(quantity);
	if (!Number.isFinite(value)) return '';

	// A recipe written for nobody cannot be scaled — shown as written, not divided by zero.
	if (!Number.isFinite(from) || from <= 0) return formatQuantity(value);
	if (!Number.isFinite(to) || to <= 0) return formatQuantity(value);

	return formatQuantity((value * to) / from);
}

/**
 * The stored quantity, as it belongs in a text box (Postgres returns
 * `numeric` at full scale, e.g. "500.000"). Plain decimal, never a kitchen
 * fraction — posting "½" back would parse as nothing.
 */
export function quantityForInput(quantity: string | number | null | undefined): string {
	if (quantity === null || quantity === undefined || quantity === '') return '';
	const value = typeof quantity === 'number' ? quantity : Number(quantity);
	if (!Number.isFinite(value)) return '';
	return String(value);
}

/** What the stepper allows — 1 (cooking for oneself) to 24 (beyond that is catering). */
export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 24;

export const clampServings = (servings: number): number =>
	Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(servings)));

/** "for 4" / "for 1" — said the way a person would. */
export const servingsLabel = (servings: number): string =>
	servings === 1 ? '1 serving' : `${servings} servings`;
