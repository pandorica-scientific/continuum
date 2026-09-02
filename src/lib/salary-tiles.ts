// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the whole salary record adds up to, before any of it is broken down.
 *
 * The figures `SalarySummaryBand.svelte` drew, as data, with its labels and
 * notes verbatim. Unlike the tax band this one ANSWERS to the person filter
 * beneath it: "what has Robert earned" and "what has the household earned" are
 * different questions and both are worth asking, whereas a tax year's total is
 * the same figure whoever filed it.
 *
 * Gross leads every figure and net sits in the note beneath it. v0.4.4 exists
 * because the two were being confused for each other; a headline that did not
 * say which it was would be the same defect wearing a new coat.
 */
import type { Tile } from '$lib/components/tiles';
import { displayCurrency, formatMinor } from '$lib/money';
import { lastBaseIncrease, type SalaryYear } from '$lib/salary';

export interface SerialisedSalaryYear {
	year: number;
	age: number | null;
	grossAvgMinor: string | null;
	netAvgMinor: string | null;
	grossTotalMinor: string;
	baseTotalMinor: string;
	bonusTotalMinor: string;
	netTotalMinor: string;
	grossMonths: number;
	netMonths: number;
	netComplete: boolean;
	deltaPct: number | null;
	baseDeltaPct: number | null;
}

export function salarySummaryTiles(
	years: SerialisedSalaryYear[],
	currency: string,
	/** 'household' when the filter says Both, 'person' when it names one. */
	scope: 'household' | 'person'
): Tile[] {
	const symbol = displayCurrency(currency);
	const money = (v: bigint | null) => (v === null ? '—' : formatMinor(v, currency));

	const rows = [...years]
		.map((y) => ({
			...y,
			gross: BigInt(y.grossTotalMinor),
			net: BigInt(y.netTotalMinor),
			base: BigInt(y.baseTotalMinor)
		}))
		.sort((a, b) => a.year - b.year);

	const empty = rows.length === 0;
	const totalGross = rows.reduce((sum, r) => sum + r.gross, 0n);
	const totalNet = rows.reduce((sum, r) => sum + r.net, 0n);
	const grossMonths = rows.reduce((n, r) => n + r.grossMonths, 0);
	const netMonths = rows.reduce((n, r) => n + r.netMonths, 0);
	const latest = rows.at(-1) ?? null;

	// Over the months actually recorded, never over the years: a year with four
	// payslips is a partial year, and dividing its total by twelve reports a
	// monthly figure nobody was paid.
	const avgMonthGross = grossMonths === 0 ? null : totalGross / BigInt(grossMonths);
	const avgMonthNet = netMonths === 0 ? null : totalNet / BigInt(netMonths);
	const avgYearGross = empty ? null : totalGross / BigInt(rows.length);
	const avgYearNet = empty ? null : totalNet / BigInt(rows.length);
	const latestAvgGross =
		latest && latest.grossMonths > 0 ? latest.gross / BigInt(latest.grossMonths) : null;
	const latestAvgNet =
		latest && latest.netMonths > 0 ? latest.net / BigInt(latest.netMonths) : null;

	// A household has no single raise — two people get their own, in different
	// years, and averaging them describes nobody.
	const increase =
		scope === 'person'
			? lastBaseIncrease(
					years.map((y) => ({ year: y.year, baseDeltaPct: y.baseDeltaPct }) as SalaryYear)
				)
			: null;

	/** `⚠` where a year's net is short of its gross months. */
	const incomplete = latest && !latest.netComplete ? '⚠ ' : '';

	const earned: Tile = {
		label: empty ? 'Earned' : `Earned since ${rows[0].year}`,
		value: empty ? '—' : money(totalGross),
		unit: empty ? undefined : symbol,
		note: empty ? 'no year on record' : `gross · ${money(totalNet)} net`
	};

	if (scope === 'household') {
		return [
			earned,
			{
				label: 'Average year',
				value: money(avgYearGross),
				unit: avgYearGross === null ? undefined : symbol,
				note: empty
					? 'no year on record'
					: `gross · ${money(avgYearNet)} net, over ${rows.length} ${rows.length === 1 ? 'year' : 'years'}`
			},
			{
				label: latest ? `Last year · ${latest.year}` : 'Last year',
				value: money(latest?.gross ?? null),
				unit: latest ? symbol : undefined,
				note: latest ? `${incomplete}gross · ${money(latest.net)} net` : 'no year on record'
			}
		];
	}

	return [
		earned,
		{
			label: 'Average month',
			value: money(avgMonthGross),
			unit: avgMonthGross === null ? undefined : symbol,
			note: empty
				? 'no month on record'
				: `gross · ${money(avgMonthNet)} net, over ${grossMonths} ${grossMonths === 1 ? 'month' : 'months'}`
		},
		{
			label: 'Last increase',
			value: increase === null ? '—' : `+${increase.pct}%`,
			note:
				increase === null
					? 'no increase recorded'
					: `in ${increase.year} · base pay, bonus excluded`,
			// Green only when there IS one. A green dash reads as a positive figure
			// at a glance, which is the opposite of what it says.
			color: increase === null ? undefined : 'var(--green)'
		},
		{
			label: latest ? `Average month, ${latest.year}` : 'Average month, latest year',
			value: money(latestAvgGross),
			unit: latestAvgGross === null ? undefined : symbol,
			note: latest ? `${incomplete}gross · ${money(latestAvgNet)} net` : 'no month on record'
		}
	];
}
