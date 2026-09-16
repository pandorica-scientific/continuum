// SPDX-License-Identifier: AGPL-3.0-or-later
// What a tax bar MEANS. Where it goes is `line.ts` (hairline floor per
// segment, no stroke on a segment too thin to carry one).

export interface SerialisedCountry {
	country: string;
	grossMinor: string;
	taxMinor: string;
	ratePct: number | null;
	/** The filed figures, untouched. The hover readout shows them beside the
	 * converted ones, so a reader can see what the statement actually said. */
	native?: { currency: string; grossMinor: string; taxMinor: string }[];
}

export interface SerialisedYear {
	year: number;
	grossMinor: string;
	taxMinor: string;
	ratePct: number | null;
	byCountry: SerialisedCountry[];
}

export function maxGross(rows: SerialisedYear[]): bigint {
	return rows.reduce((most, r) => {
		const gross = BigInt(r.grossMinor);
		return gross > most ? gross : most;
	}, 0n);
}

/**
 * One year's bar, as blocks from the foot up: all the tax first, then all the
 * kept, so the hatched foot is one block rather than interleaved.
 *
 * A zero block is dropped rather than drawn — the engine floors every segment
 * at a hairline, and a country that filed nothing shouldn't get the same
 * hairline as one that filed a little.
 */
export function taxBarSegments(
	row: SerialisedYear,
	hues: Map<string, string>
): { value: number; fill: string; stroke: string; hatched: boolean; country: string }[] {
	const of = (country: string) => `var(${hues.get(country) ?? '--series-r1'})`;
	return [
		...row.byCountry.map((c) => ({
			country: c.country,
			value: Number(BigInt(c.taxMinor)),
			fill: `url(#tax-hatch-${c.country})`,
			stroke: of(c.country),
			hatched: true
		})),
		...row.byCountry.map((c) => {
			const kept = BigInt(c.grossMinor) - BigInt(c.taxMinor);
			return {
				country: c.country,
				value: Number(kept > 0n ? kept : 0n),
				fill: `url(#tax-fill-${c.country})`,
				stroke: of(c.country),
				hatched: false
			};
		})
	].filter((seg) => seg.value > 0);
}
