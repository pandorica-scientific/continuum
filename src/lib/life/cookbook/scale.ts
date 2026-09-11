// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Rescaling a recipe for the number of people actually eating.
 *
 * The only arithmetic on the Cookbook, and the only thing here that can be
 * wrong in a way somebody notices at the table. So it is pure, it is tested
 * first, and the component around it is markup.
 *
 * Two rules the rest of the file exists to keep:
 *
 * 1. **Always compute from the stored quantity**, never from what is currently
 *    on screen. Scaling from the displayed value compounds its rounding, so
 *    stepping 2 → 3 → 2 would not come back to where it started.
 * 2. **A quantity nobody measured stays unmeasured.** "A splash of milk" has a
 *    null quantity, and inventing 1.5 splashes for six people would be the app
 *    pretending to a precision the recipe never had.
 */

/**
 * The fractions a kitchen actually uses.
 *
 * Halves, thirds, quarters, sixths and eighths — the divisions of a measuring
 * spoon and of an egg. Fifths and sevenths are absent because no measuring jug
 * has them, so rendering 0.2 as a fifth would be arithmetic rather than
 * cooking.
 */
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

/**
 * Above this, a fraction is noise.
 *
 * "375 g" is what a person weighs out; "374¾ g" is a number pretending the
 * scales are better than they are. Below it — eggs, spoons, cups — the
 * fraction is the whole point.
 */
const FRACTION_CEILING = 100;

/** How close a value must be to a fraction before it is shown as one. */
const FRACTION_TOLERANCE = 0.02;

/** Render a number the way a recipe would write it. */
export function formatQuantity(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return '';

	// Near enough to a whole number IS a whole number. Floating point turns
	// 250 × 6 ÷ 4 into 374.99999999999994 often enough to matter.
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

	// Not a kitchen fraction: two decimals at most, and no trailing zeros — a
	// recipe says 1.5, never 1.50.
	return String(Math.round(value * 100) / 100);
}

/**
 * One ingredient's quantity, scaled from the servings it was written for.
 *
 * `quantity` arrives as the string Postgres returns for `numeric`, or as a
 * number, or as null. Null and anything unparseable come back as an empty
 * string: the row still renders, with its unit and its name, and the household
 * reads "a splash of milk" exactly as it wrote it.
 */
export function scaleQuantity(
	quantity: string | number | null | undefined,
	from: number,
	to: number
): string {
	if (quantity === null || quantity === undefined || quantity === '') return '';

	const value = typeof quantity === 'number' ? quantity : Number(quantity);
	if (!Number.isFinite(value)) return '';

	// A recipe written for nobody cannot be scaled, so it is shown as written
	// rather than divided by zero.
	if (!Number.isFinite(from) || from <= 0) return formatQuantity(value);
	if (!Number.isFinite(to) || to <= 0) return formatQuantity(value);

	return formatQuantity((value * to) / from);
}

/**
 * The stored quantity, as it belongs in a text box.
 *
 * Postgres hands back `numeric` at its full scale — "500.000" — which is not
 * what anybody typed and not what they want to edit. Plain decimal, never a
 * kitchen fraction: `formatQuantity` would write "½", and posting that back
 * would parse as nothing and quietly empty the quantity.
 */
export function quantityForInput(quantity: string | number | null | undefined): string {
	if (quantity === null || quantity === undefined || quantity === '') return '';
	const value = typeof quantity === 'number' ? quantity : Number(quantity);
	if (!Number.isFinite(value)) return '';
	return String(value);
}

/**
 * What the stepper allows.
 *
 * One is a real answer — somebody cooking for themselves — and beyond about two
 * dozen a household is catering rather than cooking, at which point the recipe
 * is not the thing that needs to change.
 */
export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 24;

export const clampServings = (servings: number): number =>
	Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(servings)));

/** "for 4" / "for 1" — said the way a person would. */
export const servingsLabel = (servings: number): string =>
	servings === 1 ? '1 serving' : `${servings} servings`;
