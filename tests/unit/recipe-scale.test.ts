// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The servings scaler.
 *
 * The only arithmetic on the Cookbook and the only thing there that can be
 * wrong in a way somebody notices at the table.
 */
import { describe, expect, it } from 'vitest';
import {
	clampServings,
	formatQuantity,
	MAX_SERVINGS,
	MIN_SERVINGS,
	quantityForInput,
	scaleQuantity,
	servingsLabel
} from '$lib/life/cookbook/scale';

describe('scaling a quantity', () => {
	it('leaves it alone when the servings do not change', () => {
		expect(scaleQuantity('250', 4, 4)).toBe('250');
	});

	it('scales up without inventing decimals', () => {
		// 250 × 6 ÷ 4 is 375, and floating point says 374.99999999999994.
		expect(scaleQuantity('250', 4, 6)).toBe('375');
	});

	it('scales down', () => {
		expect(scaleQuantity('250', 4, 2)).toBe('125');
	});

	it('doubles a decimal to a whole number', () => {
		expect(scaleQuantity('1.5', 2, 4)).toBe('3');
	});

	it('accepts a number as readily as the string Postgres returns', () => {
		expect(scaleQuantity(1.5, 2, 4)).toBe('3');
	});

	// The rule that matters: always from the STORED quantity.
	it('returns to where it started after stepping up and back', () => {
		const stored = '180';
		const upTwice = scaleQuantity(stored, 2, 3);
		expect(upTwice).toBe('270');
		expect(scaleQuantity(stored, 2, 2)).toBe('180');
		// Scaling the displayed value instead would compound its rounding.
		expect(scaleQuantity(upTwice, 3, 2)).toBe('180');
	});
});

describe('a quantity nobody measured', () => {
	it('stays unmeasured', () => {
		expect(scaleQuantity(null, 2, 6)).toBe('');
		expect(scaleQuantity(undefined, 2, 6)).toBe('');
		expect(scaleQuantity('', 2, 6)).toBe('');
	});

	it('stays unmeasured even when the text is not a number', () => {
		expect(scaleQuantity('a handful', 2, 6)).toBe('');
	});
});

describe('fractions, the way a kitchen writes them', () => {
	it('shows a third of an egg as a third', () => {
		expect(scaleQuantity('1', 3, 1)).toBe('⅓');
	});

	it('shows two thirds', () => {
		expect(scaleQuantity('2', 3, 1)).toBe('⅔');
	});

	it('shows a half', () => {
		expect(scaleQuantity('1', 2, 1)).toBe('½');
	});

	it('shows a mixed number', () => {
		expect(scaleQuantity('3', 2, 1)).toBe('1½');
		expect(scaleQuantity('1', 4, 3)).toBe('¾');
	});

	it('shows quarters and eighths', () => {
		expect(formatQuantity(0.25)).toBe('¼');
		expect(formatQuantity(2.125)).toBe('2⅛');
	});

	// No measuring jug has fifths, so rendering one would be arithmetic rather
	// than cooking.
	it('does not invent a fraction nobody can measure', () => {
		expect(formatQuantity(0.2)).toBe('0.2');
	});

	// 374¾ g pretends the scales are better than they are.
	it('keeps a weight whole rather than fractional', () => {
		expect(formatQuantity(374.75)).toBe('374.75');
		expect(formatQuantity(120.5)).toBe('120.5');
		expect(formatQuantity(12.5)).toBe('12½');
	});

	it('never writes a trailing zero', () => {
		expect(formatQuantity(1.5)).toBe('1½');
		expect(formatQuantity(250)).toBe('250');
	});

	it('has nothing to say about nothing', () => {
		expect(formatQuantity(0)).toBe('');
		expect(formatQuantity(Number.NaN)).toBe('');
		expect(formatQuantity(-1)).toBe('');
	});
});

describe('a recipe written for nobody', () => {
	// A servings of zero would divide by zero and show Infinity beside the flour.
	it('is shown as written rather than divided by zero', () => {
		expect(scaleQuantity('250', 0, 4)).toBe('250');
		expect(scaleQuantity('250', 4, 0)).toBe('250');
		expect(scaleQuantity('250', -2, 4)).toBe('250');
	});
});

describe('the stepper', () => {
	it('will not go below one, because one person eating is a real answer', () => {
		expect(clampServings(0)).toBe(MIN_SERVINGS);
		expect(clampServings(-5)).toBe(MIN_SERVINGS);
		expect(clampServings(1)).toBe(1);
	});

	it('stops where cooking becomes catering', () => {
		expect(clampServings(100)).toBe(MAX_SERVINGS);
	});

	it('takes whole people', () => {
		expect(clampServings(3.6)).toBe(4);
	});

	it('says it the way a person would', () => {
		expect(servingsLabel(1)).toBe('1 serving');
		expect(servingsLabel(4)).toBe('4 servings');
	});
});

describe('a quantity going back into the edit form', () => {
	it('drops the scale Postgres pads a numeric out to', () => {
		expect(quantityForInput('500.000')).toBe('500');
		expect(quantityForInput('1.500')).toBe('1.5');
	});

	it('leaves an unmeasured ingredient unmeasured', () => {
		expect(quantityForInput(null)).toBe('');
		expect(quantityForInput('')).toBe('');
		expect(quantityForInput(undefined)).toBe('');
	});

	// Never a kitchen fraction: "½" posted back parses as nothing, and the
	// quantity would empty itself on every save.
	it('stays plain decimal, so what it writes can be posted back', () => {
		expect(quantityForInput('0.500')).toBe('0.5');
		expect(quantityForInput(0.25)).toBe('0.25');
	});
});
