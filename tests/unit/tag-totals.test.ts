import { describe, expect, it } from 'vitest';
import {
	applyTagDelta,
	convertedTagTotal,
	normaliseTagName,
	rollUpTaggedAmounts,
	rollUpTagTotals
} from '$lib/server/tags';

describe('applyTagDelta', () => {
	it('applies additions and removals by normalized identity without duplicating a tag', () => {
		expect(
			applyTagDelta(['Base', 'Trip'], {
				add: ' base ',
				remove: 'TRIP'
			})
		).toEqual(['Base']);
	});
});

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

	it('keeps each effective amount at its own value date for later FX conversion', () => {
		const datedTxn = {
			...txn,
			bookedAt: '2026-04-02',
			valueDate: '2026-04-01'
		};
		const amounts = rollUpTaggedAmounts([datedTxn], splits, {
			transactionTags: [{ transactionId: 't1', tagId: 'reno' }],
			splitTags: []
		});

		expect(amounts.get('reno')).toEqual([
			{ amountMinor: -3000n, currency: 'CZK', day: '2026-04-01' },
			{ amountMinor: -1550n, currency: 'CZK', day: '2026-04-01' }
		]);
	});

	it('converts tagged amounts at their individual dates instead of converting a bucket today', () => {
		const seen: string[] = [];
		const total = convertedTagTotal(
			[
				{ amountMinor: -100n, currency: 'USD', day: '2026-01-05' },
				{ amountMinor: -100n, currency: 'USD', day: '2026-02-05' }
			],
			'EUR',
			(amount, _from, _to, day) => {
				seen.push(day);
				return day === '2026-01-05' ? amount * 2n : amount * 3n;
			}
		);

		expect(seen).toEqual(['2026-01-05', '2026-02-05']);
		expect(total).toBe(-500n);
	});
});
