import { describe, expect, it } from 'vitest';
import { retModel, RETIRE_DEFAULTS, type RetireInputs } from '$lib/retire';

const INPUTS: RetireInputs = {
	liquid: 2_593_900, // cash + portfolio
	contribution: 357_000, // yearly savings
	propertyValue: 14_800_000,
	// Supplied by the shared month-by-month loan engine, sampled yearly.
	mortgageOwedByYear: [
		6_600_000, 6_380_000, 6_150_000, 5_910_000, 5_660_000, 5_400_000, 5_130_000, 4_850_000,
		4_560_000, 4_260_000, 3_950_000, 3_630_000, 3_300_000, 2_960_000, 2_610_000, 2_250_000,
		1_880_000, 1_500_000, 1_110_000, 710_000, 300_000, 0
	],
	monthlyRent: 16_500,
	bornOne: 1989,
	bornTwo: 1992,
	year: 2026
};

describe('retModel', () => {
	it('computes today’s row from the live inputs', () => {
		const model = retModel(INPUTS, { ...RETIRE_DEFAULTS, spend: 60000, swr: 3.5 });
		const today = model.rows[0];
		expect(today.t).toBe(0);
		expect(today.capital).toBe(INPUTS.liquid);
		// 2 593 900 × 3.5% / 12 ≈ 7 565/month
		expect(today.draw).toBeCloseTo((INPUTS.liquid * 0.035) / 12, 0);
		expect(today.pension).toBe(0); // both under pension age
		expect(today.gap).toBeLessThan(0);
	});

	it('compounds capital and amortises the mortgage over time', () => {
		const model = retModel(INPUTS, { ...RETIRE_DEFAULTS, realReturn: 4 });
		const [today, five] = model.rows;
		expect(five.capital).toBeGreaterThan(today.capital * 1.15);
		// equity grows both by appreciation and by mortgage amortisation
		expect(five.equity).toBeGreaterThan(today.equity);
	});

	it('uses the loan-engine balance path instead of reimplementing annual amortisation', () => {
		const model = retModel(
			{ ...INPUTS, propertyValue: 10_000_000, mortgageOwedByYear: [6_000_000, 1_000_000] },
			{ ...RETIRE_DEFAULTS, propertyGrowth: 0 }
		);
		expect(model.rows[0].equity).toBe(4_000_000);
		// The five-year row clamps to the last known engine balance (1m).
		expect(model.rows[1].equity).toBe(9_000_000);
	});

	it('makes contribution and property growth explicit assumptions', () => {
		const flat = retModel(INPUTS, {
			...RETIRE_DEFAULTS,
			contributionGrowth: 0,
			propertyGrowth: 0
		});
		const growing = retModel(INPUTS, {
			...RETIRE_DEFAULTS,
			contributionGrowth: 2,
			propertyGrowth: 2
		});
		expect(growing.rows[1].capital).toBeGreaterThan(flat.rows[1].capital);
		expect(growing.rows[1].equity).toBeGreaterThan(flat.rows[1].equity);
	});

	it('the sell plan moves flat equity into the pot', () => {
		const keep = retModel(INPUTS, { ...RETIRE_DEFAULTS, plan: 'keep' });
		const sell = retModel(INPUTS, { ...RETIRE_DEFAULTS, plan: 'sell' });
		expect(sell.rows[0].draw).toBeGreaterThan(keep.rows[0].draw * 3);
	});

	it('the rent plan adds the actual rent received', () => {
		const keep = retModel(INPUTS, { ...RETIRE_DEFAULTS, plan: 'keep' });
		const rent = retModel(INPUTS, { ...RETIRE_DEFAULTS, plan: 'rent' });
		expect(rent.rows[0].total - keep.rows[0].total).toBeCloseTo(16_500, 5);
	});

	it('pensions switch on at the configured ages', () => {
		const model = retModel(INPUTS, {
			...RETIRE_DEFAULTS,
			pensionOne: 18000,
			pensionTwo: 15000,
			ageOne: 68,
			ageTwo: 68
		});
		const twenty = model.rows[4]; // 2046: ages 57 and 54 → still no pension
		expect(twenty.pension).toBe(0);
	});

	it('a lavish target is honestly never reached', () => {
		const model = retModel(INPUTS, { ...RETIRE_DEFAULTS, spend: 100_000_000 });
		expect(model.fire).toBeNull();
	});

	it('a trivial target is reached immediately', () => {
		const model = retModel(INPUTS, { ...RETIRE_DEFAULTS, spend: 1000, swr: 4 });
		expect(model.fire?.t).toBe(0);
	});

	it('the chart tracks the pot against a constant requirement', () => {
		const model = retModel(INPUTS, { ...RETIRE_DEFAULTS, spend: 60000, swr: 3.5 });
		expect(model.chart).toHaveLength(21);
		const required = (60000 * 12) / 0.035;
		expect(model.chart[0].required).toBeCloseTo(required, 0);
		expect(model.chart[20].pot).toBeGreaterThan(model.chart[0].pot);
	});
});
