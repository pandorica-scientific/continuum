// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which months an account's statements cover, and what an empty one means.
 *
 * Two rules carry the whole shelf and both are easy to get subtly wrong. A
 * FILED box spans, because a real statement says how far it reaches. An EMPTY
 * box never spans, because nothing says whether a hole is one missing quarterly
 * statement or three missing monthly ones — and a ribbon that guessed would
 * draw a rhythm nobody stated.
 */
import { describe, expect, it } from 'vitest';
import {
	coverageDecade,
	coverageRow,
	countGaps,
	decadeStart,
	firstOfMonth,
	lastOfMonth,
	monthsCovered,
	yearsCovered
} from '$lib/statements/coverage';

const TODAY = '2026-08-31';
const stmt = (id: string, periodOn: string, periodEndOn: string | null = null) => ({
	id,
	periodOn,
	periodEndOn
});

describe('month boundaries', () => {
	it('snaps to the days the period columns are allowed to hold', () => {
		expect(firstOfMonth('2026-04-15')).toBe('2026-04-01');
		expect(lastOfMonth('2026-04-15')).toBe('2026-04-30');
		expect(lastOfMonth('2026-02-03')).toBe('2026-02-28');
		// A leap February, which is the one the arithmetic can get wrong.
		expect(lastOfMonth('2028-02-03')).toBe('2028-02-29');
		expect(lastOfMonth('2026-12-09')).toBe('2026-12-31');
	});
});

describe('monthsCovered', () => {
	it('covers both months of a statement running mid-month to mid-month', () => {
		expect(monthsCovered(stmt('a', '2026-04-15', '2026-05-14'))).toEqual(['2026-04', '2026-05']);
	});

	it('covers one month where nothing says otherwise', () => {
		expect(monthsCovered(stmt('a', '2026-04-01'))).toEqual(['2026-04']);
	});

	it('covers a whole quarter', () => {
		expect(monthsCovered(stmt('a', '2026-01-01', '2026-03-31'))).toEqual([
			'2026-01',
			'2026-02',
			'2026-03'
		]);
	});

	it('crosses a year end', () => {
		expect(monthsCovered(stmt('a', '2025-12-01', '2026-01-31'))).toEqual(['2025-12', '2026-01']);
	});
});

describe('coverageRow', () => {
	it('draws a quarterly statement as one box three months wide', () => {
		const boxes = coverageRow([stmt('q', '2026-01-01', '2026-03-31')], 2026, '2026-01-01', TODAY);
		expect(boxes[0]).toEqual({ state: 'filed', startMonth: 0, months: 3, documentIds: ['q'] });
	});

	it('breaks a merge where two statements share a month, so it can offer both', () => {
		const boxes = coverageRow(
			[stmt('a', '2026-04-15', '2026-05-14'), stmt('b', '2026-05-15', '2026-06-14')],
			2026,
			'2026-04-01',
			TODAY
		);
		expect(boxes.filter((b) => b.state === 'filed')).toEqual([
			{ state: 'filed', startMonth: 3, months: 1, documentIds: ['a'] },
			{ state: 'filed', startMonth: 4, months: 1, documentIds: ['a', 'b'] },
			{ state: 'filed', startMonth: 5, months: 1, documentIds: ['b'] }
		]);
	});

	it('never merges empty months — two missing months are two boxes and two gaps', () => {
		const boxes = coverageRow([stmt('a', '2026-01-01', '2026-03-31')], 2026, '2026-01-01', TODAY);
		const gaps = boxes.filter((b) => b.state === 'gap');
		expect(gaps.map((b) => b.startMonth)).toEqual([3, 4, 5, 6]);
		expect(gaps.every((b) => b.months === 1)).toBe(true);
		expect(countGaps(boxes)).toBe(4);
	});

	it('holds the current month as not-arrived while last month is already a gap', () => {
		// August is not over on the 31st in any useful sense; July is.
		const boxes = coverageRow([], 2026, '2026-01-01', TODAY);
		expect(boxes[6].state).toBe('gap');
		expect(boxes[7].state).toBe('not-arrived');
		expect(boxes[8].state).toBe('not-arrived');
	});

	it('leaves the months before the account existed alone rather than calling them gaps', () => {
		const boxes = coverageRow([], 2026, '2026-05-01', TODAY);
		expect(boxes.slice(0, 4).every((b) => b.state === 'before-account')).toBe(true);
		expect(boxes[4].state).toBe('gap');
	});

	it('clips a statement that crosses New Year into the year being drawn', () => {
		const boxes = coverageRow([stmt('x', '2025-12-01', '2026-01-31')], 2026, '2025-12-01', TODAY);
		expect(boxes[0]).toEqual({ state: 'filed', startMonth: 0, months: 1, documentIds: ['x'] });
		expect(boxes[1].state).toBe('gap');
	});

	it('treats an account with no evidence at all as never having existed', () => {
		// Not missing twelve statements — never used.
		const boxes = coverageRow([], 2026, null, TODAY);
		expect(boxes.every((b) => b.state === 'before-account')).toBe(true);
		expect(countGaps(boxes)).toBe(0);
	});

	it('always draws twelve months, whatever it was handed', () => {
		for (const boxes of [
			coverageRow([], 2026, null, TODAY),
			coverageRow([stmt('a', '2026-01-01', '2026-12-31')], 2026, '2026-01-01', TODAY)
		]) {
			expect(boxes.reduce((total, b) => total + b.months, 0)).toBe(12);
		}
	});

	it('does not spin on a period stored backwards', () => {
		// The CHECK constraint refuses one, so this is belt and braces — but a
		// loop that never ends is a worse failure than a wrong box.
		expect(monthsCovered(stmt('a', '2026-06-01', '2026-01-31'))).toEqual(['2026-06']);
	});
});

/**
 * The yearly band, for paper that arrives once a year.
 *
 * A broker's annual report is not a statement that failed to be monthly — it is
 * a different rhythm, and putting it in the twelve-month grid would draw eleven
 * gaps a year for an account that is perfectly up to date.
 */
describe('coverageDecade', () => {
	it('starts a decade on the round year', () => {
		expect(decadeStart(2026)).toBe(2020);
		expect(decadeStart(2020)).toBe(2020);
		expect(decadeStart(2019)).toBe(2010);
	});

	it('covers the years a document spans', () => {
		expect(yearsCovered(stmt('a', '2024-01-01', '2026-12-31'))).toEqual([2024, 2025, 2026]);
		expect(yearsCovered(stmt('a', '2025-01-01', '2025-12-31'))).toEqual([2025]);
	});

	it('fills the year a report covers and calls the ones before it gaps', () => {
		const boxes = coverageDecade(
			[stmt('r', '2025-01-01', '2025-12-31')],
			2020,
			'2023-04-01',
			TODAY
		);
		// 2020–2022 predate the account; 2023 and 2024 are years that ended with
		// no report; 2025 is filed; 2026 onward has not arrived.
		expect(boxes.map((b) => b.state)).toEqual([
			'before-account',
			'before-account',
			'before-account',
			'gap',
			'gap',
			'filed',
			'not-arrived',
			'not-arrived',
			'not-arrived',
			'not-arrived'
		]);
		expect(countGaps(boxes)).toBe(2);
	});

	it('draws a multi-year document as one band', () => {
		const boxes = coverageDecade(
			[stmt('r', '2021-01-01', '2023-12-31')],
			2020,
			'2021-01-01',
			TODAY
		);
		expect(boxes[1]).toEqual({ state: 'filed', startMonth: 1, months: 3, documentIds: ['r'] });
	});

	it('always draws ten years, and clips what falls outside the decade', () => {
		const boxes = coverageDecade(
			[stmt('r', '2019-01-01', '2020-12-31')],
			2020,
			'2019-01-01',
			TODAY
		);
		expect(boxes.reduce((total, b) => total + b.months, 0)).toBe(10);
		expect(boxes[0]).toEqual({ state: 'filed', startMonth: 0, months: 1, documentIds: ['r'] });
	});
});
