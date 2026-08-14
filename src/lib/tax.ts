// Pure arithmetic for the tax-statements screen. Nothing here computes what is
// owed — no brackets, no allowances, no residency. The only calculation is a
// ratio of two figures the user recorded, and grouping them into chart series.

export interface StatementLike {
	personId: string;
	personName: string;
	year: number;
	country: string;
	currency: string;
	grossIncomeMinor: bigint;
	taxPaidMinor: bigint;
}

export interface SeriesPoint {
	year: number;
	grossMinor: bigint;
	taxMinor: bigint;
	ratePct: number | null;
}

export interface Series {
	/** `${personId}|${country}` */
	key: string;
	/** "Jana · CZ" */
	label: string;
	currency: string;
	points: SeriesPoint[];
}

/**
 * Effective rate to two decimal places, or null when gross is zero. The ratio
 * is taken in bigint before converting, so it never passes through a float.
 */
export function effectiveRatePct(grossMinor: bigint, taxMinor: bigint): number | null {
	if (grossMinor === 0n) return null;
	return Number((taxMinor * 10000n) / grossMinor) / 100;
}

/**
 * What the payslips say a person earned in a year. Ownership comes from the
 * document_person join (resolved by the caller), never from a matched name.
 */
export function payslipYearTotal(
	slips: { personId: string; periodMonth: string; amountMinor: bigint | null }[],
	personId: string,
	year: number
): { totalMinor: bigint; months: number } {
	const own = slips.filter(
		(s) =>
			s.personId === personId &&
			s.amountMinor !== null &&
			Number(s.periodMonth.slice(0, 4)) === year
	);
	return {
		totalMinor: own.reduce((sum, s) => sum + (s.amountMinor ?? 0n), 0n),
		months: own.length
	};
}

/** One series per person per country — never merged, never converted. */
export function taxSeries(statements: StatementLike[]): Series[] {
	const byKey = new Map<string, Series>();
	for (const s of statements) {
		const key = `${s.personId}|${s.country}`;
		const series = byKey.get(key) ?? {
			key,
			label: `${s.personName} · ${s.country}`,
			currency: s.currency,
			points: []
		};
		series.points.push({
			year: s.year,
			grossMinor: s.grossIncomeMinor,
			taxMinor: s.taxPaidMinor,
			ratePct: effectiveRatePct(s.grossIncomeMinor, s.taxPaidMinor)
		});
		byKey.set(key, series);
	}
	return [...byKey.values()]
		.map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.year - b.year) }))
		.sort((a, b) => a.label.localeCompare(b.label));
}
