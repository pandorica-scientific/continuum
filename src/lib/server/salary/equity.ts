// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What each vest was worth on the day, per person and year, for the salary
 * screen. Read at request time from tranches and closes; nothing is written to
 * `salary_entry`, because a vest is not a payslip and must not be mistaken for
 * one when the two are compared.
 */
import { db, type Queryable } from '$lib/server/db';
import { grantsWithTranches } from '$lib/server/equity';
import { closesOnOrBefore, latestPrices } from '$lib/server/prices';
import { heldUnits, trancheState, unitsAtClose, type TrancheFigures } from '$lib/equity';
import type { ConvertMinor } from './history';

export interface VestValue {
	personId: string;
	/** The year the grant was AWARDED, not the year this part of it vests. */
	year: number;
	valueMinor: bigint;
	onPayslip: boolean;
	/** False while this part is still to vest, and valued at the latest close. */
	vested: boolean;
}

/** The day a tranche is valued on: settlement when recorded, else the scheduled vest. */
function vestDay(t: TrancheFigures): string {
	return t.settledOn ?? t.vestsOn;
}

/** A person's grants as they stand TODAY, both sides valued at the latest close. */
export interface EquityNowValue {
	personId: string;
	/** Vested, still held as a grant — what a sale today would fetch. */
	heldMinor: bigint;
	heldUnits: number;
	/** Not vested yet — what it WOULD fetch, if it vested this morning. */
	pendingMinor: bigint;
	pendingUnits: number;
	/** Units of either kind left out because their ticker has no close at all. */
	unpricedUnits: number;
}

/**
 * What the grants are worth NOW, held and pending kept apart.
 *
 * A vest is worth what the shares were worth ON THE DAY, and `vestValues`
 * above keeps that figure fixed forever — it is income, and income does not
 * reprice. This is the other question: what the household is holding, and what
 * is still coming, at the last close either way. Read fresh on every load and
 * never stored, and the screen says which of the two it is showing.
 *
 * Held excludes units sold and units moved to a broker — that broker's own
 * report values those now, and counting them here too would be the same shares
 * twice.
 */
export async function equityNowValues(
	baseCurrency: string,
	convert: ConvertMinor,
	handle: Queryable = db,
	today = new Date().toISOString().slice(0, 10)
): Promise<EquityNowValue[]> {
	const grants = await grantsWithTranches(handle);
	// Per TRANCHE, not per grant: `vestValues` rounds each tranche into the base
	// currency on its own, and a screen showing both figures at once must not
	// report the same shares a cent apart because one of them summed first.
	const rows = grants
		.flatMap(({ grant, tranches }) =>
			tranches.map((t) => {
				const state = trancheState(t, today);
				return {
					personId: grant.personId,
					ticker: grant.ticker,
					heldUnits: state === 'vested' ? heldUnits(t) : 0,
					pendingUnits: state === 'pending' ? t.units : 0
				};
			})
		)
		.filter((row) => row.heldUnits > 0 || row.pendingUnits > 0);
	const prices = await latestPrices([...new Set(rows.map((r) => r.ticker))], handle);

	const byPerson = new Map<string, EquityNowValue>();
	for (const row of rows) {
		const found = byPerson.get(row.personId) ?? {
			personId: row.personId,
			heldMinor: 0n,
			heldUnits: 0,
			pendingMinor: 0n,
			pendingUnits: 0,
			unpricedUnits: 0
		};
		found.heldUnits += row.heldUnits;
		found.pendingUnits += row.pendingUnits;
		const close = prices.get(row.ticker);
		// A grant no feed prices is counted in units and named as unpriced,
		// never valued at nothing — a zero would read as "worth nothing".
		if (close) {
			const at = (units: number) =>
				units > 0
					? convert(unitsAtClose(units, close.closeMinor), close.currency, baseCurrency, close.day)
					: 0n;
			found.heldMinor += at(row.heldUnits);
			found.pendingMinor += at(row.pendingUnits);
		} else {
			found.unpricedUnits += row.heldUnits + row.pendingUnits;
		}
		byPerson.set(row.personId, found);
	}
	return [...byPerson.values()];
}

/**
 * What each grant is worth, counted in the year it was AWARDED.
 *
 * A grant is the year's compensation whatever its schedule says: an award made
 * in 2026 that pays out to 2029 was still what 2026 was worth, and splitting it
 * across the years it happens to land in describes a package nobody was
 * offered. So both halves are counted in the grant's own year:
 *
 * - what has vested, at the close on each vest day — realised, and fixed there
 *   forever, because income does not reprice;
 * - what has not, at the latest close — the only figure there is for shares
 *   nobody holds yet, so this half moves with the market until it vests. The
 *   screens label it rather than hide it.
 *
 * `onPayslip` still names the part an employer already put through gross, so a
 * screen that stacks equity on top of pay does not draw the same money twice.
 * That netting follows the GRANT here, not the vest's own year, because that is
 * where the equity is now counted.
 */
export async function vestValues(
	baseCurrency: string,
	convert: ConvertMinor,
	handle: Queryable = db,
	today = new Date().toISOString().slice(0, 10)
): Promise<VestValue[]> {
	const grants = await grantsWithTranches(handle);

	// Vested tranches are valued on their own day; pending ones at the latest
	// close. Two lookups, because those are two different questions.
	const vested: {
		personId: string;
		grantYear: number;
		ticker: string;
		day: string;
		units: number;
		onPayslip: boolean;
	}[] = [];
	const pending: { personId: string; grantYear: number; ticker: string; units: number }[] = [];
	for (const { grant, tranches } of grants) {
		const grantYear = Number(grant.grantedOn.slice(0, 4));
		for (const t of tranches) {
			const state = trancheState(t, today);
			if (state === 'forfeited') continue;
			if (state === 'vested') {
				vested.push({
					personId: grant.personId,
					grantYear,
					ticker: grant.ticker,
					day: vestDay(t),
					units: t.units,
					onPayslip: t.onPayslip
				});
			} else {
				pending.push({ personId: grant.personId, grantYear, ticker: grant.ticker, units: t.units });
			}
		}
	}

	const [closes, latest] = await Promise.all([
		closesOnOrBefore(
			vested.map(({ ticker, day }) => ({ ticker, day })),
			handle
		),
		latestPrices([...new Set(pending.map((p) => p.ticker))], handle)
	]);

	const out: VestValue[] = [];
	for (const v of vested) {
		const close = closes.get(`${v.ticker}|${v.day}`);
		if (!close) continue;
		out.push({
			personId: v.personId,
			year: v.grantYear,
			valueMinor: convert(
				unitsAtClose(v.units, close.closeMinor),
				close.currency,
				baseCurrency,
				v.day
			),
			onPayslip: v.onPayslip,
			vested: true
		});
	}
	for (const p of pending) {
		const close = latest.get(p.ticker);
		// No close at all is no figure, not a zero — `equityNowValues` is what
		// counts those units so a screen can say they are unpriced.
		if (!close) continue;
		out.push({
			personId: p.personId,
			year: p.grantYear,
			valueMinor: convert(
				unitsAtClose(p.units, close.closeMinor),
				close.currency,
				baseCurrency,
				close.day
			),
			// Nothing unvested has been through a payslip; it has not happened yet.
			onPayslip: false,
			vested: false
		});
	}
	return out;
}
