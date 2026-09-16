// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Restricted stock units: how a grant's units become the person's over time.
 *
 * Pure: dates are ISO strings, units are numbers, and money never appears —
 * a tranche is valued elsewhere by multiplying units by a close. Kept out of
 * `$lib/server` because the grant dialog previews an expanded schedule in the
 * browser before anything is saved.
 */

export type ScheduleInterval = 'monthly' | 'quarterly' | 'yearly';

export interface ScheduleEven {
	mode: 'even';
	firstVestOn: string;
	count: number;
	interval: ScheduleInterval;
}

export interface ScheduleCliff {
	mode: 'cliff';
	cliffOn: string;
	/** Share of the grant that vests at the cliff, 0–1. */
	cliffFraction: number;
	/** Tranches AFTER the cliff. */
	count: number;
	interval: ScheduleInterval;
}

export interface ScheduleList {
	mode: 'list';
	tranches: { vestsOn: string; units: number }[];
}

export type Schedule = ScheduleEven | ScheduleCliff | ScheduleList;

const MONTHS_PER: Record<ScheduleInterval, number> = { monthly: 1, quarterly: 3, yearly: 12 };
const UNIT_SCALE = 1_000_000; // six decimals, the column's scale

const roundUnits = (n: number) => Math.round(n * UNIT_SCALE) / UNIT_SCALE;

/** `day` moved forward by `steps` intervals, day-of-month clamped to the target month. */
export function addInterval(day: string, interval: ScheduleInterval, steps: number): string {
	const [y, m, d] = day.split('-').map(Number);
	const months = m - 1 + MONTHS_PER[interval] * steps;
	const year = y + Math.floor(months / 12);
	const month = (months % 12) + 1;
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const dd = Math.min(d, lastDay);
	return `${year}-${String(month).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** `total` split into `count` whole-unit parts, with the remainder (fraction included) on the last. */
function splitEvenly(total: number, count: number): number[] {
	if (count <= 0) return [];
	const baseAmount = Math.floor(total / count);
	const parts = Array.from({ length: count - 1 }, () => baseAmount);
	const lastAmount = roundUnits(total - baseAmount * (count - 1));
	parts.push(lastAmount);
	return parts;
}

export function expandSchedule(
	totalUnits: number,
	schedule: Schedule
): { vestsOn: string; units: number }[] {
	if (!(totalUnits > 0)) throw new Error('A grant needs a positive number of units.');
	const tranches = expand(totalUnits, schedule);
	// Whatever the mode, every unit granted lands in exactly one tranche. A
	// schedule that quietly lost some would misstate vesting, salary and net
	// worth alike, so this is checked here rather than trusted per branch.
	const sum = roundUnits(tranches.reduce((s, t) => s + t.units, 0));
	if (sum !== roundUnits(totalUnits)) {
		throw new Error(`The tranches add up to ${sum}, not the ${totalUnits} granted.`);
	}
	return tranches;
}

function expand(totalUnits: number, schedule: Schedule): { vestsOn: string; units: number }[] {
	switch (schedule.mode) {
		case 'even': {
			if (!Number.isInteger(schedule.count) || schedule.count < 1) {
				throw new Error('An even schedule needs at least one tranche.');
			}
			return splitEvenly(totalUnits, schedule.count).map((units, i) => ({
				vestsOn: addInterval(schedule.firstVestOn, schedule.interval, i),
				units
			}));
		}
		case 'cliff': {
			if (!(schedule.cliffFraction > 0 && schedule.cliffFraction < 1)) {
				throw new Error('The cliff share must be between 0 and 1.');
			}
			if (!Number.isInteger(schedule.count) || schedule.count < 1) {
				throw new Error('A cliff schedule needs at least one tranche after the cliff.');
			}
			const cliffUnits = roundUnits(totalUnits * schedule.cliffFraction);
			const rest = splitEvenly(roundUnits(totalUnits - cliffUnits), schedule.count);
			return [
				{ vestsOn: schedule.cliffOn, units: cliffUnits },
				...rest.map((units, i) => ({
					vestsOn: addInterval(schedule.cliffOn, schedule.interval, i + 1),
					units
				}))
			];
		}
		case 'list': {
			return [...schedule.tranches]
				.map((t) => ({ vestsOn: t.vestsOn, units: roundUnits(t.units) }))
				.sort((a, b) => (a.vestsOn < b.vestsOn ? -1 : 1));
		}
	}
}

export interface TrancheFigures {
	id: string;
	vestsOn: string;
	units: number;
	settledOn: string | null;
	deliveredUnits: number | null;
	withheldUnits: number | null;
	soldUnits: number;
	forfeitedOn: string | null;
	onPayslip: boolean;
}

export type TrancheState = 'vested' | 'pending' | 'forfeited';

export function trancheState(t: TrancheFigures, today: string): TrancheState {
	if (t.forfeitedOn) return 'forfeited';
	if (t.settledOn || t.vestsOn <= today) return 'vested';
	return 'pending';
}

/** Units the person still holds from this tranche: delivered (or scheduled) less sold. */
export function heldUnits(t: TrancheFigures): number {
	if (t.forfeitedOn) return 0;
	return roundUnits((t.deliveredUnits ?? t.units) - t.soldUnits);
}

export function grantSummary(
	tranches: TrancheFigures[],
	today: string
): {
	vestedUnits: number;
	heldUnits: number;
	pendingUnits: number;
	forfeitedUnits: number;
	nextVest: { vestsOn: string; units: number } | null;
} {
	let vestedUnits = 0;
	let held = 0;
	let pendingUnits = 0;
	let forfeitedUnits = 0;
	const pending: { vestsOn: string; units: number }[] = [];
	for (const t of tranches) {
		switch (trancheState(t, today)) {
			case 'vested':
				vestedUnits += t.units;
				held += heldUnits(t);
				break;
			case 'pending':
				pendingUnits += t.units;
				pending.push({ vestsOn: t.vestsOn, units: t.units });
				break;
			case 'forfeited':
				forfeitedUnits += t.units;
		}
	}
	pending.sort((a, b) => (a.vestsOn < b.vestsOn ? -1 : 1));
	return {
		vestedUnits: roundUnits(vestedUnits),
		heldUnits: roundUnits(held),
		pendingUnits: roundUnits(pendingUnits),
		forfeitedUnits: roundUnits(forfeitedUnits),
		nextVest: pending[0] ?? null
	};
}
