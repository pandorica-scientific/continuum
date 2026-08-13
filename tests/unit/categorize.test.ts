import { describe, expect, it } from 'vitest';
import { decide, normalise, type RuleLike } from '$lib/server/categorize';

const rules: RuleLike[] = [
	{ id: 'r1', matcherType: 'counterparty', pattern: 'albert', categoryId: 'groceries' },
	{ id: 'r2', matcherType: 'counterparty', pattern: 'netflix', categoryId: 'internet-phone' },
	{
		id: 'r3',
		matcherType: 'counterparty_account',
		pattern: '1001012489/5500',
		categoryId: 'car-loan'
	},
	{ id: 'r4', matcherType: 'variable_symbol', pattern: '9353181662', categoryId: 'other-income' },
	{ id: 'r5', matcherType: 'counterparty', pattern: 'albert benzin', categoryId: 'fuel-tolls' }
];

describe('normalise', () => {
	it('strips diacritics, case and punctuation', () => {
		expect(normalise('ALBERT VÁM DĚKUJE; HR. KRÁLOVÉ')).toBe('albert vam dekuje hr kralove');
	});
});

describe('decide', () => {
	it('matches a merchant rule on normalised text', () => {
		const d = decide(
			{ counterparty: 'ALBERT VAM DEKUJE; HR. KRALOVE; CZE', amountMinor: -100n },
			rules
		);
		expect(d).toMatchObject({ kind: 'auto', categoryId: 'groceries' });
	});

	it('matches exact counter-account rules', () => {
		const d = decide(
			{ counterpartyAccount: '1001012489/5500', counterparty: 'Trvalý příkaz', amountMinor: -100n },
			rules
		);
		expect(d).toMatchObject({ kind: 'auto', categoryId: 'car-loan' });
	});

	it('matches variable-symbol rules', () => {
		const d = decide(
			{ variableSymbol: '9353181662', counterparty: 'ČSSZ', amountMinor: 100n },
			rules
		);
		expect(d).toMatchObject({ kind: 'auto', categoryId: 'other-income' });
	});

	it('surfaces conflicts with a reason instead of guessing', () => {
		const d = decide({ counterparty: 'Albert Benzin Praha', amountMinor: -100n }, rules);
		expect(d.kind).toBe('ambiguous');
		if (d.kind === 'ambiguous') expect(d.reason).toContain('disagree');
	});

	it('surfaces unknown merchants with a first-time reason', () => {
		const d = decide({ counterparty: 'Some New Shop', amountMinor: -100n }, rules);
		expect(d).toMatchObject({ kind: 'ambiguous', reason: 'first time seeing this counterparty' });
	});

	it('flags rows with nothing to match on', () => {
		const d = decide({ amountMinor: -100n }, rules);
		expect(d.kind).toBe('ambiguous');
	});
});
