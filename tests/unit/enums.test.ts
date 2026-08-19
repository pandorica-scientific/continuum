import { describe, expect, it } from 'vitest';
import { ENUMS, ENUM_COLUMNS, asEnumValue, isEnumValue } from '$lib/enums';
import { SHELVES, EXPIRY_VERBS } from '$lib/documents';
import { DAY_COUNTS } from '$lib/loans';
import { REVIEW_STATES } from '$lib/transactions/filter';

/**
 * The lists the screens use are the lists the database enforces.
 *
 * Three of these were written out by hand beside the schema and had already
 * drifted from it — `REVIEW_STATES` was missing `filed`, and the schema comment
 * for `document.shelf` named eight shelves where the app offered nine. Deriving
 * them removes the drift; this suite is what stops it coming back through a
 * list that cannot be derived, like `SHELVES`, which carries labels too.
 */
describe('the screens and the schema agree', () => {
	it('SHELVES offers exactly the shelves the column accepts', () => {
		expect(SHELVES.map((shelf) => shelf.key)).toEqual([...ENUMS['document.shelf']]);
	});

	it('the derived lists are the schema lists', () => {
		expect(EXPIRY_VERBS).toEqual(ENUMS['document.expiry_verb']);
		expect(DAY_COUNTS).toEqual(ENUMS['loan.day_count']);
		expect(REVIEW_STATES).toEqual(ENUMS['transaction.review_state']);
	});

	it('includes the filed state, which the register could not previously reach', () => {
		expect(REVIEW_STATES).toContain('filed');
	});
});

describe('every constrained column names a list that exists', () => {
	it('has no dangling enum key', () => {
		for (const { table, column, enum: key } of ENUM_COLUMNS) {
			expect(ENUMS[key], `${table}.${column}`).toBeDefined();
			expect(ENUMS[key].length, `${table}.${column}`).toBeGreaterThan(1);
		}
	});

	it('constrains each column once', () => {
		const seen = ENUM_COLUMNS.map(({ table, column }) => `${table}.${column}`);
		expect(new Set(seen).size).toBe(seen.length);
	});
});

describe('narrowing at a boundary', () => {
	it('accepts a value in the set', () => {
		expect(isEnumValue('loan.day_count', 'act/365')).toBe(true);
		expect(asEnumValue('loan.day_count', 'act/365', '30/360')).toBe('act/365');
	});

	it('falls back rather than letting the constraint discover it', () => {
		expect(isEnumValue('loan.day_count', 'act/366')).toBe(false);
		expect(asEnumValue('loan.day_count', 'act/366', '30/360')).toBe('30/360');
	});

	it('rejects what is not a string at all', () => {
		expect(isEnumValue('account.kind', undefined)).toBe(false);
		expect(isEnumValue('account.kind', 3)).toBe(false);
		// A FormData field arrives as File | string; neither may slip through.
		expect(asEnumValue('account.kind', null, 'current')).toBe('current');
	});
});
