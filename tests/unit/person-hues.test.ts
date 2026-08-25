import { describe, expect, it } from 'vitest';
import { personHues } from '$lib/people';

// uuidv7 in the order they would have been created.
const FIRST = '019880aa-0000-7000-8000-000000000001';
const SECOND = '019880bb-0000-7000-8000-000000000002';
const THIRD = '019880cc-0000-7000-8000-000000000003';

describe('the colour a person is drawn in', () => {
	it('gives every person their own', () => {
		const hues = personHues([FIRST, SECOND, THIRD]);
		expect(new Set(hues.values()).size).toBe(3);
	});

	// A person who is teal on Salary and purple on Tax is not a tag.
	it('does not depend on the order the household arrives in', () => {
		const one = personHues([FIRST, SECOND, THIRD]);
		const other = personHues([THIRD, FIRST, SECOND]);
		for (const id of [FIRST, SECOND, THIRD]) expect(other.get(id)).toBe(one.get(id));
	});

	// Every earlier screenshot of every screen would otherwise be wrong.
	it('keeps the people already here on the colour they had when one is added', () => {
		const before = personHues([FIRST, SECOND]);
		const after = personHues([FIRST, SECOND, THIRD]);
		expect(after.get(FIRST)).toBe(before.get(FIRST));
		expect(after.get(SECOND)).toBe(before.get(SECOND));
	});

	it('names a CSS token, so the colour follows the theme', () => {
		for (const token of personHues([FIRST, SECOND]).values()) {
			expect(token).toMatch(/^--series-/);
		}
	});

	it('has an answer for a household larger than the palette', () => {
		const many = Array.from({ length: 9 }, (_, i) => `019880${i}0-0000-7000-8000-00000000000${i}`);
		const hues = personHues(many);
		expect(hues.size).toBe(9);
		for (const id of many) expect(hues.get(id)).toMatch(/^--series-/);
	});

	it('is empty for a household with nobody in it', () => {
		expect(personHues([]).size).toBe(0);
	});
});
