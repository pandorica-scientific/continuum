// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Salary as it is recorded, from either direction.
 *
 * A payslip states GROSS. A bank credit is NET. One entry per person per month
 * carries both, so neither has to win and a month evidenced twice is one row
 * rather than two competing ones.
 */

import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db } from '$lib/server/db';
import { document, documentLink, salaryAttribution, salaryEntry } from '$lib/server/db/schema';

export type SalaryResult = { ok: true } | { ok: false; status: 400 | 404; message: string };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Shortest key that may be matched by prefix, so one does not become a wildcard. */
const MIN_KEY = 3;

export interface RecordSalaryInput {
	personId: string;
	periodMonth: string;
	currency: string;
	grossMinor?: bigint | null;
	netMinor?: bigint | null;
	/**
	 * What of gross was a bonus. Null means "not stated", which is not zero and
	 * must never overwrite a stored figure.
	 */
	bonusMinor?: bigint | null;
	source: 'payslip' | 'statement' | 'manual';
	documentId?: string | null;
	transactionId?: string | null;
	/** A figure somebody typed. Protects itself from later automatic readings. */
	overridden?: boolean;
}

/**
 * Write what is known about one month, without discarding what is already there.
 *
 * A payslip arriving after a bank credit fills the gross column and leaves the
 * net alone, and the other way round. A figure a person corrected by hand is
 * never overwritten by a later automatic reading — that flag is the whole
 * reason a derived entry can be edited at all.
 */
export async function recordSalary(
	input: RecordSalaryInput,
	handle: Db = db
): Promise<SalaryResult> {
	if (!MONTH.test(input.periodMonth)) {
		return { ok: false, status: 400, message: 'A salary entry needs a month like 2026-07.' };
	}
	// A bonus counts as a figure. A correction that says "25 000 of this month's
	// gross was an award" carries no gross of its own, and rejecting it would
	// make the bonus uncorrectable on any month the reader had not already filled.
	if (input.grossMinor == null && input.netMinor == null && input.bonusMinor == null) {
		return { ok: false, status: 400, message: 'A salary entry needs a gross or a net figure.' };
	}

	return handle.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(salaryEntry)
			.where(
				and(
					eq(salaryEntry.personId, input.personId),
					eq(salaryEntry.periodMonth, input.periodMonth)
				)
			);

		// Validated against what the month will HOLD, not only what arrived: a
		// bonus correction carries no gross of its own, so checking the input
		// alone would let a bonus through that is larger than the stored gross.
		const gross = input.grossMinor ?? existing?.grossMinor ?? null;
		const net = input.netMinor ?? existing?.netMinor ?? null;
		const bonus = input.bonusMinor ?? existing?.bonusMinor ?? null;
		if (gross !== null && net !== null && net > gross) {
			return {
				ok: false as const,
				status: 400 as const,
				message: 'Net pay cannot be more than gross.'
			};
		}
		if (gross !== null && bonus !== null && bonus > gross) {
			return {
				ok: false as const,
				status: 400 as const,
				message: 'A bonus cannot be more than the gross it is part of.'
			};
		}

		if (!existing) {
			await tx.insert(salaryEntry).values({
				id: uuidv7(),
				personId: input.personId,
				periodMonth: input.periodMonth,
				grossMinor: input.grossMinor ?? null,
				netMinor: input.netMinor ?? null,
				bonusMinor: input.bonusMinor ?? null,
				currency: input.currency,
				source: input.source,
				documentId: input.documentId ?? null,
				transactionId: input.transactionId ?? null,
				amountOverridden: input.overridden ?? false
			});
			return { ok: true as const };
		}

		// A hand-typed figure stands. Anything automatic that arrives later adds
		// what is missing rather than replacing what somebody decided.
		const keep = existing.amountOverridden && !input.overridden;
		await tx
			.update(salaryEntry)
			.set({
				grossMinor: keep
					? (existing.grossMinor ?? input.grossMinor ?? null)
					: (input.grossMinor ?? existing.grossMinor ?? null),
				netMinor: keep
					? (existing.netMinor ?? input.netMinor ?? null)
					: (input.netMinor ?? existing.netMinor ?? null),
				bonusMinor: keep
					? (existing.bonusMinor ?? input.bonusMinor ?? null)
					: (input.bonusMinor ?? existing.bonusMinor ?? null),
				documentId: input.documentId ?? existing.documentId,
				transactionId: input.transactionId ?? existing.transactionId,
				amountOverridden: existing.amountOverridden || (input.overridden ?? false)
			})
			.where(eq(salaryEntry.id, existing.id));
		return { ok: true as const };
	});
}

/**
 * The payslip filed for one person for one month.
 *
 * Scoped by shelf AND by month. The v0.4.5 arrangement took the first document
 * linked to the person that happened to have a file — so a tax statement could
 * be read looking for a payslip's bonus line, and August's correction could
 * learn January's wording.
 */
export async function payslipSlipFor(
	personId: string,
	periodMonth: string,
	handle: Db = db
): Promise<{ id: string; storedName: string | null } | null> {
	const rows = await handle
		.select({ id: document.id, storedName: document.storedName })
		.from(document)
		.innerJoin(documentLink, eq(documentLink.documentId, document.id))
		.where(
			and(
				eq(documentLink.targetId, personId),
				eq(document.shelf, 'payslips'),
				eq(document.periodOn, `${periodMonth}-01`)
			)
		)
		.limit(1);
	return rows[0] ?? null;
}

/** Every month recorded for a person, for salaryStats(). */
export function salaryMonths(personId: string, handle: Db = db) {
	return handle.select().from(salaryEntry).where(eq(salaryEntry.personId, personId));
}

/**
 * The employer, as a key that survives the noise a statement carries.
 *
 * Bank descriptions vary between months — a reference number, a period, a
 * changing case — so matching on the raw string would ask the same question
 * every payday. Letters and digits only, lowercased.
 */
export function attributionKey(counterparty: string): string {
	return counterparty
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * Whose salary a payment is.
 *
 * An account with an owner answers it outright. A joint account has to be
 * asked — once per employer, remembered here afterwards.
 */
export async function attributeSalary(
	input: { accountOwnerPersonId: string | null; counterparty: string | null; accountId: string },
	handle: Db = db
): Promise<{ personId: string } | { personId: null; askFor: string | null }> {
	if (input.accountOwnerPersonId) return { personId: input.accountOwnerPersonId };

	const key = input.counterparty ? attributionKey(input.counterparty) : '';
	if (!key) return { personId: null, askFor: null };

	// Every attribution, matched in code rather than in SQL: a stored key matches
	// when it is a PREFIX of what arrived, because a description carries the
	// period — "ACME CORP S.R.O. 07/2026" one month, 08/2026 the next. Exact
	// equality would ask the same question every payday, which is the thing this
	// exists to stop.
	//
	// A minimum length keeps that from becoming a wildcard: a two-letter key
	// would attach itself to half the ledger.
	const all = await handle.select().from(salaryAttribution);
	const learned = all.filter(
		(row) =>
			row.matchKey.length >= MIN_KEY && (key === row.matchKey || key.startsWith(row.matchKey + ' '))
	);

	// An attribution naming this account beats one that names none: a household
	// where both people are paid by the same employer is exactly the case a
	// key-only match would get wrong.
	const bySpecificity = [...learned].sort((a, b) => b.matchKey.length - a.matchKey.length);
	const forAccount = bySpecificity.find((row) => row.accountId === input.accountId);
	const forAny = bySpecificity.find((row) => row.accountId === null);
	const match = forAccount ?? forAny;
	return match ? { personId: match.personId } : { personId: null, askFor: key };
}

/** Remember the answer, so the question is asked once per employer. */
export async function rememberAttribution(
	input: { matchKey: string; personId: string; accountId?: string | null },
	handle: Db = db
): Promise<void> {
	const key = attributionKey(input.matchKey);
	if (!key) return;
	await handle.delete(salaryAttribution).where(eq(salaryAttribution.matchKey, key));
	await handle.insert(salaryAttribution).values({
		id: uuidv7(),
		matchKey: key,
		personId: input.personId,
		accountId: input.accountId ?? null
	});
}
