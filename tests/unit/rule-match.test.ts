import { describe, expect, it } from 'vitest';
import {
	decideWithRules,
	ruleMatches,
	scoreChanges,
	type Condition,
	type RuleLike
} from '$lib/rules/match';

const THRESHOLD = 0.5;

const rule = (over: Partial<RuleLike> = {}): RuleLike => ({
	id: 'r1',
	enabled: true,
	conditions: [{ field: 'counterparty', op: 'contains', value: 'albert' }] as Condition[],
	categoryId: 'groceries',
	tagIds: [],
	acceptedCount: 20,
	correctedCount: 0,
	createdAt: '2026-01-01',
	...over
});

const row = { counterparty: 'ALBERT PRAHA 4', amountMinor: -45500n, currency: 'CZK' };

describe('ruleMatches', () => {
	it('fails closed for a legacy amount bound until its authored currency is migrated', () => {
		const legacy = rule({
			conditions: [{ field: 'amount', op: 'between', min: '100', max: null }]
		});
		expect(ruleMatches(legacy, { ...row, currency: 'CZK' })).toBe(false);
	});

	it('matches a normalised whole word in the counterparty', () => {
		expect(ruleMatches(rule(), row)).toBe(true);
	});

	it('matches a hand-typed value carrying accents or punctuation', () => {
		// The editor used to store the value with only .toLowerCase(), while the
		// haystack is diacritic-stripped and punctuation-collapsed. Every rule a
		// Czech household would actually write saved, listed, reported a
		// confidence — and never fired. Both sides are folded now, which also
		// repairs the rules already sitting in the database.
		const cases: Array<[string, string]> = [
			['Rohlík', 'ROHLIK.CZ 12345'],
			['Košík', 'KOSIK.CZ'],
			['T-Mobile', 'T-MOBILE CZECH REPUBLIC A.S.'],
			['Česká pošta', 'CESKA POSTA S.P.'],
			['Alza.cz', 'ALZA CZ PRAHA'],
			['ALBERT', 'albert praha 4']
		];
		for (const [needle, counterparty] of cases) {
			const r = rule({ conditions: [{ field: 'counterparty', op: 'contains', value: needle }] });
			expect(ruleMatches(r, { counterparty, amountMinor: -45500n })).toBe(true);
		}
	});

	it('stays whole-word, so short seeded values cannot run wild', () => {
		// "pre", "o2" and "cez" are seeded rules. A substring test would file
		// every PREMIER and EXPRESS under energy.
		const pre = rule({ conditions: [{ field: 'counterparty', op: 'contains', value: 'pre' }] });
		expect(ruleMatches(pre, { counterparty: 'PREMIER SPORT', amountMinor: -1000n })).toBe(false);
		expect(ruleMatches(pre, { counterparty: 'PRE distribuce', amountMinor: -1000n })).toBe(true);
	});

	it('requires every condition to hold', () => {
		const twoConditions = rule({
			conditions: [
				{ field: 'counterparty', op: 'contains', value: 'albert' },
				{ field: 'amount', op: 'between', min: '100000', max: null, currency: 'CZK' }
			]
		});
		expect(ruleMatches(twoConditions, row)).toBe(false); // 455 < 1000
		expect(ruleMatches(twoConditions, { ...row, amountMinor: -200000n })).toBe(true);
	});

	it('compares amounts as magnitudes, so direction does not matter', () => {
		const r = rule({
			conditions: [{ field: 'amount', op: 'between', min: '40000', max: '50000', currency: 'CZK' }]
		});
		expect(ruleMatches(r, { ...row, amountMinor: -45500n, currency: 'CZK' })).toBe(true);
		expect(ruleMatches(r, { ...row, amountMinor: 45500n, currency: 'CZK' })).toBe(true);
	});

	it('does not compare a base-currency amount bound to foreign minor units', () => {
		const r = rule({
			conditions: [{ field: 'amount', op: 'between', min: '40000', max: '50000', currency: 'CZK' }]
		});

		expect(ruleMatches(r, { ...row, amountMinor: 45500n, currency: 'EUR' })).toBe(false);
	});

	it('never matches while disabled', () => {
		expect(ruleMatches(rule({ enabled: false }), row)).toBe(false);
	});

	it('matches a counter-account exactly, ignoring whitespace', () => {
		const r = rule({
			conditions: [{ field: 'counterAccount', op: 'equals', value: '1234567890' }]
		});
		expect(ruleMatches(r, { ...row, counterpartyAccount: '1234 567 890' })).toBe(true);
		expect(ruleMatches(r, { ...row, counterpartyAccount: '9999' })).toBe(false);
	});
});

describe('decideWithRules', () => {
	it('files automatically on one confident match', () => {
		const d = decideWithRules(row, [rule()], THRESHOLD);
		expect(d.kind).toBe('auto');
		expect(d.categoryId).toBe('groceries');
	});

	it('holds an unproven rule for review but still suggests its category', () => {
		const d = decideWithRules(row, [rule({ acceptedCount: 0, correctedCount: 0 })], THRESHOLD);
		expect(d.kind).toBe('review');
		expect(d.categoryId).toBe('groceries');
	});

	it('contests when two rules disagree, suggesting the better supported one', () => {
		const weak = rule({ id: 'r2', categoryId: 'eating-out', acceptedCount: 1, correctedCount: 3 });
		const d = decideWithRules(row, [weak, rule()], THRESHOLD);
		expect(d.kind).toBe('review');
		expect(d.categoryId).toBe('groceries');
		expect(d.reason).toMatch(/disagree/);
		expect(d.matched.map((m) => m.ruleId).sort()).toEqual(['r1', 'r2']);
	});

	it('does not contest when two rules agree on the category', () => {
		const twin = rule({
			id: 'r2',
			conditions: [{ field: 'counterparty', op: 'contains', value: 'praha' }]
		});
		expect(decideWithRules(row, [twin, rule()], THRESHOLD).kind).toBe('auto');
	});

	it('applies tags from every matching rule, whatever the categories', () => {
		const tagOnly = rule({ id: 'r2', categoryId: null, tagIds: ['reno'] });
		const d = decideWithRules(row, [tagOnly, rule()], THRESHOLD);
		expect(d.tagIds).toEqual(['reno']);
		expect(d.kind).toBe('auto');
	});

	it('breaks a tie on condition count, then on age', () => {
		const specific = rule({
			id: 'r2',
			categoryId: 'eating-out',
			conditions: [
				{ field: 'counterparty', op: 'contains', value: 'albert' },
				{ field: 'amount', op: 'between', min: null, max: '100000', currency: 'CZK' }
			]
		});
		expect(decideWithRules(row, [rule(), specific], THRESHOLD).categoryId).toBe('eating-out');
	});

	it('holds a row nothing matches, with no suggestion', () => {
		const d = decideWithRules(
			{ counterparty: 'NOVÝ OBCHOD', amountMinor: -100n },
			[rule()],
			THRESHOLD
		);
		expect(d.kind).toBe('review');
		expect(d.categoryId).toBeNull();
		expect(d.reason).toMatch(/first time/);
	});
});

describe('scoreChanges', () => {
	const matched = [
		{ ruleId: 'r1', categoryId: 'groceries' },
		{ ruleId: 'r2', categoryId: 'eating-out' },
		{ ruleId: 'r3', categoryId: null }
	];

	it('rewards the chosen rule and penalises rules that proposed otherwise', () => {
		expect(scoreChanges(matched, 'groceries')).toEqual([
			{ ruleId: 'r1', accepted: 1, corrected: 0 },
			{ ruleId: 'r2', accepted: 0, corrected: 1 }
		]);
	});

	it('penalises every rule when the human picks a category none proposed', () => {
		expect(scoreChanges(matched, 'energy')).toEqual([
			{ ruleId: 'r1', accepted: 0, corrected: 1 },
			{ ruleId: 'r2', accepted: 0, corrected: 1 }
		]);
	});

	it('scores nothing when no rule had an opinion', () => {
		expect(scoreChanges([{ ruleId: 'r3', categoryId: null }], 'groceries')).toEqual([]);
	});
});
