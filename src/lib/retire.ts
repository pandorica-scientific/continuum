// The retirement projection. Pure and client-safe so every control on the
// screen recomputes it live. All figures are in today's money: returns are
// real, after inflation.
//
// Unlike the design prototype, nothing household-specific is hard-coded: the
// inputs are derived server-side from accounts, the portfolio, loans and
// tenancies, and the assumptions come from settings.

export interface RetireInputs {
	/** liquid capital today (cash + portfolio), major units */
	liquid: number;
	/** yearly contribution (what the household actually saves), major units */
	contribution: number;
	/** total property value today */
	propertyValue: number;
	/** total mortgage owed today */
	mortgageOwed: number;
	/** yearly mortgage payments */
	mortgageYearlyPayment: number;
	/** weighted mortgage rate, e.g. 0.0444 */
	mortgageRate: number;
	/** monthly rent currently received (used for the "rent out" plan) */
	monthlyRent: number;
	/** birth years of the two people (second may equal first) */
	bornOne: number;
	bornTwo: number;
	/** this calendar year */
	year: number;
}

export interface RetireConfig {
	/** monthly spending needed, major units */
	spend: number;
	/** safe withdrawal rate in percent (3 | 3.5 | 4) */
	swr: number;
	/** real annual return in percent (0–8) */
	realReturn: number;
	/** what happens to the flats: keep | rent | sell */
	plan: 'keep' | 'rent' | 'sell';
	pensionOne: number;
	pensionTwo: number;
	ageOne: number;
	ageTwo: number;
}

export const RETIRE_DEFAULTS: RetireConfig = {
	spend: 60000,
	swr: 3.5,
	realReturn: 4,
	plan: 'keep',
	pensionOne: 18000,
	pensionTwo: 18000,
	ageOne: 68,
	ageTwo: 68
};

export interface RetireRow {
	t: number;
	year: number;
	a1: number;
	a2: number;
	capital: number;
	equity: number;
	draw: number;
	pension: number;
	total: number;
	gap: number;
}

export interface RetireModel {
	rows: RetireRow[];
	fire: RetireRow | null;
	chart: { t: number; pot: number; required: number }[];
}

export function retModel(inputs: RetireInputs, cfg: RetireConfig): RetireModel {
	const r = cfg.realReturn / 100;

	const at = (t: number): RetireRow => {
		let capital = inputs.liquid;
		let contribution = inputs.contribution;
		for (let k = 0; k < t; k++) {
			capital = capital * (1 + r) + contribution;
			contribution *= 1.02; // contributions grow slightly in real terms
		}
		// The mortgage amortises at its own nominal rate against the payments.
		let mortgage = inputs.mortgageOwed;
		for (let k = 0; k < t; k++) {
			mortgage = Math.max(0, mortgage * (1 + inputs.mortgageRate) - inputs.mortgageYearlyPayment);
		}
		// Flats appreciate ~2% a year in real terms.
		const equity = inputs.propertyValue * Math.pow(1.02, t) - mortgage;
		const pot = capital + (cfg.plan === 'sell' ? equity : 0);
		const draw = (pot * (cfg.swr / 100)) / 12;
		const rent = cfg.plan === 'rent' ? inputs.monthlyRent : 0;
		const a1 = inputs.year + t - inputs.bornOne;
		const a2 = inputs.year + t - inputs.bornTwo;
		const pension =
			(a1 >= cfg.ageOne ? cfg.pensionOne : 0) + (a2 >= cfg.ageTwo ? cfg.pensionTwo : 0);
		const total = draw + rent + pension;
		return {
			t,
			year: inputs.year + t,
			a1,
			a2,
			capital,
			equity,
			draw,
			pension,
			total,
			gap: total - cfg.spend
		};
	};

	let fire: RetireRow | null = null;
	for (let t = 0; t <= 40 && fire === null; t++) {
		if (at(t).total >= cfg.spend) fire = at(t);
	}

	const required = (cfg.spend * 12) / (cfg.swr / 100);
	const chart = Array.from({ length: 21 }, (_, t) => {
		const row = at(t);
		return { t, pot: row.capital + (cfg.plan === 'sell' ? row.equity : 0), required };
	});

	return { rows: [0, 5, 10, 15, 20].map(at), fire, chart };
}
