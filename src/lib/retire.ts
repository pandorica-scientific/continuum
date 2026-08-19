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
	/**
	 * Total mortgage balance sampled at yearly horizons by the shared
	 * month-by-month loan engine. The final value carries forward if the
	 * supplied horizon is shorter than the retirement model's.
	 */
	mortgageOwedByYear: number[];
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
	/** real annual growth of contributions in percent */
	contributionGrowth: number;
	/** real annual property appreciation in percent */
	propertyGrowth: number;
	/** what happens to the flats: keep | rent | sell */
	plan: 'keep' | 'rent' | 'sell';
	pensionOne: number;
	pensionTwo: number;
	ageOne: number;
	ageTwo: number;
}

// The form and the save action share these, so an input cannot offer a value
// the server will refuse. The page autosaves, which makes a rejected snapshot
// far more costly than a normal submit: it stays in the form and refuses every
// later edit until it is corrected.
export const MIN_RETIREMENT_AGE = 50;
export const MAX_RETIREMENT_AGE = 100;

/** Field names as the person sees them, so a refusal can name the right one. */
export const RETIRE_LABELS = {
	spend: 'Monthly spending',
	swr: 'Withdrawal rate',
	realReturn: 'Real return',
	contributionGrowth: 'Contribution growth',
	propertyGrowth: 'Property growth',
	pensionOne: 'Pension',
	pensionTwo: 'Pension',
	ageOne: 'Retirement age',
	ageTwo: 'Retirement age'
} as const;

export const RETIRE_DEFAULTS: RetireConfig = {
	spend: 60000,
	swr: 3.5,
	realReturn: 4,
	contributionGrowth: 2,
	propertyGrowth: 2,
	plan: 'keep',
	pensionOne: 18000,
	pensionTwo: 18000,
	ageOne: 68,
	ageTwo: 68
};

interface RetireRow {
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

interface RetireModel {
	rows: RetireRow[];
	fire: RetireRow | null;
	chart: { t: number; pot: number; required: number }[];
}

export function retModel(inputs: RetireInputs, cfg: RetireConfig): RetireModel {
	const r = cfg.realReturn / 100;
	const contributionGrowth = cfg.contributionGrowth / 100;
	const propertyGrowth = cfg.propertyGrowth / 100;

	const at = (t: number): RetireRow => {
		let capital = inputs.liquid;
		let contribution = inputs.contribution;
		for (let k = 0; k < t; k++) {
			capital = capital * (1 + r) + contribution;
			contribution *= 1 + contributionGrowth;
		}
		const mortgage = inputs.mortgageOwedByYear[t] ?? inputs.mortgageOwedByYear.at(-1) ?? 0;
		const equity = inputs.propertyValue * Math.pow(1 + propertyGrowth, t) - mortgage;
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
