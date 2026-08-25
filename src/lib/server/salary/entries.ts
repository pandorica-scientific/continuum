// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Salary as it is recorded, from either direction.
 *
 * A payslip states GROSS. A bank credit is NET. One entry per person per month
 * carries both, so neither has to win and a month evidenced twice is one row
 * rather than two competing ones.
 */

import { and, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db } from '$lib/server/db';
import {
	document,
	documentLink,
	person,
	salaryAttribution,
	salaryEntry
} from '$lib/server/db/schema';
import { hashStoredUpload } from '$lib/server/system/files';

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
	/**
	 * The statement being corrected, when the caller knows which.
	 *
	 * A month can hold several — one per payslip, plus the one the bank credit
	 * and hand-typed figures share — so a correction made on screen has to name
	 * the row it means rather than leaving it to be worked out from the month.
	 */
	entryId?: string;
	/** A figure somebody typed. Protects itself from later automatic readings. */
	overridden?: boolean;
	/**
	 * Write `currency` over an entry that already exists.
	 *
	 * Off by default, and deliberately explicit rather than always-on. An entry
	 * holds one currency for a month that can be evidenced twice — a payslip
	 * stating gross and a bank credit stating net — so a statement in the
	 * account's currency landing on a payslip month must not silently relabel the
	 * gross beside it. Only a caller restating what the month IS says yes: a
	 * re-uploaded payslip, or somebody correcting the currency by hand.
	 */
	restateCurrency?: boolean;
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
		const forMonth = await tx
			.select()
			.from(salaryEntry)
			.where(
				and(
					eq(salaryEntry.personId, input.personId),
					eq(salaryEntry.periodMonth, input.periodMonth)
				)
			);

		/**
		 * Which statement of this month this recording is about.
		 *
		 * A month held exactly one row until v0.5.5, so a second employer's slip
		 * simply overwrote the first and a month worked twice reported half its
		 * pay. The evidence is what tells two statements apart:
		 *
		 * - a payslip finds ITS OWN document's row, so re-uploading the same slip
		 *   still corrects rather than duplicates;
		 * - failing that, it takes the row no payslip has claimed yet, which is
		 *   how a bank credit already recorded gets its gross filled in;
		 * - a bank credit or a hand-typed figure takes the unclaimed row, and
		 *   there is only ever one of those per month.
		 *
		 * `entryId` overrides all of it: a correction made on screen names the row
		 * it is correcting, which is the only unambiguous answer once a month can
		 * hold several.
		 */
		const unclaimed = forMonth.find((row) => row.documentId === null);
		const existing = input.entryId
			? forMonth.find((row) => row.id === input.entryId)
			: input.documentId
				? (forMonth.find((row) => row.documentId === input.documentId) ?? unclaimed)
				: unclaimed;

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
				currency: input.restateCurrency ? input.currency : existing.currency,
				documentId: input.documentId ?? existing.documentId,
				transactionId: input.transactionId ?? existing.transactionId,
				amountOverridden: existing.amountOverridden || (input.overridden ?? false)
			})
			.where(eq(salaryEntry.id, existing.id));
		return { ok: true as const };
	});
}

/**
 * The stored document one statement was read from.
 *
 * By document id, which is the only unambiguous key since v0.5.5: the old
 * by-month lookup took the first payslip of the month with `.limit(1)`, and a
 * month may now hold two. The id always comes from `salaryEntry.documentId`, so
 * it is already the payslip of that statement and needs no shelf guard.
 */
export async function slipDocument(
	documentId: string,
	handle: Db = db
): Promise<{ id: string; storedName: string | null } | null> {
	const [row] = await handle
		.select({ id: document.id, storedName: document.storedName })
		.from(document)
		.where(eq(document.id, documentId));
	return row ?? null;
}

/** The statements of one person's month that came from a payslip. */
export function payslipStatementsFor(personId: string, periodMonth: string, handle: Db = db) {
	return handle
		.select({ id: salaryEntry.id })
		.from(salaryEntry)
		.where(
			and(
				eq(salaryEntry.personId, personId),
				eq(salaryEntry.periodMonth, periodMonth),
				isNotNull(salaryEntry.documentId)
			)
		);
}

/**
 * One statement and whose it is.
 *
 * Every correction names an ENTRY rather than a month, because a month can hold
 * more than one — two jobs are two payslips — and "the entry for August" stopped
 * being a question with an answer. The person is read from the row rather than
 * trusted from the form: an id in a POST body is whatever the sender put there.
 */
export async function entryWithOwner(entryId: string, handle: Db = db) {
	const [entry] = await handle.select().from(salaryEntry).where(eq(salaryEntry.id, entryId));
	if (!entry) return null;
	const [owner] = await handle
		.select({ name: person.name })
		.from(person)
		.where(eq(person.id, entry.personId));
	return owner ? { entry, owner } : null;
}

/** The month a document covers, from the first-of-month date it is filed under. */
const monthOf = (periodOn: string | null) => (periodOn ? periodOn.slice(0, 7) : null);

/**
 * The payslip already on this person's shelf that IS this file.
 *
 * A month has held more than one payslip since v0.5.5 — two jobs are two slips
 * — and an upload only ever adds. That is right for two employers and wrong for
 * the same slip dropped in twice: a second upload mints a second document id,
 * which is a second row by definition, and the month then reports double pay.
 *
 * The bytes decide, not the figures. Two jobs paying the same amount in the
 * same month are a real arrangement and must never be merged into one, while
 * the same file is the same file whatever the browser called it.
 *
 * Scoped to this person's payslips shelf: the same PDF filed for two people is
 * two statements, and a tax attachment is not a payslip.
 */
export async function payslipMatchingContent(
	personId: string,
	contentHash: string,
	handle: Db = db
): Promise<{ id: string; periodMonth: string | null } | null> {
	const onShelf = (...where: (SQL | undefined)[]) =>
		handle
			.select({
				id: document.id,
				storedName: document.storedName,
				periodOn: document.periodOn
			})
			.from(document)
			.innerJoin(documentLink, eq(documentLink.documentId, document.id))
			.where(and(eq(documentLink.targetId, personId), eq(document.shelf, 'payslips'), ...where));

	// The steady-state answer, and the reason `content_hash` carries an index.
	const [known] = await onShelf(eq(document.contentHash, contentHash)).limit(1);
	if (known) return { id: known.id, periodMonth: monthOf(known.periodOn) };

	// Only then the slips filed before there was a column to hold a hash. They
	// are fingerprinted here rather than by a migration nobody upgrading would
	// have run — a shrinking set, read together and written back together, so
	// the shelf converges after one upload and this pass then finds nothing.
	const unhashed = await onShelf(isNull(document.contentHash), isNotNull(document.storedName));
	if (unhashed.length === 0) return null;

	const hashed = await Promise.all(
		unhashed.map(async (row) => ({ row, hash: await hashStoredUpload(row.storedName ?? '') }))
	);
	// A file that has gone missing cannot be matched against, and is left
	// unhashed rather than marked — a restored volume is picked up next time.
	await Promise.all(
		hashed
			.filter((h) => h.hash !== null)
			.map((h) =>
				handle.update(document).set({ contentHash: h.hash }).where(eq(document.id, h.row.id))
			)
	);
	const match = hashed.find((h) => h.hash === contentHash);
	return match ? { id: match.row.id, periodMonth: monthOf(match.row.periodOn) } : null;
}

/**
 * Move the statement a re-uploaded slip produced to the month this upload says.
 *
 * The same file cannot be two statements, so a re-upload that names a different
 * month RESTATES the row rather than adding one beside it. Without this the
 * entry keeps the month it was first filed under and the correction lands as a
 * second row — the very thing recognising the file was supposed to prevent.
 */
export async function restateSlipMonth(
	personId: string,
	documentId: string,
	periodMonth: string,
	handle: Db = db
): Promise<void> {
	await handle
		.update(salaryEntry)
		.set({ periodMonth })
		.where(and(eq(salaryEntry.personId, personId), eq(salaryEntry.documentId, documentId)));
}

/**
 * File the DOCUMENT side of a payslip: a new one, or the one already there.
 *
 * Both upload actions wrote this by hand and had already drifted — the name
 * format, the shelf, how `ext` is derived and the first-of-month `periodOn`
 * convention lived in two places, and `content_hash` had to be remembered in
 * both. A third spelling sat in the re-file path. One function, so the next
 * column on a payslip document is a one-site edit.
 *
 * `existingId` is the slip this upload was recognised as: its document is
 * restated in place, statement included, rather than a second one being made.
 */
export async function filePayslipDocument(
	input: {
		personId: string;
		subject: string;
		periodMonth: string;
		currency: string;
		storedName: string | null;
		contentHash: string | null;
		existingId?: string;
	},
	handle: Db = db
): Promise<string> {
	const { personId, subject, periodMonth, currency, storedName, contentHash } = input;
	const name = `Payslip ${periodMonth} · ${subject}`;
	const periodOn = `${periodMonth}-01`;

	if (input.existingId) {
		const existingId = input.existingId;
		await handle.transaction(async (tx) => {
			await restateSlipMonth(personId, existingId, periodMonth, tx);
			await tx
				.update(document)
				.set({ name, currency, periodOn })
				.where(eq(document.id, existingId));
		});
		return existingId;
	}

	const documentId = uuidv7();
	await handle.transaction(async (tx) => {
		await tx.insert(document).values({
			id: documentId,
			name,
			shelf: 'payslips',
			storedName,
			ext: storedName ? (storedName.split('.').pop() ?? 'pdf').toUpperCase() : 'PDF',
			addedOn: new Date().toISOString().slice(0, 10),
			currency,
			periodOn,
			contentHash
		});
		await tx.insert(documentLink).values({ documentId, targetId: personId }).onConflictDoNothing();
	});
	return documentId;
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
