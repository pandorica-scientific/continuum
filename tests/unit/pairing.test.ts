import { describe, expect, it } from 'vitest';
import {
	accountKeysMatch,
	canonicalAccountIdentity,
	normaliseAccountKey,
	proposePairs,
	type PairableTx,
	type PairingContext
} from '$lib/server/import/pairing';

const accounts = [
	{ id: 'fio', currency: 'CZK', numberKeys: [normaliseAccountKey('1234567890/2010')] },
	{ id: 'rb', currency: 'CZK', numberKeys: [normaliseAccountKey('98765432/5500')] },
	{ id: 'revolut-czk', currency: 'CZK', numberKeys: [] },
	{
		id: 'mbank',
		currency: 'PLN',
		numberKeys: [normaliseAccountKey('89 1140 2004 0000 3502 9999 0193')]
	}
];

const baseCtx: PairingContext = {
	accounts,
	personNames: ['Jana Nováková'],
	convert: (amount, from, to) => {
		// fixed test rates: 1 PLN = 5.842 CZK
		if (from === 'CZK' && to === 'PLN') return BigInt(Math.round(Number(amount) / 5.842));
		if (from === 'PLN' && to === 'CZK') return BigInt(Math.round(Number(amount) * 5.842));
		return null;
	}
};

function tx(
	partial: Partial<PairableTx> & Pick<PairableTx, 'id' | 'accountId' | 'amountMinor'>
): PairableTx {
	return { bookedAt: '2026-07-14', currency: 'CZK', ...partial };
}

describe('accountKeysMatch', () => {
	it('does not equate the same local number at different Czech banks', () => {
		expect(accountKeysMatch('12345678/0100', '12345678/0300')).toBe(false);
	});

	it('does not accept a longer unrelated account containing the local digits', () => {
		expect(accountKeysMatch('123456/0100', '99123456/0300')).toBe(false);
	});

	it('matches a czech local number against its IBAN form', () => {
		expect(
			accountKeysMatch(
				normaliseAccountKey('93531803/5500'),
				normaliseAccountKey('CZ69 5500 0000 0000 9353 1803')
			)
		).toBe(true);
		expect(canonicalAccountIdentity('93531803/5500')).toBe(
			canonicalAccountIdentity('CZ69 5500 0000 0000 9353 1803')
		);
	});
	it('rejects short or unrelated numbers', () => {
		expect(accountKeysMatch('123', '456')).toBe(false);
		expect(
			accountKeysMatch(normaliseAccountKey('11112222/0100'), normaliseAccountKey('33334444/0300'))
		).toBe(false);
	});

	// The household holds mBank Polska and Revolut accounts. Requiring a Czech
	// identity on both sides meant these never matched: the transfer kept
	// counting as real income and spending, and the import minted a duplicate
	// account rather than recognising the one it already had.
	it('matches a non-Czech national number against its own IBAN', () => {
		expect(
			accountKeysMatch(
				normaliseAccountKey('61 1090 1014 0000 0712 1981 2874'),
				normaliseAccountKey('PL61 1090 1014 0000 0712 1981 2874')
			)
		).toBe(true);
	});

	it('does not equate two different foreign IBANs', () => {
		expect(
			accountKeysMatch(
				normaliseAccountKey('PL61 1090 1014 0000 0712 1981 2874'),
				normaliseAccountKey('PL27 1140 2004 0000 3002 0135 5387')
			)
		).toBe(false);
	});

	it('does not compare a Czech reference as a flat run of digits', () => {
		// The local form reorders the IBAN's fields, so a digit-core comparison
		// would be wrong in both directions.
		expect(
			accountKeysMatch(
				normaliseAccountKey('93531803/5500'),
				normaliseAccountKey('PL69 5500 0000 0000 9353 1803')
			)
		).toBe(false);
	});
});

describe('proposePairs', () => {
	it('tier 1: pairs legs when the counter-account names the other account', () => {
		const pairs = proposePairs(
			[
				tx({
					id: 'out1',
					accountId: 'fio',
					amountMinor: -2000000n,
					counterpartyAccount: '98765432/5500'
				}),
				tx({ id: 'in1', accountId: 'rb', amountMinor: 2000000n, bookedAt: '2026-07-15' })
			],
			baseCtx
		);
		expect(pairs).toEqual([{ outId: 'out1', inId: 'in1', confidence: 'auto' }]);
	});

	it('tier 2: same-amount legs with a household name become a review proposal', () => {
		const pairs = proposePairs(
			[
				tx({ id: 'out1', accountId: 'fio', amountMinor: -500000n, counterparty: 'Nováková, Jana' }),
				tx({ id: 'in1', accountId: 'revolut-czk', amountMinor: 500000n })
			],
			baseCtx
		);
		expect(pairs).toEqual([{ outId: 'out1', inId: 'in1', confidence: 'review' }]);
	});

	it('tier 3: proposes cross-currency pairs for review within tolerance', () => {
		// 1000 CZK → 171.17 PLN at 5.842; statement shows 171.00 PLN (0.1% off)
		const pairs = proposePairs(
			[
				tx({ id: 'out1', accountId: 'fio', amountMinor: -100000n }),
				tx({ id: 'in1', accountId: 'mbank', amountMinor: 17100n, currency: 'PLN' })
			],
			baseCtx
		);
		expect(pairs).toEqual([{ outId: 'out1', inId: 'in1', confidence: 'review' }]);
	});

	it('never pairs two legs of the same account or reuses a leg', () => {
		const pairs = proposePairs(
			[
				tx({
					id: 'a',
					accountId: 'fio',
					amountMinor: -1000n,
					counterpartyAccount: '98765432/5500'
				}),
				tx({ id: 'b', accountId: 'fio', amountMinor: 1000n }),
				tx({ id: 'c', accountId: 'rb', amountMinor: 1000n }),
				tx({ id: 'd', accountId: 'rb', amountMinor: 1000n, bookedAt: '2026-07-16' })
			],
			baseCtx
		);
		expect(pairs).toHaveLength(1);
		expect(pairs[0].outId).toBe('a');
	});

	it('ignores unrelated amounts and distant dates', () => {
		const pairs = proposePairs(
			[
				tx({ id: 'out1', accountId: 'fio', amountMinor: -500000n, counterparty: 'Nováková, Jana' }),
				tx({
					id: 'in1',
					accountId: 'rb',
					amountMinor: 500000n,
					bookedAt: '2026-07-30',
					counterparty: 'Nováková, Jana'
				})
			],
			baseCtx
		);
		expect(pairs).toHaveLength(0);
	});
});
