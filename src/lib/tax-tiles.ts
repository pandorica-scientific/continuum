// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the whole tax record adds up to, before any of it is broken down.
 *
 * These are the figures `TaxSummaryBand.svelte` drew, as data. The labels and
 * the notes are that component's own, verbatim; what changed is that a screen
 * no longer owns a way of drawing figures — `SummaryBand` draws these the same
 * way it draws a loan screen's four.
 *
 * Household-wide always. The person filter sits BELOW the band and governs the
 * chart and the matrix; a band that answered to a control beneath it would read
 * backwards, and "overall" is the one figure that should not move when you
 * narrow the view.
 *
 * An empty record still draws four tiles, each reading `—`. The band used to
 * render nothing at all, which made the page jump as soon as one year arrived;
 * a dash says "no figure yet" in the place the figure will appear.
 */
import type { Tile } from '$lib/components/tiles';
import { displayCurrency, formatMinor } from '$lib/money';
import { blendedRatePct, type YearRow } from '$lib/tax';

export interface SerialisedYear {
	year: number;
	grossMinor: string;
	taxMinor: string;
	ratePct: number | null;
	byCountry: { country: string }[];
}

export function taxSummaryTiles(years: SerialisedYear[], currency: string): Tile[] {
	const symbol = displayCurrency(currency);

	// Back to bigint: the loader serialises minor units as strings because JSON
	// has no bigint, and money is never summed as a float.
	const rows: YearRow[] = years.map((y) => ({
		year: y.year,
		grossMinor: BigInt(y.grossMinor),
		taxMinor: BigInt(y.taxMinor),
		ratePct: y.ratePct,
		byCountry: []
	}));

	const empty = rows.length === 0;
	const gross = rows.reduce((sum, r) => sum + r.grossMinor, 0n);
	const tax = rows.reduce((sum, r) => sum + r.taxMinor, 0n);
	const blended = blendedRatePct(rows);
	const jurisdictions = new Set(years.flatMap((y) => y.byCountry.map((c) => c.country))).size;

	const latest = years.at(-1) ?? null;
	const previous = years.length > 1 ? years.at(-2)! : null;
	const delta = latest && previous ? BigInt(latest.grossMinor) - BigInt(previous.grossMinor) : null;

	const latestNote = (): string => {
		if (!latest) return 'nothing on record yet';
		if (delta === null) return 'the first year on record';
		if (delta === 0n) return `level with ${previous!.year}`;
		const size = formatMinor(delta < 0n ? -delta : delta, currency);
		return `${delta > 0n ? '+' : '−'}${size} on ${previous!.year}`;
	};

	return [
		{
			wash: 'teal',
			label: empty ? 'Earned' : `Earned since ${years[0].year}`,
			value: empty ? '—' : formatMinor(gross, currency),
			unit: empty ? undefined : symbol,
			note: empty
				? 'no year on record'
				: `across ${jurisdictions} ${jurisdictions === 1 ? 'jurisdiction' : 'jurisdictions'}`
		},
		{
			wash: 'red',
			label: 'Tax paid',
			value: empty ? '—' : formatMinor(tax, currency),
			unit: empty ? undefined : symbol,
			note: 'declared, not estimated',
			// The hue only rides a figure. A red dash reads as a bad number at a
			// glance, which is the opposite of what nothing says.
			color: empty ? undefined : 'var(--red)'
		},
		{
			wash: 'yellow',
			label: 'Blended rate',
			value: blended === null ? '—' : `${blended.toFixed(2)}%`,
			note: 'lifetime, weighted by income',
			color: blended === null ? undefined : 'var(--yellow)'
		},
		{
			wash: 'green',
			label: latest ? `Latest year · ${latest.year}` : 'Latest year',
			value: latest ? formatMinor(BigInt(latest.grossMinor), currency) : '—',
			unit: latest ? symbol : undefined,
			note: latestNote()
		}
	];
}
