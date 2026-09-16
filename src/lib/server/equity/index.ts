// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Equity grants: writes that keep the schedule honest.
 *
 * A grant's tranches are replaced together, never edited one by one — except a
 * settlement or a sale, which are facts about one tranche and never move its
 * date. Replacing keeps any tranche that has settled: what was delivered
 * happened, whatever the new schedule says.
 */
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db, type Queryable } from '$lib/server/db';
import { engagement, equityGrant, equityTranche } from '$lib/server/db/schema';
import {
	expandSchedule,
	heldUnits,
	type Schedule,
	type ScheduleInterval,
	type TrancheFigures
} from '$lib/equity';

export interface GrantInput {
	personId: string;
	engagementId: string | null;
	ticker: string;
	currency: string;
	grantedOn: string;
	totalUnits: number;
	label: string | null;
	documentId: string | null;
	note: string | null;
	schedule: Schedule;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INTERVALS: ScheduleInterval[] = ['monthly', 'quarterly', 'yearly'];

/** Broker form, upper case, no spaces. */
export function normaliseTicker(raw: string): string {
	const ticker = raw.trim().toUpperCase();
	if (!/^[A-Z0-9.-]{1,20}$/.test(ticker) || !ticker.includes('.')) {
		throw new Error('The ticker needs a market suffix, like ACME.US or VWCE.DE.');
	}
	return ticker;
}

/** The schedule off the grant dialog's form. Throws a sentence the screen can show. */
export function parseSchedule(form: FormData): Schedule {
	const mode = String(form.get('mode') ?? 'even');
	const interval = String(form.get('interval') ?? 'yearly') as ScheduleInterval;
	if (!INTERVALS.includes(interval)) throw new Error('Pick an interval.');
	const count = Number(form.get('count') ?? 0);
	if (mode === 'even') {
		const firstVestOn = String(form.get('firstVestOn') ?? '');
		if (!DATE.test(firstVestOn)) throw new Error('Pick the first vesting date.');
		return { mode, firstVestOn, count, interval };
	}
	if (mode === 'cliff') {
		const cliffOn = String(form.get('cliffOn') ?? '');
		if (!DATE.test(cliffOn)) throw new Error('Pick the cliff date.');
		const cliffFraction = Number(form.get('cliffPercent') ?? 0) / 100;
		return { mode, cliffOn, cliffFraction, count, interval };
	}
	if (mode === 'list') {
		const dates = form.getAll('trancheDate').map(String);
		const units = form.getAll('trancheUnits').map((u) => Number(u));
		if (dates.length === 0) throw new Error('List at least one tranche.');
		const tranches = dates.map((vestsOn, i) => {
			if (!DATE.test(vestsOn)) throw new Error(`Tranche ${i + 1} needs a date.`);
			if (!(units[i] > 0)) throw new Error(`Tranche ${i + 1} needs a positive number of units.`);
			return { vestsOn, units: units[i] };
		});
		return { mode, tranches };
	}
	throw new Error('Pick how the grant vests.');
}

export async function createGrant(input: GrantInput, handle: Db = db): Promise<string> {
	const tranches = expandSchedule(input.totalUnits, input.schedule);
	const ticker = normaliseTicker(input.ticker);
	const id = uuidv7();
	await handle.transaction(async (tx) => {
		await tx.insert(equityGrant).values({
			id,
			personId: input.personId,
			engagementId: input.engagementId,
			ticker,
			currency: input.currency,
			grantedOn: input.grantedOn,
			totalUnits: String(input.totalUnits),
			label: input.label,
			documentId: input.documentId,
			note: input.note
		});
		await tx.insert(equityTranche).values(
			tranches.map((t) => ({
				id: uuidv7(),
				grantId: id,
				vestsOn: t.vestsOn,
				units: String(t.units)
			}))
		);
	});
	return id;
}

/** Keep settled tranches, replace the rest with the schedule over the units still to vest. */
export async function replaceSchedule(
	grantId: string,
	totalUnits: number,
	schedule: Schedule,
	handle: Db = db
): Promise<void> {
	await handle.transaction(async (tx) => {
		// Settled and forfeited tranches are history and stay; only the ones
		// still to come are rewritten, over the units they had between them.
		const kept = await tx
			.select()
			.from(equityTranche)
			.where(
				and(
					eq(equityTranche.grantId, grantId),
					sql`(${equityTranche.settledOn} is not null or ${equityTranche.forfeitedOn} is not null)`
				)
			);
		const keptUnits = kept.reduce((s, t) => s + Number(t.units), 0);
		const remaining = totalUnits - keptUnits;
		if (remaining < 0) {
			throw new Error('The grant cannot be smaller than what has already vested or lapsed.');
		}
		const fresh = remaining > 0 ? expandSchedule(remaining, schedule) : [];
		await tx
			.delete(equityTranche)
			.where(
				and(
					eq(equityTranche.grantId, grantId),
					isNull(equityTranche.settledOn),
					isNull(equityTranche.forfeitedOn)
				)
			);
		if (fresh.length) {
			await tx
				.insert(equityTranche)
				.values(
					fresh.map((t) => ({ id: uuidv7(), grantId, vestsOn: t.vestsOn, units: String(t.units) }))
				);
		}
		await tx
			.update(equityGrant)
			.set({ totalUnits: String(totalUnits) })
			.where(eq(equityGrant.id, grantId));
	});
}

/**
 * Settle a tranche once: it must not already be settled or forfeited, and
 * delivered plus withheld can never exceed what was scheduled to vest — a
 * looser check would let `heldUnits()`, grant summaries and net worth count
 * more shares than the tranche ever held. Guarded in SQL, atomically, the
 * same way `recordSale` guards against overselling.
 */
export async function recordSettlement(
	trancheId: string,
	fields: { settledOn: string; deliveredUnits: number; withheldUnits: number; onPayslip: boolean },
	handle: Db = db
): Promise<void> {
	if (!(fields.deliveredUnits >= 0) || !(fields.withheldUnits >= 0)) {
		throw new Error('Delivered and withheld units cannot be negative.');
	}
	const delivered = String(fields.deliveredUnits);
	const withheld = String(fields.withheldUnits);
	const updated = await handle
		.update(equityTranche)
		.set({
			settledOn: fields.settledOn,
			deliveredUnits: delivered,
			withheldUnits: withheld,
			onPayslip: fields.onPayslip
		})
		.where(
			and(
				eq(equityTranche.id, trancheId),
				isNull(equityTranche.settledOn),
				isNull(equityTranche.forfeitedOn),
				lte(equityTranche.vestsOn, fields.settledOn),
				sql`${delivered}::numeric + ${withheld}::numeric <= ${equityTranche.units}`
			)
		)
		.returning({ id: equityTranche.id });
	if (updated.length === 1) return;
	const [row] = await handle.select().from(equityTranche).where(eq(equityTranche.id, trancheId));
	if (!row) throw new Error('That tranche is no longer here.');
	if (row.settledOn) throw new Error('That tranche has already been settled.');
	if (row.forfeitedOn) throw new Error('That tranche was forfeited and cannot be settled.');
	if (row.vestsOn > fields.settledOn) {
		throw new Error('The settlement date cannot be before the tranche vests.');
	}
	throw new Error(`Delivered and withheld units cannot exceed the ${row.units} units in this tranche.`);
}

/**
 * Add to what was sold from a tranche; never beyond what it still holds.
 *
 * One statement, guarded in SQL: two sales recorded at once cannot both read
 * the same held figure and together sell more than there is.
 */
export async function recordSale(
	trancheId: string,
	soldUnits: number,
	handle: Db = db
): Promise<void> {
	if (!(soldUnits > 0)) throw new Error('A sale needs a positive number of units.');
	const sold = String(soldUnits);
	const updated = await handle
		.update(equityTranche)
		.set({ soldUnits: sql`${equityTranche.soldUnits} + ${sold}::numeric` })
		.where(
			and(
				eq(equityTranche.id, trancheId),
				isNull(equityTranche.forfeitedOn),
				sql`coalesce(${equityTranche.deliveredUnits}, ${equityTranche.units}) - ${equityTranche.soldUnits} >= ${sold}::numeric`
			)
		)
		.returning({ id: equityTranche.id });
	if (updated.length === 1) return;
	const [row] = await handle.select().from(equityTranche).where(eq(equityTranche.id, trancheId));
	if (!row) throw new Error('That tranche is no longer here.');
	if (row.forfeitedOn) throw new Error('That tranche was forfeited; there is nothing to sell.');
	throw new Error(`Only ${heldUnits(trancheFigures(row))} units are held from this tranche.`);
}

/** Whose job an engagement is, so a grant cannot be hung on somebody else's. */
export async function engagementOwner(
	engagementId: string,
	handle: Queryable = db
): Promise<string | null> {
	const [row] = await handle
		.select({ personId: engagement.personId })
		.from(engagement)
		.where(eq(engagement.id, engagementId));
	return row?.personId ?? null;
}

/** Forfeit every unsettled tranche that vests after `forfeitedOn`. Returns how many. */
export async function forfeitPending(
	grantId: string,
	forfeitedOn: string,
	handle: Db = db
): Promise<number> {
	const rows = await handle
		.update(equityTranche)
		.set({ forfeitedOn })
		.where(
			and(
				eq(equityTranche.grantId, grantId),
				isNull(equityTranche.settledOn),
				isNull(equityTranche.forfeitedOn),
				gt(equityTranche.vestsOn, forfeitedOn)
			)
		)
		.returning({ id: equityTranche.id });
	return rows.length;
}

export async function grantOwner(grantId: string, handle: Queryable = db): Promise<string | null> {
	const [row] = await handle
		.select({ personId: equityGrant.personId })
		.from(equityGrant)
		.where(eq(equityGrant.id, grantId));
	return row?.personId ?? null;
}

export async function trancheOwner(
	trancheId: string,
	handle: Queryable = db
): Promise<string | null> {
	const [row] = await handle
		.select({ personId: equityGrant.personId })
		.from(equityTranche)
		.innerJoin(equityGrant, eq(equityGrant.id, equityTranche.grantId))
		.where(eq(equityTranche.id, trancheId));
	return row?.personId ?? null;
}

export function trancheFigures(row: typeof equityTranche.$inferSelect): TrancheFigures {
	return {
		id: row.id,
		vestsOn: row.vestsOn,
		units: Number(row.units),
		settledOn: row.settledOn,
		deliveredUnits: row.deliveredUnits === null ? null : Number(row.deliveredUnits),
		withheldUnits: row.withheldUnits === null ? null : Number(row.withheldUnits),
		soldUnits: Number(row.soldUnits),
		forfeitedOn: row.forfeitedOn,
		onPayslip: row.onPayslip
	};
}

export type GrantRow = typeof equityGrant.$inferSelect;

export async function grantsWithTranches(
	handle: Queryable = db
): Promise<{ grant: GrantRow; tranches: TrancheFigures[] }[]> {
	const [grants, tranches] = await Promise.all([
		handle.select().from(equityGrant).orderBy(equityGrant.grantedOn),
		handle.select().from(equityTranche).orderBy(equityTranche.vestsOn)
	]);
	return grants.map((grant) => ({
		grant,
		tranches: tranches.filter((t) => t.grantId === grant.id).map(trancheFigures)
	}));
}
