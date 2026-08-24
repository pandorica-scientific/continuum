import { describe, expect, it } from 'vitest';
import {
	detectPeriod,
	extractCandidates,
	parsePrintedAmount,
	payslipEditCurrency,
	pickGross,
	pickNet,
	salaryStats
} from '$lib/salary';

describe('payslipEditCurrency', () => {
	it('retains the stored currency after the household base changes', () => {
		expect(payslipEditCurrency('EUR', 'CZK')).toBe('EUR');
		expect(payslipEditCurrency(null, 'CZK')).toBe('CZK');
	});
});

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
