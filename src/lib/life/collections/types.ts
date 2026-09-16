// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The type chips above the bottle grid. Derived from the rows that exist,
 * never from the enum — a chip for an empty type would filter to nothing.
 */
import type { EnumValue } from '$lib/enums';

/** How many chips stay on the row before the rest collapse behind `+n`. */
export const CHIPS_SHOWN = 4;

export interface TypeChip {
	type: EnumValue<'bottle.type'>;
	label: string;
	count: number;
}

const WORD: Record<EnumValue<'bottle.type'>, string> = {
	wine: 'Wine',
	champagne: 'Champagne',
	whisky: 'Whisky',
	bourbon: 'Bourbon',
	gin: 'Gin',
	rum: 'Rum',
	beer: 'Beer',
	liqueur: 'Liqueur',
	cognac: 'Cognac',
	other: 'Other'
};

export const typeWord = (type: EnumValue<'bottle.type'>): string => WORD[type] ?? type;

/** One chip per type actually on the shelf, commonest first; ties break on the word. */
export function typeChips(bottles: { type: EnumValue<'bottle.type'> }[]): TypeChip[] {
	// A plain record rather than a Map: this is derived and read, never mutated.
	const counts: Partial<Record<EnumValue<'bottle.type'>, number>> = {};
	for (const one of bottles) counts[one.type] = (counts[one.type] ?? 0) + 1;

	return Object.entries(counts)
		.map(([type, count]) => ({
			type: type as EnumValue<'bottle.type'>,
			label: typeWord(type as EnumValue<'bottle.type'>),
			count: count as number
		}))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Split the chips into the ones on the row and the ones behind `+n`. */
export function splitChips(chips: TypeChip[]): { shown: TypeChip[]; hidden: TypeChip[] } {
	if (chips.length <= CHIPS_SHOWN) return { shown: chips, hidden: [] };
	return { shown: chips.slice(0, CHIPS_SHOWN), hidden: chips.slice(CHIPS_SHOWN) };
}
