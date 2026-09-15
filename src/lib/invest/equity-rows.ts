// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A grant as the Investments equity card lists it. Pure: the loader supplies
 * prices and a converter, the screen prints strings.
 */
import {
	grantSummary,
	heldUnits,
	trancheState,
	type TrancheFigures,
	type TrancheState
} from '$lib/equity';
import { formatMinor } from '$lib/money';
import { isStale } from '$lib/prices';

export interface EquityGrantSource {
	id: string;
	ticker: string;
	label: string | null;
	currency: string;
	grantedOn: string;
	totalUnits: string;
	person: string;
	employer: string | null;
}

export interface EquityTrancheRow {
	id: string;
	vestsOn: string;
	units: string;
	state: TrancheState;
	onPayslip: boolean;
	delivered: string | null;
	withheld: string | null;
	sold: string;
	held: string;
}

export interface EquityGrantRow {
	id: string;
	ticker: string;
	label: string;
	person: string;
	employer: string | null;
	currency: string;
	grantedUnits: string;
	vestedUnits: string;
	pendingUnits: string;
	heldUnits: string;
	/** "2027-03-01 · 100 units", or null once everything has vested. */
	nextVest: string | null;
	/** Formatted in the price's currency; null with no close. */
	vestedValue: string | null;
	pendingValue: string | null;
	/** Formatted in the household base; null with no close or no rate. */
	vestedBase: string | null;
	priceDay: string | null;
	priceStale: boolean;
	tranches: EquityTrancheRow[];
}

export interface EquityRowsInput {
	grants: { grant: EquityGrantSource; tranches: TrancheFigures[] }[];
	prices: Map<string, { day: string; closeMinor: bigint; currency: string }>;
	baseCurrency: string;
	staleAfterDays: number;
	/** market minor → base minor at the price day, or null with no rate */
	toBase: (amountMinor: bigint, currency: string, day: string) => bigint | null;
}

/** Units at a close, in the close's minor units. */
export function unitsAtClose(units: number, closeMinor: bigint): bigint {
	return BigInt(Math.round(Number(closeMinor) * units));
}

/**
 * What the household's vested, still-held shares are worth, one figure per
 * priced grant in the price's own currency. Grants with no close are left out
 * rather than counted at nothing, and the caller says how many were.
 */
export function heldEquityValues(
	grants: { grant: { ticker: string }; tranches: TrancheFigures[] }[],
	prices: Map<string, { day: string; closeMinor: bigint; currency: string }>,
	today: string
): { valueMinor: bigint; currency: string; day: string }[] {
	const out: { valueMinor: bigint; currency: string; day: string }[] = [];
	for (const { grant, tranches } of grants) {
		const price = prices.get(grant.ticker);
		if (!price) continue;
		const held = grantSummary(tranches, today).heldUnits;
		if (held <= 0) continue;
		out.push({
			valueMinor: unitsAtClose(held, price.closeMinor),
			currency: price.currency,
			day: price.day
		});
	}
	return out;
}

/** Units as people write them: whole numbers bare, fractions without trailing zeros. */
const units = (n: number) =>
	Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');

export function equityGrantRows(input: EquityRowsInput, today: string): EquityGrantRow[] {
	return input.grants.map(({ grant, tranches }) => {
		const summary = grantSummary(tranches, today);
		const price = input.prices.get(grant.ticker) ?? null;
		const value = (n: number) => (price ? unitsAtClose(n, price.closeMinor) : null);
		const vested = value(summary.heldUnits);
		const pending = value(summary.pendingUnits);
		// The close is in whatever currency the feed quotes the market in, which
		// is the currency every value here is in — the grant's own is only what
		// the letter said.
		const vestedBase =
			vested !== null && price ? input.toBase(vested, price.currency, price.day) : null;
		return {
			id: grant.id,
			ticker: grant.ticker,
			label: grant.label ?? `${grant.ticker} · granted ${grant.grantedOn}`,
			person: grant.person,
			employer: grant.employer,
			currency: price?.currency ?? grant.currency,
			grantedUnits: units(Number(grant.totalUnits)),
			vestedUnits: units(summary.vestedUnits),
			pendingUnits: units(summary.pendingUnits),
			heldUnits: units(summary.heldUnits),
			nextVest: summary.nextVest
				? `${summary.nextVest.vestsOn} · ${units(summary.nextVest.units)} units`
				: null,
			vestedValue: vested === null ? null : formatMinor(vested, price!.currency),
			pendingValue: pending === null ? null : formatMinor(pending, price!.currency),
			vestedBase: vestedBase === null ? null : formatMinor(vestedBase, input.baseCurrency),
			priceDay: price?.day ?? null,
			priceStale: isStale(price?.day ?? null, today, input.staleAfterDays),
			tranches: tranches.map((t) => ({
				id: t.id,
				vestsOn: t.vestsOn,
				units: units(t.units),
				state: trancheState(t, today),
				onPayslip: t.onPayslip,
				delivered: t.deliveredUnits === null ? null : units(t.deliveredUnits),
				withheld: t.withheldUnits === null ? null : units(t.withheldUnits),
				sold: units(t.soldUnits),
				held: units(heldUnits(t))
			}))
		};
	});
}
