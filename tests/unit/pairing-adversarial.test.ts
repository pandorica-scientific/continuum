import { describe, expect, it } from 'vitest';
import {
	nameTokens,
	normaliseAccountKey,
	proposePairs,
	type PairableTx,
	type PairingContext
} from '$lib/server/import/pairing';

// The eight adversarial scenarios from the pairing review: substring name
// hits, greedy matching, order dependence, and the fee false-negative.

const accounts = [
	{ id: 'fio-r', currency: 'CZK', numberKeys: [normaliseAccountKey('1234567890/2010')] },
	{ id: 'fio-k', currency: 'CZK', numberKeys: [normaliseAccountKey('2500834780/2010')] },
	{ id: 'revolut', currency: 'CZK', numberKeys: [] },
	{ id: 'mbank', currency: 'PLN', numberKeys: [] }
];

const ctx: PairingContext = {
	accounts,
	personNames: ['Robert Kiewisz', 'Kseniya Ustinova'],
	convert: () => null
};

let seq = 0;
function tx(
	partial: Partial<PairableTx> & Pick<PairableTx, 'accountId' | 'amountMinor'>
): PairableTx {
	return { id: `t${seq++}`, bookedAt: '2026-07-14', currency: 'CZK', ...partial };
}

describe('name-evidence pairing is review-only and word-bounded', () => {
	it('1. a supplier containing a household name no longer auto-pairs', () => {
		const out = tx({
			accountId: 'fio-r',
			amountMinor: -300000n,
			counterparty: 'ROBERT BOSCH spol. s r.o.'
		});
		const inn = tx({ accountId: 'fio-k', amountMinor: 300000n, counterparty: 'client payment' });
		const pairs = proposePairs([out, inn], ctx);
		// "robert" is a word match — it may propose, but never silently.
		for (const p of pairs) expect(p.confidence).toBe('review');
	});

	it('2. a bank echoing the payer name pairs as review, not auto', () => {
		const out = tx({
			accountId: 'fio-r',
			amountMinor: -2000000n,
			counterparty: 'Dr. Kiewisz Robert'
		});
		const salary = tx({
			accountId: 'fio-k',
			amountMinor: 2000000n,
			counterparty: 'EMPLOYER s.r.o.'
		});
		const pairs = proposePairs([out, salary], ctx);
		expect(pairs.every((p) => p.confidence === 'review')).toBe(true);
	});

	it('3. short first names like Jan never act as evidence', () => {
		const janCtx: PairingContext = { ...ctx, personNames: ['Jan Novák', 'Eva Nováková'] };
		expect(nameTokens(janCtx.personNames)).not.toContain('jan');
		expect(nameTokens(janCtx.personNames)).not.toContain('eva');
		const out = tx({
			accountId: 'fio-r',
			amountMinor: -100000n,
			counterparty: 'JANACKOVA LEKARNA'
		});
		const inn = tx({ accountId: 'fio-k', amountMinor: 100000n, counterparty: 'REVOLUT**1234*' });
		expect(proposePairs([out, inn], janCtx)).toHaveLength(0);
	});

	it('4. substring inside a longer word is not a match', () => {
		// "kiewisz" inside "KIEWISZOVA" must not hit (word boundary).
		const out = tx({
			accountId: 'fio-r',
			amountMinor: -50000n,
			counterparty: 'KIEWISZOVA GALERIE'
		});
		const inn = tx({ accountId: 'fio-k', amountMinor: 50000n, counterparty: 'shop refund' });
		expect(proposePairs([out, inn], ctx)).toHaveLength(0);
	});
});

describe('deterministic scoring', () => {
	it('5. picks the closest-dated candidate, not the first listed', () => {
		const out = tx({
			accountId: 'fio-r',
			amountMinor: -150000n,
			counterparty: 'Kiewisz Robert',
			bookedAt: '2026-07-14'
		});
		const far = tx({ accountId: 'fio-k', amountMinor: 150000n, bookedAt: '2026-07-12' });
		const near = tx({ accountId: 'fio-k', amountMinor: 150000n, bookedAt: '2026-07-14' });
		const a = proposePairs([out, far, near], ctx);
		const b = proposePairs([near, far, out], ctx);
		expect(a).toEqual(b);
		expect(a[0].inId).toBe(near.id);
	});

	it('6. input order never changes the outcome for equal candidates', () => {
		const out = tx({
			accountId: 'fio-r',
			amountMinor: -100000n,
			counterpartyAccount: '2500834780/2010'
		});
		const in1 = tx({ accountId: 'fio-k', amountMinor: 100000n, bookedAt: '2026-07-14' });
		const in2 = tx({ accountId: 'fio-k', amountMinor: 100000n, bookedAt: '2026-07-14' });
		const a = proposePairs([out, in1, in2], ctx);
		const b = proposePairs([in2, in1, out], ctx);
		expect(a).toEqual(b);
	});

	it('7. a tie between equally good candidates downgrades auto to review', () => {
		const out = tx({
			accountId: 'fio-r',
			amountMinor: -100000n,
			counterpartyAccount: '2500834780/2010'
		});
		const in1 = tx({ accountId: 'fio-k', amountMinor: 100000n, bookedAt: '2026-07-14' });
		const in2 = tx({ accountId: 'fio-k', amountMinor: 100000n, bookedAt: '2026-07-14' });
		const pairs = proposePairs([out, in1, in2], ctx);
		expect(pairs).toHaveLength(1);
		expect(pairs[0].confidence).toBe('review');
	});
});

describe('fees and hard evidence', () => {
	it('8. gross amounts pair across a fee (the Revolut false-negative)', () => {
		// Out leg gross −56.60 (fee 21.17 kept separately); in leg +56.60.
		const out = tx({
			accountId: 'revolut',
			amountMinor: -5660n,
			counterparty: 'To Robert Kiewisz'
		});
		const inn = tx({ accountId: 'fio-r', amountMinor: 5660n, counterparty: 'KIEWISZ ROBERT' });
		const pairs = proposePairs([out, inn], ctx);
		expect(pairs).toHaveLength(1);
	});

	it('tier 1 with unique hard evidence still pairs automatically', () => {
		const out = tx({
			accountId: 'fio-r',
			amountMinor: -2000000n,
			counterpartyAccount: '2500834780/2010'
		});
		const inn = tx({ accountId: 'fio-k', amountMinor: 2000000n, bookedAt: '2026-07-15' });
		const pairs = proposePairs([out, inn], ctx);
		expect(pairs).toEqual([{ outId: out.id, inId: inn.id, confidence: 'auto' }]);
	});
});
