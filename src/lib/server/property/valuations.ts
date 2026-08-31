// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a property has been worth, and what it cost to buy.
 *
 * Two things the screen could not do before: plot a value over time, because
 * only the latest was stored; and record a flat bought years ago without
 * reconstructing its money-in from transactions that predate the ledger.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db } from '$lib/server/db';
import { property, propertyOpening, propertyValuation } from '$lib/server/db/schema';

export type PropertyResult = { ok: true } | { ok: false; status: 400 | 404; message: string };

const SOURCES = new Set(['purchase', 'estimate', 'appraisal', 'index']);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface RecordValuationInput {
	valuedOn: string;
	valueMinor: bigint;
	source?: string;
	note?: string;
}

/**
 * Add a valuation, and keep `property.value_minor` as the latest of them.
 *
 * The column is not abandoned: every existing reader — net worth, the tiles, the
 * appreciation figure — goes on reading it, and it now means "the most recent
 * valuation" rather than "the only one". Writing a valuation dated in the past
 * therefore leaves today's figure alone, which is what makes entering history
 * safe.
 */
export async function recordValuation(
	propertyId: string,
	input: RecordValuationInput,
	handle: Db = db
): Promise<PropertyResult> {
	if (!ISO_DAY.test(input.valuedOn)) {
		return { ok: false, status: 400, message: 'A valuation needs a valid date.' };
	}
	if (input.valueMinor < 0n) {
		return { ok: false, status: 400, message: 'A property cannot be worth less than nothing.' };
	}
	const source = input.source && SOURCES.has(input.source) ? input.source : 'estimate';

	return handle.transaction(async (tx) => {
		const [existing] = await tx.select().from(property).where(eq(property.id, propertyId));
		if (!existing) return { ok: false as const, status: 404, message: 'Property not found.' };

		// One valuation per property per day: entering the same day twice is a
		// correction, not a second opinion.
		await tx
			.delete(propertyValuation)
			.where(
				and(
					eq(propertyValuation.propertyId, propertyId),
					eq(propertyValuation.valuedOn, input.valuedOn)
				)
			);

		await tx.insert(propertyValuation).values({
			id: uuidv7(),
			propertyId,
			valuedOn: input.valuedOn,
			valueMinor: input.valueMinor,
			currency: existing.currency,
			source,
			note: input.note?.trim() ?? ''
		});

		const [latest] = await tx
			.select()
			.from(propertyValuation)
			.where(eq(propertyValuation.propertyId, propertyId))
			.orderBy(desc(propertyValuation.valuedOn))
			.limit(1);
		if (latest) {
			await tx
				.update(property)
				.set({ valueMinor: latest.valueMinor, valuedOn: latest.valuedOn })
				.where(eq(property.id, propertyId));
		}
		return { ok: true as const };
	});
}

/** The series, oldest first, for plotting. */
export function valuationHistory(propertyId: string, handle: Db = db) {
	return handle
		.select()
		.from(propertyValuation)
		.where(eq(propertyValuation.propertyId, propertyId))
		.orderBy(asc(propertyValuation.valuedOn));
}

export interface OpeningInput {
	purchasedOn: string | null;
	priceMinor: bigint;
	costsMinor: bigint;
	depositMinor: bigint;
}

/**
 * What buying it actually cost, and what that makes money-in.
 *
 * Money-in is the household's own cash: the deposit plus the costs of buying.
 * The price itself is NOT money in — most of it is the bank's, and the part
 * that becomes the household's arrives slowly as the mortgage is repaid, which
 * the loan already records. Counting the whole price here would double it.
 */
export function moneyInFromOpening(input: { costsMinor: bigint; depositMinor: bigint }): bigint {
	return input.depositMinor + input.costsMinor;
}

export async function recordOpening(
	propertyId: string,
	input: OpeningInput,
	handle: Db = db
): Promise<PropertyResult> {
	if (input.purchasedOn !== null && !ISO_DAY.test(input.purchasedOn)) {
		return { ok: false, status: 400, message: 'The purchase date must be a valid date.' };
	}
	if (input.priceMinor < 0n || input.costsMinor < 0n || input.depositMinor < 0n) {
		return { ok: false, status: 400, message: 'These figures cannot be negative.' };
	}
	if (input.depositMinor > input.priceMinor && input.priceMinor > 0n) {
		return {
			ok: false,
			status: 400,
			message: 'The deposit cannot be more than the price.'
		};
	}

	return handle.transaction(async (tx) => {
		const [existing] = await tx.select().from(property).where(eq(property.id, propertyId));
		if (!existing) return { ok: false as const, status: 404, message: 'Property not found.' };

		await tx
			.insert(propertyOpening)
			.values({
				propertyId,
				purchasedOn: input.purchasedOn,
				priceMinor: input.priceMinor,
				costsMinor: input.costsMinor,
				depositMinor: input.depositMinor,
				currency: existing.currency
			})
			.onConflictDoUpdate({
				target: propertyOpening.propertyId,
				set: {
					purchasedOn: input.purchasedOn,
					priceMinor: input.priceMinor,
					costsMinor: input.costsMinor,
					depositMinor: input.depositMinor,
					currency: existing.currency
				}
			});

		await tx
			.update(property)
			.set({ moneyInMinor: moneyInFromOpening(input) })
			.where(eq(property.id, propertyId));

		// The purchase price is a valuation too — it is what somebody paid on a
		// known date — so the value series starts where the ownership did rather
		// than at whenever the household first typed an estimate.
		if (input.purchasedOn && input.priceMinor > 0n) {
			await tx
				.delete(propertyValuation)
				.where(
					and(
						eq(propertyValuation.propertyId, propertyId),
						eq(propertyValuation.valuedOn, input.purchasedOn)
					)
				);
			await tx.insert(propertyValuation).values({
				id: uuidv7(),
				propertyId,
				valuedOn: input.purchasedOn,
				valueMinor: input.priceMinor,
				currency: existing.currency,
				source: 'purchase',
				note: ''
			});
		}
		return { ok: true as const };
	});
}
