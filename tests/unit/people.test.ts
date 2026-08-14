import { describe, expect, it } from 'vitest';
import { BIRTH_YEAR_ERROR, EARLIEST_BIRTH_YEAR, initialsFor, parseBirthYear } from '$lib/people';

const now = new Date('2026-08-14T12:00:00Z');

describe('initialsFor', () => {
	it('takes the first letter of the first two words', () => {
		expect(initialsFor('Jana Nováková')).toBe('JN');
		expect(initialsFor('Petr Novák')).toBe('PN');
	});

	it('caps at two letters however many names there are', () => {
		expect(initialsFor('Anna Maria Nováková')).toBe('AM');
	});

	it('handles a single word and stray whitespace', () => {
		expect(initialsFor('Robert')).toBe('R');
		expect(initialsFor('  Jana   Nováková  ')).toBe('JN');
	});
});

describe('parseBirthYear', () => {
	it('accepts a plausible year', () => {
		expect(parseBirthYear('1988', now)).toBe(1988);
	});

	it('treats a blank field as not given', () => {
		expect(parseBirthYear('', now)).toBeNull();
		expect(parseBirthYear('   ', now)).toBeNull();
	});

	// inputmode="numeric" is a keyboard hint, not a constraint, so these all
	// reach the server. Before this guard they became NaN and Postgres rejected
	// the insert with a 500 instead of a message the admin could act on.
	it('rejects anything that is not a whole number', () => {
		expect(parseBirthYear('nineteen', now)).toBe('invalid');
		expect(parseBirthYear('19 88', now)).toBe('invalid');
		expect(parseBirthYear('1988.5', now)).toBe('invalid');
		expect(parseBirthYear('NaN', now)).toBe('invalid');
	});

	it('rejects years outside a human lifetime', () => {
		expect(parseBirthYear(String(EARLIEST_BIRTH_YEAR - 1), now)).toBe('invalid');
		expect(parseBirthYear('2027', now)).toBe('invalid');
	});

	it('accepts the boundaries themselves', () => {
		expect(parseBirthYear(String(EARLIEST_BIRTH_YEAR), now)).toBe(EARLIEST_BIRTH_YEAR);
		expect(parseBirthYear('2026', now)).toBe(2026);
	});

	it('names the bound it enforces in the message', () => {
		expect(BIRTH_YEAR_ERROR).toContain(String(EARLIEST_BIRTH_YEAR));
	});
});
