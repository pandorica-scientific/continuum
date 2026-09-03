// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { monthlyCells, onceCell, yearlyCells } from '$lib/documents/dossier-cells';
import { coverageRow } from '$lib/statements/coverage';

/**
 * A lane's cells, which are the coverage ribbon's rules with a window in place
 * of a month.
 *
 * The arithmetic is here rather than in the loader because it is the part with
 * edge cases — a two-year window that has ended, a card whose relationship
 * began mid-window — and none of those need a database to state.
 */
describe('dossier cells', () => {
	it('a yearly lane draws one cell per year between first evidence and now', () => {
		const cells = yearlyCells({
			filedYears: new Map([
				[2021, ['a']],
				[2022, ['b']],
				[2023, ['c']],
				[2025, ['d']]
			]),
			firstYear: 2019,
			lastYear: 2026,
			every: 1,
			firstEvidenceYear: 2021,
			thisYear: 2026
		});
		expect(cells.map((c) => c.state)).toEqual([
			'before',
			'before',
			'filed',
			'filed',
			'filed',
			'gap',
			'filed',
			'not-arrived'
		]);
		expect(cells.every((c) => c.span === 1)).toBe(true);
		expect(cells.map((c) => c.label)).toEqual([
			'2019',
			'2020',
			'2021',
			'2022',
			'2023',
			'2024',
			'2025',
			'2026'
		]);
	});

	it('every two years makes two-year cells, and a filing anywhere in one fills it', () => {
		// A technical inspection every two years is ONE cell two columns wide, not
		// two cells one of which is always empty.
		const cells = yearlyCells({
			filedYears: new Map([
				[2021, ['a']],
				[2024, ['b']]
			]),
			firstYear: 2019,
			lastYear: 2026,
			every: 2,
			firstEvidenceYear: 2021,
			thisYear: 2026
		});
		expect(cells.map((c) => [c.label, c.state, c.span])).toEqual([
			['2019–20', 'before', 2],
			['2021–22', 'filed', 2],
			['2023–24', 'filed', 2],
			['2025–26', 'not-arrived', 2]
		]);
	});

	it('a window that has ended with nothing in it is a gap', () => {
		const cells = yearlyCells({
			filedYears: new Map([[2021, ['a']]]),
			firstYear: 2021,
			lastYear: 2026,
			every: 2,
			firstEvidenceYear: 2021,
			thisYear: 2026
		});
		expect(cells.map((c) => c.state)).toEqual(['filed', 'gap', 'not-arrived']);
	});

	it('draws nothing before the relationship began', () => {
		// A car bought in 2021 is not missing an insurance policy for 2019.
		const cells = yearlyCells({
			filedYears: new Map(),
			firstYear: 2019,
			lastYear: 2021,
			every: 1,
			firstEvidenceYear: 2021,
			thisYear: 2026
		});
		expect(cells.map((c) => c.state)).toEqual(['before', 'before', 'gap']);
	});

	it('treats a card with no bound at all as having nothing to be missing', () => {
		const cells = yearlyCells({
			filedYears: new Map(),
			firstYear: 2024,
			lastYear: 2026,
			every: 1,
			firstEvidenceYear: null,
			thisYear: 2026
		});
		expect(cells.every((c) => c.state === 'before')).toBe(true);
	});

	it('a monthly lane reuses the ribbon, spans and all', () => {
		// One quarterly filing is one band three months wide, exactly as the
		// Statements ribbon draws it — the arithmetic is shared, not copied.
		const boxes = coverageRow(
			[{ id: 'q1', periodOn: '2026-01-01', periodEndOn: '2026-03-31' }],
			2026,
			'2026-01-01',
			'2026-06-15'
		);
		const cells = monthlyCells(boxes, 2026);
		expect(cells[0]).toMatchObject({ key: '2026-01', label: 'Jan', state: 'filed', span: 3 });
		expect(cells.find((c) => c.key === '2026-04')?.state).toBe('gap');
		expect(cells.find((c) => c.key === '2026-07')?.state).toBe('not-arrived');
	});

	it('a once lane is one cell, filled or not', () => {
		// A slot: the missing manual is the finding.
		expect(onceCell([]).state).toBe('gap');
		expect(onceCell([]).span).toBe(1);
		expect(onceCell(['a']).state).toBe('filed');
		expect(onceCell(['a']).documentIds).toEqual(['a']);
	});
});
