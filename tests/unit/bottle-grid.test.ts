// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The type chips above the bottle grid.
 *
 * Derived from the rows that exist, never from the enum — a chip for a type
 * nothing is filed under is a filter that leads to an empty screen.
 */
import { describe, expect, it } from 'vitest';
import { CHIPS_SHOWN, splitChips, typeChips, typeWord } from '$lib/life/collections/types';
import type { EnumValue } from '$lib/enums';

const cellar = (...types: EnumValue<'bottle.type'>[]) => types.map((type) => ({ type }));

describe('which chips exist', () => {
	it('shows one chip for a cellar of one type', () => {
		const chips = typeChips(cellar('wine', 'wine', 'wine'));
		expect(chips).toEqual([{ type: 'wine', label: 'Wine', count: 3 }]);
		expect(splitChips(chips).hidden).toEqual([]);
	});

	it('never offers a type nothing is filed under', () => {
		const chips = typeChips(cellar('gin'));
		expect(chips.map((chip) => chip.type)).toEqual(['gin']);
	});

	it('has nothing to say about an empty cellar', () => {
		expect(typeChips([])).toEqual([]);
	});

	it('puts the commonest first', () => {
		const chips = typeChips(cellar('gin', 'wine', 'wine', 'whisky', 'wine', 'whisky'));
		expect(chips.map((chip) => chip.type)).toEqual(['wine', 'whisky', 'gin']);
	});

	// Otherwise the row reshuffles itself between two loads of the same cellar.
	it('breaks a tie on the word, not on the order they arrived', () => {
		const chips = typeChips(cellar('whisky', 'gin', 'beer'));
		expect(chips.map((chip) => chip.label)).toEqual(['Beer', 'Gin', 'Whisky']);
	});
});

describe('the row, when there are too many', () => {
	it('keeps every chip while they fit', () => {
		const chips = typeChips(cellar('wine', 'whisky', 'gin', 'beer'));
		const { shown, hidden } = splitChips(chips);
		expect(shown).toHaveLength(4);
		expect(hidden).toEqual([]);
	});

	it('collapses the rest behind the dashed chip', () => {
		const chips = typeChips(
			cellar('wine', 'whisky', 'gin', 'beer', 'rum', 'cognac', 'liqueur', 'bourbon', 'champagne')
		);
		const { shown, hidden } = splitChips(chips);
		expect(shown).toHaveLength(CHIPS_SHOWN);
		expect(hidden).toHaveLength(5);
		// The ones behind the chip are the least common, never the first four.
		expect(shown.map((chip) => chip.type)).not.toContain(hidden[0].type);
	});
});

describe('what a type is called', () => {
	it('says it the way a person would', () => {
		expect(typeWord('wine')).toBe('Wine');
		expect(typeWord('champagne')).toBe('Champagne');
		expect(typeWord('other')).toBe('Other');
	});
});
