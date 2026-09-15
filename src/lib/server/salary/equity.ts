// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What each vest was worth on the day, per person and year, for the salary
 * screen. Read at request time from tranches and closes; nothing is written to
 * `salary_entry`, because a vest is not a payslip and must not be mistaken for
 * one when the two are compared.
 */
import { db, type Queryable } from '$lib/server/db';
import { grantsWithTranches } from '$lib/server/equity';
import { closeOnOrBefore } from '$lib/server/prices';
import { trancheState, type TrancheFigures } from '$lib/equity';
import type { ConvertMinor } from './history';

export interface VestValue {
	personId: string;
	year: number;
	valueMinor: bigint;
	onPayslip: boolean;
}

/** The day a tranche is valued on: settlement when recorded, else the scheduled vest. */
export function vestDay(t: TrancheFigures): string {
	return t.settledOn ?? t.vestsOn;
}

/** Units at a close, in the close's minor units. */
export function vestValueMinor(units: number, closeMinor: bigint): bigint {
	return BigInt(Math.round(Number(closeMinor) * units));
}

export async function vestValues(
	baseCurrency: string,
	convert: ConvertMinor,
	handle: Queryable = db,
	today = new Date().toISOString().slice(0, 10)
): Promise<VestValue[]> {
	const grants = await grantsWithTranches(handle);
	const out: VestValue[] = [];
	for (const { grant, tranches } of grants) {
		for (const t of tranches) {
			if (trancheState(t, today) !== 'vested') continue;
			const day = vestDay(t);
			const close = await closeOnOrBefore(grant.ticker, day, handle);
			if (!close) continue;
			out.push({
				personId: grant.personId,
				year: Number(day.slice(0, 4)),
				valueMinor: convert(
					vestValueMinor(t.units, close.closeMinor),
					close.currency,
					baseCurrency,
					day
				),
				onPayslip: t.onPayslip
			});
		}
	}
	return out;
}
