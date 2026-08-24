import { describe, expect, it } from 'vitest';
import {
	detectPeriod,
	extractCandidates,
	parsePrintedAmount,
	lastBaseIncrease,
	mergeSalaryYears,
	pickGross,
	pickNet,
	salaryStats,
	type SalaryYear
} from '$lib/salary';

describe('parsePrintedAmount', () => {
	it('reads Czech and English printed amounts', () => {
		expect(parsePrintedAmount('45 231,00', 'CZK')).toBe(4523100n);
		expect(parsePrintedAmount('45 231', 'CZK')).toBe(4523100n);
		expect(parsePrintedAmount('45.231', 'CZK')).toBe(4523100n);
		expect(parsePrintedAmount('45231.50', 'CZK')).toBe(4523150n);
		expect(parsePrintedAmount('1 234 567,89', 'CZK')).toBe(123456789n);
	});

	it('reads comma-grouped thousands', () => {
		expect(parsePrintedAmount('45,231.00', 'CZK')).toBe(4523100n);
		expect(parsePrintedAmount('45,231', 'CZK')).toBe(4523100n);
		expect(parsePrintedAmount('1,234,567.89', 'CZK')).toBe(123456789n);
	});
});

describe('extractCandidates', () => {
	const lines = [
		'Hrubá mzda 62 000,00',
		'Zdravotní pojištění 2 790,00',
		'Sociální pojištění 4 340,00',
		'Záloha na daň 6 150,00',
		'K výplatě 45 231,00'
	];

	it('labels each amount with the text before it', () => {
		const candidates = extractCandidates(lines, 'CZK');
		expect(candidates.some((c) => c.label === 'k výplatě' && c.amountMinor === 4523100n)).toBe(
			true
		);
	});

	it('reads an English payslip at full magnitude, not its first four digits', () => {
		// Without a comma-grouped alternative the amount pattern fell through to
		// `\d{1,3}[.,]\d{2}` and matched "45,23" out of "45,231.00", so the slip
		// was filed as 45.23 — a thousandfold error, silently.
		const english = ['Gross pay 62,000.00', 'Tax withheld 16,769.00', 'Net pay 45,231.00'];
		const candidates = extractCandidates(english, 'CZK');
		expect(candidates.some((c) => c.label === 'net pay' && c.amountMinor === 4523100n)).toBe(true);
		expect(extractCandidates(['Take home 1,234,567.89'], 'CZK').at(-1)?.amountMinor).toBe(
			123456789n
		);
	});
});

describe('pickGross and pickNet', () => {
	const slip = [
		'Hrubá mzda 62 000,00',
		'Prémie 8 000,00',
		'Zdravotní pojištění 2 790,00',
		'Sociální pojištění 4 340,00',
		'Záloha na daň 6 150,00',
		'K výplatě 45 231,00'
	];

	it('reads both figures off one Czech slip', () => {
		const c = extractCandidates(slip, 'CZK');
		expect(pickGross(c, null)?.amountMinor).toBe(6200000n);
		expect(pickNet(c, null)?.amountMinor).toBe(4523100n);
	});

	it('reads both figures off an English slip', () => {
		const c = extractCandidates(
			['Gross pay 4,200.00', 'Income tax 812.00', 'Net pay 3,538.00'],
			'EUR'
		);
		expect(pickGross(c, null)?.amountMinor).toBe(420000n);
		expect(pickNet(c, null)?.amountMinor).toBe(353800n);
	});

	it('returns null for the half the slip does not state', () => {
		const netOnly = extractCandidates(['K výplatě 45 231,00'], 'CZK');
		expect(pickGross(netOnly, null)).toBeNull();
		expect(pickNet(netOnly, null)?.amountMinor).toBe(4523100n);

		const grossOnly = extractCandidates(['Hrubá mzda 62 000,00'], 'CZK');
		expect(pickGross(grossOnly, null)?.amountMinor).toBe(6200000n);
		expect(pickNet(grossOnly, null)).toBeNull();
	});

	it('never picks total employment cost as gross', () => {
		// Czech slips print superhrubá mzda ABOVE gross. With the old
		// largest-amount fallback this was the single most likely wrong answer.
		const c = extractCandidates(['Superhrubá mzda 83 080,00', 'K výplatě 45 231,00'], 'CZK');
		expect(pickGross(c, null)).toBeNull();
	});

	it('does not guess when the slip names no pay line at all', () => {
		// No fallback to the largest amount. A null the form can ask about beats
		// a confident wrong number filed silently.
		const c = extractCandidates(['Doprava 1 200,00', 'Stravenky 900,00'], 'CZK');
		expect(pickGross(c, null)).toBeNull();
		expect(pickNet(c, null)).toBeNull();
	});

	it('lets a learned label win over the keywords', () => {
		const c = extractCandidates(['Celkem k úhradě 51 000,00', 'K výplatě 45 231,00'], 'CZK');
		expect(pickNet(c, 'celkem k úhradě')?.amountMinor).toBe(5100000n);
	});

	it('matches a learned label without diacritics', () => {
		const c = extractCandidates(['Celkem k úhradě 51 000,00'], 'CZK');
		expect(pickNet(c, 'celkem k uhrade')?.amountMinor).toBe(5100000n);
	});

	it('matches keywords with or without diacritics', () => {
		const noDiacritics = extractCandidates(['Hruba mzda 62 000,00', 'K vyplate 45 231,00'], 'CZK');
		expect(pickGross(noDiacritics, null)?.amountMinor).toBe(6200000n);
		expect(pickNet(noDiacritics, null)?.amountMinor).toBe(4523100n);
	});

	it('takes the last match when a label repeats, which is the total line', () => {
		const c = extractCandidates(['Hrubá mzda 30 000,00', 'Hrubá mzda 62 000,00'], 'CZK');
		expect(pickGross(c, null)?.amountMinor).toBe(6200000n);
	});
});

// Real payslips are TABLES. extractPdfLines joins a row's cells with spaces, so
// one physical row arrives as one long line carrying several amounts, and every
// amount after the keyword gets a label that still contains it. Taking the last
// match then returns the rightmost COLUMN rather than a total — which read a
// Czech slip's tax column as its gross.
describe('pickGross and pickNet on tabular slips', () => {
	// A real row, cells joined: label, gross, hours header, hours, the employee's
	// social insurance, then the tax.
	const czechRow = 'Hrubá mzda 70 135 hod.vč.přesč. 176 SP zaměstnanec 4 980 Daň 10 530';

	it('takes the amount next to the keyword, not the last one on the row', () => {
		const c = extractCandidates([czechRow], 'CZK');
		expect(pickGross(c, null)?.amountMinor).toBe(7013500n);
	});

	it('reads gross and net off a slip whose every figure shares one row', () => {
		const c = extractCandidates(
			[
				czechRow,
				'Příjmy celkem 70 135 Základ ZP 70 135 ZP firma 6 312 Daň. sleva 2 570 Čistá mzda 54 038'
			],
			'CZK'
		);
		expect(pickGross(c, null)?.amountMinor).toBe(7013500n);
		expect(pickNet(c, null)?.amountMinor).toBe(5403800n);
	});

	it('leaves net at or below gross, which is what made the month recordable', () => {
		// Before this rule the pair came out as gross 10 530 / net 54 038, which
		// recordSalary correctly refused — and the month was dropped in silence.
		const c = extractCandidates(
			[
				czechRow,
				'Příjmy celkem 70 135 Základ ZP 70 135 ZP firma 6 312 Daň. sleva 2 570 Čistá mzda 54 038'
			],
			'CZK'
		);
		const gross = pickGross(c, null)!.amountMinor;
		const net = pickNet(c, null)!.amountMinor;
		expect(net).toBeLessThanOrEqual(gross);
	});

	it('reads an English tabular slip the same way', () => {
		const c = extractCandidates(
			[
				'(1) Empl. rel. 01.10.2025 Gross salary 201 019 AIP bonus 65 251',
				'Time work: full-time job 40:00 Net salary 145 282 Total to pay 145 282'
			],
			'CZK'
		);
		expect(pickGross(c, null)?.amountMinor).toBe(20101900n);
		expect(pickNet(c, null)?.amountMinor).toBe(14528200n);
	});

	it('still falls back to a containing label when nothing sits next to the keyword', () => {
		// Some exporters put the amount a column further along. Better a looser
		// match than no figure at all.
		const c = extractCandidates(['Hrubá mzda za období 62 000,00'], 'CZK');
		expect(pickGross(c, null)?.amountMinor).toBe(6200000n);
	});
});

describe('detectPeriod', () => {
	it('reads numeric, ISO and Czech month forms', () => {
		expect(detectPeriod(['Výplatní páska za období 08/2026'])).toBe('2026-08');
		expect(detectPeriod(['Období: 2026-08'])).toBe('2026-08');
		expect(detectPeriod(['Mzda za srpen 2026'])).toBe('2026-08');
		expect(detectPeriod(['July 2026 payslip'])).toBe('2026-07');
		expect(detectPeriod(['no period here'])).toBeNull();
	});

	it('reads every month name in the table, diacritics included', () => {
		// `\b` is defined over [A-Za-z0-9_], so between a space and "ú" there is
		// no boundary and `\búnor\b` never matched. Nine names failed that way,
		// which quietly removed five months a year from the salary history and
		// the tax prefill.
		const expected: Array<[string, string]> = [
			['leden', '01'],
			['ledna', '01'],
			['únor', '02'],
			['února', '02'],
			['březen', '03'],
			['března', '03'],
			['duben', '04'],
			['dubna', '04'],
			['květen', '05'],
			['května', '05'],
			['červen', '06'],
			['června', '06'],
			['červenec', '07'],
			['července', '07'],
			['srpen', '08'],
			['srpna', '08'],
			['září', '09'],
			['říjen', '10'],
			['října', '10'],
			['listopad', '11'],
			['listopadu', '11'],
			['prosinec', '12'],
			['prosince', '12']
		];
		for (const [name, month] of expected) {
			expect(detectPeriod([`Mzda za ${name} 2026`])).toBe(`2026-${month}`);
			expect(detectPeriod([`MZDA ZA ${name.toUpperCase()} 2026`])).toBe(`2026-${month}`);
		}
	});

	it('does not match a month name inside a longer word', () => {
		expect(detectPeriod(['Zaříznuto 2026'])).toBeNull();
		expect(detectPeriod(['Mayor 2026'])).toBeNull();
	});
});

describe('salaryStats', () => {
	it('averages per year and computes the year-on-year change and age', () => {
		// A payslip states GROSS, so these arrive as gross months.
		const slips = [
			{ periodMonth: '2024-01', grossMinor: 40_000_00n },
			{ periodMonth: '2024-07', grossMinor: 42_000_00n },
			{ periodMonth: '2025-03', grossMinor: 45_100_00n }
		];
		const rows = salaryStats(slips, 1990);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ year: 2024, age: 34, months: 2, avgIsGross: true });
		expect(rows[0].avgMonthlyMinor).toBe(41_000_00n);
		expect(rows[0].deltaPct).toBeNull();
		expect(rows[1].deltaPct).toBeCloseTo(10, 1); // 45 100 vs 41 000
		expect(salaryStats([], null)).toHaveLength(0);
	});

	// The reason the two are kept apart. A payslip is gross, a bank credit is
	// net; averaging them together produces a figure that is neither, and lower
	// than the truth.
	it('keeps gross and net apart, each over the months that have it', () => {
		const rows = salaryStats(
			[
				{ periodMonth: '2026-01', grossMinor: 68_000_00n, netMinor: 52_000_00n },
				{ periodMonth: '2026-02', netMinor: 52_400_00n },
				{ periodMonth: '2026-03', netMinor: 53_000_00n }
			],
			null
		);

		expect(rows[0].grossAvgMinor).toBe(68_000_00n);
		expect(rows[0].grossMonths).toBe(1);
		expect(rows[0].netAvgMinor).toBe(52_466_66n);
		expect(rows[0].netMonths).toBe(3);
	});

	it('reports the gross series when a year has one, and says so', () => {
		const rows = salaryStats(
			[{ periodMonth: '2026-01', grossMinor: 68_000_00n, netMinor: 52_000_00n }],
			null
		);
		expect(rows[0].avgIsGross).toBe(true);
		expect(rows[0].avgMonthlyMinor).toBe(68_000_00n);
	});

	it('falls back to net for a year that only came from the bank', () => {
		const rows = salaryStats([{ periodMonth: '2026-01', netMinor: 52_000_00n }], null);
		expect(rows[0].avgIsGross).toBe(false);
		expect(rows[0].avgMonthlyMinor).toBe(52_000_00n);
		expect(rows[0].grossAvgMinor).toBeNull();
	});

	// Otherwise the year somebody started uploading payslips reports a pay RISE
	// of thirty percent, and the year they stopped reports a cut.
	it('does not compare a gross year against a net one', () => {
		const rows = salaryStats(
			[
				{ periodMonth: '2025-01', netMinor: 52_000_00n },
				{ periodMonth: '2026-01', grossMinor: 68_000_00n }
			],
			null
		);
		expect(rows[0].avgIsGross).toBe(false);
		expect(rows[1].avgIsGross).toBe(true);
		expect(rows[1].deltaPct).toBeNull();
	});

	it('compares like against like across two gross years', () => {
		const rows = salaryStats(
			[
				{ periodMonth: '2025-01', grossMinor: 60_000_00n },
				{ periodMonth: '2026-01', grossMinor: 66_000_00n }
			],
			null
		);
		expect(rows[1].deltaPct).toBeCloseTo(10, 1);
	});

	it('ignores a month carrying neither figure', () => {
		expect(salaryStats([{ periodMonth: '2026-01' }], null)).toHaveLength(0);
		expect(salaryStats([{ periodMonth: '2026-01', grossMinor: null }], null)).toHaveLength(0);
	});
});

describe('mergeSalaryYears', () => {
	const y = (over: Partial<SalaryYear> = {}): SalaryYear => ({
		year: 2025,
		age: null,
		grossAvgMinor: 10000000n,
		netAvgMinor: 7000000n,
		grossTotalMinor: 120000000n,
		bonusTotalMinor: 20000000n,
		baseTotalMinor: 100000000n,
		netTotalMinor: 84000000n,
		grossMonths: 12,
		netMonths: 12,
		netComplete: true,
		baseDeltaPct: null,
		avgMonthlyMinor: 10000000n,
		months: 12,
		avgIsGross: true,
		deltaPct: null,
		...over
	});

	it('adds the household up year by year', () => {
		const merged = mergeSalaryYears([
			[y()],
			[
				y({
					grossTotalMinor: 60000000n,
					baseTotalMinor: 50000000n,
					bonusTotalMinor: 10000000n,
					netTotalMinor: 42000000n
				})
			]
		]);
		expect(merged).toHaveLength(1);
		expect(merged[0].grossTotalMinor).toBe(180000000n);
		expect(merged[0].baseTotalMinor).toBe(150000000n);
		expect(merged[0].bonusTotalMinor).toBe(30000000n);
		expect(merged[0].netTotalMinor).toBe(126000000n);
	});

	it('recomputes the monthly average over the merged months, not by averaging averages', () => {
		// Two people paid very differently for different numbers of months: the
		// mean of their averages is not the household's average month.
		const merged = mergeSalaryYears([
			[y({ grossTotalMinor: 120000000n, grossMonths: 12 })],
			[y({ grossTotalMinor: 20000000n, grossMonths: 2 })]
		]);
		expect(merged[0].grossMonths).toBe(14);
		expect(merged[0].grossAvgMinor).toBe(140000000n / 14n);
	});

	it('keeps a year only one person has', () => {
		const merged = mergeSalaryYears([[y({ year: 2024 })], [y({ year: 2025 })]]);
		expect(merged.map((m) => m.year)).toEqual([2024, 2025]);
	});

	it('calls a year incomplete unless every contributor covered twelve months', () => {
		const merged = mergeSalaryYears([[y()], [y({ netMonths: 3, netComplete: false })]]);
		expect(merged[0].netComplete).toBe(false);
	});

	it('compares base against base across merged years', () => {
		const merged = mergeSalaryYears([
			[y({ year: 2024, baseTotalMinor: 100000000n, grossMonths: 12 })],
			[y({ year: 2025, baseTotalMinor: 110000000n, grossMonths: 12 })]
		]);
		expect(merged[1].baseDeltaPct).toBeCloseTo(10, 1);
	});

	it('returns nothing for a household with nothing recorded', () => {
		expect(mergeSalaryYears([[], []])).toEqual([]);
	});
});

describe('lastBaseIncrease', () => {
	const y = (year: number, baseDeltaPct: number | null): SalaryYear => ({
		year,
		age: null,
		grossAvgMinor: 10000000n,
		netAvgMinor: 7000000n,
		grossTotalMinor: 120000000n,
		bonusTotalMinor: 0n,
		baseTotalMinor: 120000000n,
		netTotalMinor: 84000000n,
		grossMonths: 12,
		netMonths: 12,
		netComplete: true,
		baseDeltaPct,
		avgMonthlyMinor: 10000000n,
		months: 12,
		avgIsGross: true,
		deltaPct: baseDeltaPct
	});

	it('reports the most recent year the base actually rose', () => {
		expect(lastBaseIncrease([y(2023, null), y(2024, 8.2), y(2025, 0)])).toEqual({
			year: 2024,
			pct: 8.2
		});
	});

	it('prefers the newest rise when there are several', () => {
		expect(lastBaseIncrease([y(2023, 5), y(2024, 3), y(2025, 1.5)])).toEqual({
			year: 2025,
			pct: 1.5
		});
	});

	it('ignores a fall', () => {
		// A pay cut is not an increase, and calling the last change an increase
		// would put a red figure under a green label.
		expect(lastBaseIncrease([y(2024, 6), y(2025, -4)])).toEqual({ year: 2024, pct: 6 });
	});

	it('is null when the base has never risen', () => {
		expect(lastBaseIncrease([y(2024, null), y(2025, -2)])).toBeNull();
	});

	it('is null for an empty record', () => {
		expect(lastBaseIncrease([])).toBeNull();
	});

	it('does not read a zero change as a rise', () => {
		expect(lastBaseIncrease([y(2025, 0)])).toBeNull();
	});
});
