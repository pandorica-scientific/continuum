// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { groupKeyFor, groupReviewRows, takeGroups } from '$lib/import/review-groups';

const row = (over: Partial<Parameters<typeof groupKeyFor>[0]> & { id: string }) => ({
	merchant: 'Somewhere',
	amountKey: '-100',
	...over
});

describe('what makes two queued rows the same payee', () => {
	it('prefers the destination account number, which survives a renaming', () => {
		// The printed name moves around between statements; the account it went
		// to does not. Two ČS rows a month apart, named differently.
		const a = groupKeyFor(
			row({
				id: 'a',
				counterparty: 'MSD CZECH REPUBLIC S',
				counterpartyAccount: '721-77628031/0710'
			})
		);
		const b = groupKeyFor(
			row({ id: 'b', counterparty: 'Dr. Robert Kiewisz', counterpartyAccount: '721-77628031/0710' })
		);
		expect(a).toBe(b);
	});

	it('ignores spacing in an account number', () => {
		expect(groupKeyFor(row({ id: 'a', counterpartyAccount: '721-776 28031/0710' }))).toBe(
			groupKeyFor(row({ id: 'b', counterpartyAccount: '721-77628031/0710' }))
		);
	});

	it('folds case and accents in a name', () => {
		expect(groupKeyFor(row({ id: 'a', counterparty: 'ALBERT VAM DEKUJE' }))).toBe(
			groupKeyFor(row({ id: 'b', counterparty: 'Albert vám děkuje' }))
		);
	});

	it('refuses to group on a name too short to be an identity', () => {
		// The ledger really holds counterparties called "1" and "2" — a bank
		// code the reader mistook for a name. Grouping on those would collect
		// unrelated payments under a heading that says nothing.
		expect(groupKeyFor(row({ id: 'a', counterparty: '1' }))).toBeNull();
		expect(groupKeyFor(row({ id: 'b', counterparty: '12' }))).toBeNull();
		expect(groupKeyFor(row({ id: 'c', counterparty: '', merchant: '' }))).toBeNull();
	});

	it('still groups those rows when they share an account number', () => {
		// Which is exactly the case in the real queue: two rows named "2", both
		// to 443795834/7950, a month apart.
		expect(
			groupKeyFor(row({ id: 'a', counterparty: '2', counterpartyAccount: '443795834/7950' }))
		).toBe(groupKeyFor(row({ id: 'b', counterparty: '2', counterpartyAccount: '443795834/7950' })));
	});
});

describe('grouping the queue', () => {
	it('puts one payee on one card and keeps the order the rows arrived in', () => {
		const groups = groupReviewRows([
			row({ id: 'r1', merchant: 'Revolut**0299*', counterparty: 'Revolut**0299*' }),
			row({ id: 'r2', merchant: 'Oysho', counterparty: 'OYSHO CHODOV' }),
			row({ id: 'r3', merchant: 'Revolut**0299*', counterparty: 'Revolut**0299*' })
		]);
		expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([['r1', 'r3'], ['r2']]);
		// The group takes the position of its first row, so a ranking the caller
		// already applied is not undone by grouping.
		expect(groups[0].label).toBe('Revolut**0299*');
	});

	it('gives a row that groups with nothing its own single-row card', () => {
		const groups = groupReviewRows([row({ id: 'only', counterparty: 'Kunraticka Stodola' })]);
		expect(groups).toHaveLength(1);
		expect(groups[0].rows).toHaveLength(1);
	});

	it('keys an ungroupable row on its own id, so the each block stays stable', () => {
		const groups = groupReviewRows([
			row({ id: 'a', counterparty: '1' }),
			row({ id: 'b', counterparty: '2' })
		]);
		// Two nameless rows must not collapse into each other.
		expect(groups).toHaveLength(2);
		expect(new Set(groups.map((g) => g.key)).size).toBe(2);
	});

	it('marks a repeated amount, which is what a standing payment looks like', () => {
		const groups = groupReviewRows([
			row({ id: 'jan', counterpartyAccount: '443795834/7950', amountKey: '-1629000' }),
			row({ id: 'feb', counterpartyAccount: '443795834/7950', amountKey: '-1629000' }),
			row({ id: 'odd', counterpartyAccount: '443795834/7950', amountKey: '-5000' })
		]);
		expect([...groups[0].repeated].sort()).toEqual(['feb', 'jan']);
		expect(groups[0].repeated.has('odd')).toBe(false);
	});

	it('marks nothing when every amount in the group differs', () => {
		const groups = groupReviewRows([
			row({ id: 'a', counterparty: 'Revolut**0299*', amountKey: '-150000' }),
			row({ id: 'b', counterparty: 'Revolut**0299*', amountKey: '-300000' })
		]);
		expect(groups[0].repeated.size).toBe(0);
	});

	it('does not call a single row a repeat of itself', () => {
		const groups = groupReviewRows([row({ id: 'a', counterparty: 'Alza.cz' })]);
		expect(groups[0].repeated.size).toBe(0);
	});
});

describe('cutting the queue to a page without splitting a card', () => {
	const group = (id: string, n: number) =>
		Array.from({ length: n }, (_, i) => row({ id: `${id}${i}`, counterparty: `payee ${id}` }));

	it('takes whole groups only', () => {
		const groups = groupReviewRows([...group('a', 2), ...group('b', 2), ...group('c', 2)]);
		// A budget of 5 would cut group c in half, so c is left for next time.
		const taken = takeGroups(groups, 5);
		expect(taken.map((g) => g.rows.length)).toEqual([2, 2]);
	});

	it('takes everything when it fits', () => {
		const groups = groupReviewRows([...group('a', 2), ...group('b', 2)]);
		expect(takeGroups(groups, 50)).toHaveLength(2);
	});

	it('always returns at least one group, even one bigger than the budget', () => {
		// A single payee with sixty queued rows must not empty the screen.
		const groups = groupReviewRows(group('a', 60));
		const taken = takeGroups(groups, 50);
		expect(taken).toHaveLength(1);
		expect(taken[0].rows).toHaveLength(60);
	});

	it('returns nothing for nothing', () => {
		expect(takeGroups([], 50)).toEqual([]);
	});
});
