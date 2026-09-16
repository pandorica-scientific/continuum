// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What each vest was worth on the day, per person and year, for the salary
 * screen. Read at request time from tranches and closes; nothing is written to
 * `salary_entry`, because a vest is not a payslip and must not be mistaken for
 * one when the two are compared.
 */
import { db, type Queryable } from '$lib/server/db';
import { grantsWithTranches } from '$lib/server/equity';
import { closesOnOrBefore } from '$lib/server/prices';
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
	const vested: {
		personId: string;
		ticker: string;
		day: string;
		units: number;
		onPayslip: boolean;
	}[] = [];
	for (const { grant, tranches } of grants) {
		for (const t of tranches) {
			if (trancheState(t, today) !== 'vested') continue;
			vested.push({
				personId: grant.personId,
				ticker: grant.ticker,
				day: vestDay(t),
				units: t.units,
				onPayslip: t.onPayslip
			});
		}
	}
	const closes = await closesOnOrBefore(
		vested.map(({ ticker, day }) => ({ ticker, day })),
		handle
	);
	const out: VestValue[] = [];
	for (const v of vested) {
		const close = closes.get(`${v.ticker}|${v.day}`);
		if (!close) continue;
		out.push({
			personId: v.personId,
			year: Number(v.day.slice(0, 4)),
			valueMinor: convert(
				vestValueMinor(v.units, close.closeMinor),
				close.currency,
				baseCurrency,
				v.day
			),
			onPayslip: v.onPayslip
		});
	}
	return out;
}
