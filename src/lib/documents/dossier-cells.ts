// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A lane's cells: the coverage ribbon's rules, with a window in place of a month.
 *
 * Four states and no fifth, the same four the Statements ribbon draws — filed,
 * a gap, not arrived yet, and before the relationship began. The last is what
 * stops a car bought in 2021 reading as missing five years of insurance, and it
 * is the reason a card carries a bound at all.
 *
 * Pure arithmetic, so the edge cases that actually bite — a two-year window that
 * has ended, a card with no bound — are stated without a database.
 */
import type { CoverageBox } from '$lib/statements/coverage';

/**
 * The ribbon's four words, with `before-account` shortened: a card is not an
 * account, and what it is before is its own beginning.
 */
export type CellState = 'filed' | 'gap' | 'not-arrived' | 'before';

export interface DossierCell {
	/** Stable across a redraw: `2026`, `2026-03`, or `once`. */
	key: string;
	label: string;
	state: CellState;
	/** Empty unless `filled`; more than one where two documents cover a period. */
	documentIds: string[];
	/** How many columns wide. `every` for a yearly lane, a span for a monthly one. */
	span: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2021` alone, or `2021–22` for a window. */
const windowLabel = (start: number, every: number): string =>
	every === 1 ? String(start) : `${start}–${String(start + every - 1).slice(-2)}`;

/**
 * One cell per window of `every` years, from `firstYear` to `lastYear`.
 *
 * Filed when any year in the window holds a document; before when the whole
 * window precedes the relationship; not-arrived when the window reaches the
 * current year; otherwise a gap. A window is judged by its LAST year, so a
 * two-year window still running is not yet a hole.
 */
export function yearlyCells(input: {
	filedYears: Map<number, string[]>;
	firstYear: number;
	lastYear: number;
	every: number;
	/** The year the relationship began, or null when nothing bounds it. */
	firstEvidenceYear: number | null;
	thisYear: number;
}): DossierCell[] {
	const cells: DossierCell[] = [];
	for (let start = input.firstYear; start <= input.lastYear; start += input.every) {
		const end = start + input.every - 1;
		const ids: string[] = [];
		for (let year = start; year <= end; year++) ids.push(...(input.filedYears.get(year) ?? []));

		let state: CellState;
		if (ids.length > 0) state = 'filed';
		// No bound and nothing filed: the card has no relationship to be missing
		// paper from, so every cell is quiet rather than red.
		else if (input.firstEvidenceYear === null || end < input.firstEvidenceYear) state = 'before';
		else if (end >= input.thisYear) state = 'not-arrived';
		else state = 'gap';

		cells.push({
			key: String(start),
			label: windowLabel(start, input.every),
			state,
			documentIds: ids,
			span: input.every
		});
	}
	return cells;
}

/**
 * A monthly lane, from the ribbon's own boxes.
 *
 * `coverageRow` already merges a quarterly filing into one band three months
 * wide and decides every state; this only renames the shape. Reusing it rather
 * than reimplementing is what keeps one answer to "what is a gap".
 */
export function monthlyCells(boxes: CoverageBox[], year: number): DossierCell[] {
	return boxes.map((box) => ({
		key: `${year}-${String(box.startMonth + 1).padStart(2, '0')}`,
		label: MONTHS[box.startMonth] ?? '',
		state: box.state === 'before-account' ? 'before' : box.state,
		documentIds: box.documentIds,
		span: box.months
	}));
}

/**
 * A slot — receipt, warranty, manual — as one cell.
 *
 * Filled or not, with no third state: a thing either has its manual or the
 * manual is the finding. There is no "not arrived yet" for a document that was
 * in the box when the thing was bought.
 */
export function onceCell(documentIds: string[]): DossierCell {
	return {
		key: 'once',
		label: '',
		state: documentIds.length > 0 ? 'filed' : 'gap',
		documentIds,
		span: 1
	};
}
