// SPDX-License-Identifier: AGPL-3.0-or-later
// What a tax bar MEANS. Where it goes is `line.ts`.
//
// This file used to own the pixel geometry too — a letterboxed viewBox, the
// stacking arithmetic, the rate strip's own scale — and SalaryYearChart
// imported half of it to draw the same arrangement one tab away. v0.8.1 moved
// all of that into the one chart engine both screens draw through, including
// the two protections that live there now: a hairline floor under every
// segment, and no stroke on a segment too thin to carry one.

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
 * One year's bar, as blocks from the foot up.
 *
 * All the tax first, then all the kept — so the hatched foot is one block
 * rather than interleaved with what was kept. The engine stacks in the order
 * it is given, so this order IS the picture, which is why it is a function
 * with a test rather than two spread operators inside a component.
 *
 * A zero block is dropped rather than drawn: the engine floors every segment
 * at a hairline so a real figure is never invisible, and a country that filed
 * nothing would otherwise get the same hairline as one that filed a little.
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
