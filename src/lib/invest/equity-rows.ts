// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A grant as the Investments equity card lists it. Pure: the loader supplies
 * prices and a converter, the screen prints strings.
 */
import {
	grantSummary,
	heldUnits,
	trancheState,
	unitsAtClose,
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
	/** Transferred to a broker that counts them now — owned, just not here. */
	moved: string;
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
	/** Vested plus still-to-vest, at the same close. An estimate, by nature. */
	totalValue: string | null;
	totalBase: string | null;
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

/**
 * What every grant is worth at the latest close, vested and pending units
 * both added in. A grant whose first tranche vests next year is worth
 * something now, and reporting it as nothing was the more misleading of the
 * two — the figure a headline beside the portfolio is asking for is "what is
 * the grant worth", not "what could be sold today".
 *
 * HELD, not vested: units already delivered and moved to the broker are in the
 * portfolio total and must not be counted a second time here. Forfeited units
 * are in neither.
 */
export function grantEquityValues(
	grants: { grant: { ticker: string }; tranches: TrancheFigures[] }[],
	prices: Map<string, { day: string; closeMinor: bigint; currency: string }>,
	today: string
): { valueMinor: bigint; currency: string; day: string; units: number }[] {
	const out: { valueMinor: bigint; currency: string; day: string; units: number }[] = [];
	for (const { grant, tranches } of grants) {
		const price = prices.get(grant.ticker);
		if (!price) continue;
		const summary = grantSummary(tranches, today);
		const counted = summary.heldUnits + summary.pendingUnits;
		if (counted <= 0) continue;
		out.push({
			valueMinor: unitsAtClose(counted, price.closeMinor),
			currency: price.currency,
			day: price.day,
			units: counted
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
		/**
		 * The whole grant at today's close — what has vested plus what has not.
		 *
		 * `pendingValue` was computed here from the start and shown nowhere, so
		 * the card could report a grant as worth nothing while sixty-two units of
		 * it sat waiting to vest. An estimate by construction: unvested units are
		 * priced at a close that will have moved by the time they arrive, and
		 * they may be forfeited before they do.
		 */
		const total = vested === null || pending === null ? null : vested + pending;
		const totalBase =
			total !== null && price ? input.toBase(total, price.currency, price.day) : null;
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
			totalValue: total === null ? null : formatMinor(total, price!.currency),
			totalBase: totalBase === null ? null : formatMinor(totalBase, input.baseCurrency),
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
				moved: units(t.movedUnits),
				held: units(heldUnits(t))
			}))
		};
	});
}
