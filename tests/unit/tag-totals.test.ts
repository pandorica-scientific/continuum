import { describe, expect, it } from 'vitest';
import { normaliseTagName, rollUpTagTotals } from '$lib/server/tags';

describe('normaliseTagName', () => {
	it('trims, lowercases and collapses inner whitespace', () => {
		expect(normaliseTagName('  Renovation   2026 ')).toBe('renovation 2026');
	});

	it('makes differently-cased spellings the same tag', () => {
		expect(normaliseTagName('Renovation')).toBe(normaliseTagName('renovation'));
	});
});

describe('rollUpTagTotals', () => {
	const txn = {
		id: 't1',
		amount: -4550n,
		feeMinor: null,
		categoryId: null,
		currency: 'CZK'
	};
	const splits = new Map([
		[
			't1',
			[
				{ id: 's1', amountMinor: -3000n, categoryId: 'groceries', sort: 0 },
				{ id: 's2', amountMinor: -1550n, categoryId: 'household', sort: 1 }
			]
		]
	]);

	it('counts a transaction-level tag over the whole transaction', () => {
		const totals = rollUpTagTotals([txn], splits, {
			transactionTags: [{ transactionId: 't1', tagId: 'reno' }],
			splitTags: []
		});
		expect(totals.get('reno')?.get('CZK')).toBe(-4550n);
	});

	it('counts a split-level tag over only its own line', () => {
		const totals = rollUpTagTotals([txn], splits, {
			transactionTags: [],
			splitTags: [{ splitId: 's1', tagId: 'reno' }]
		});
		expect(totals.get('reno')?.get('CZK')).toBe(-3000n);
	});

	it('counts a transaction once when both it and its split carry the tag', () => {
		const totals = rollUpTagTotals([txn], splits, {
			transactionTags: [{ transactionId: 't1', tagId: 'reno' }],
			splitTags: [{ splitId: 's1', tagId: 'reno' }]
		});
		expect(totals.get('reno')?.get('CZK')).toBe(-4550n);
	});

	it('keeps different tags on the same transaction apart', () => {
		const totals = rollUpTagTotals([txn], splits, {
			transactionTags: [],
			splitTags: [
				{ splitId: 's1', tagId: 'reno' },
				{ splitId: 's2', tagId: 'holiday' }
			]
		});
		expect(totals.get('reno')?.get('CZK')).toBe(-3000n);
		expect(totals.get('holiday')?.get('CZK')).toBe(-1550n);
	});
});
