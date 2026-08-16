import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { calendarConflict, document, loan, tenancy } from '$lib/server/db/schema';
import type { OriginBinding } from '$lib/calendar/keys';

// Write-back: a date moved in Google or iCloud, applied to the ledger row that
// produced the event.
//
// This is the one path where a calendar client edits ledger data, so it is
// deliberately narrow. Only DATE fields, only on rows that genuinely represent a
// scheduling fact, and every write is recorded — a household should be able to
// find out later why a lease end changed.

/**
 * The fields a remote date move may write, and nothing else.
 *
 * Not a list of "fields that happen to hold a date". Each of these is something
 * a person moving an event in their calendar plausibly MEANT to change:
 *
 *   loan.paymentDay          — the day of the month a payment leaves
 *   tenancy.endDate          — when a lease ends
 *   tenancy.renewalNoticeDate — when notice must be given
 *   document.expiresOn       — when a passport or policy lapses
 *
 * loanFixationPeriod.endDate is deliberately absent: it has a row, and moving it
 * re-cuts the interest schedule. That is not what dragging an event means.
 */
const WRITABLE: Record<string, ReadonlySet<string>> = {
	loan: new Set(['paymentDay']),
	tenancy: new Set(['endDate', 'renewalNoticeDate']),
	document: new Set(['expiresOn'])
};

export function bindingIsWritable(binding: OriginBinding | null): boolean {
	if (!binding) return false;
	return WRITABLE[binding.table]?.has(binding.field) ?? false;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What to store for a given binding and a new date.
 *
 * `loan.paymentDay` is a day-of-month integer rather than a date, so a move to
 * the 20th stores 20 — which is also why moving one month's payment moves every
 * month's. See applyWriteBack.
 */
export function writeBackValue(
	binding: OriginBinding | null,
	newDate: string
): string | number | null {
	if (!bindingIsWritable(binding)) return null;
	if (!ISO_DAY.test(newDate) || Number.isNaN(new Date(newDate).getTime())) return null;

	if (binding!.table === 'loan' && binding!.field === 'paymentDay') {
		return Number(newDate.slice(8, 10));
	}
	return newDate;
}

export interface WriteBackResult {
	ok: boolean;
	/** Human-readable, and shown in the briefing. */
	message: string;
}

/**
 * Apply a remote date move to the ledger, and record that it happened.
 *
 * The write and the record are one transaction: a change to a mortgage's payment
 * day that nobody can trace afterwards is worse than not making it.
 */
export async function applyWriteBack(
	binding: OriginBinding,
	newDate: string,
	context: { localKey: string; accountId: string; ours: unknown; theirs: unknown },
	handle: Db = db
): Promise<WriteBackResult> {
	const value = writeBackValue(binding, newDate);
	if (value === null) {
		return { ok: false, message: 'That change is not one a calendar edit can make.' };
	}

	return handle.transaction(async (tx) => {
		let message: string;

		if (binding.table === 'loan') {
			const [row] = await tx.select().from(loan).where(eq(loan.id, binding.rowId)).limit(1);
			if (!row) return { ok: false, message: 'The loan behind that event is gone.' };

			await tx
				.update(loan)
				.set({ paymentDay: value as number })
				.where(eq(loan.id, binding.rowId));

			// SAID PLAINLY, because it is genuinely surprising. paymentDay is a
			// day-of-month, so there is no way to move one month alone: the whole
			// schedule moves, past events included.
			message =
				`${row.name}: the payment day changed from ${row.paymentDay} to ${value} — ` +
				`every month, from a calendar edit.`;
		} else if (binding.table === 'tenancy') {
			const [row] = await tx.select().from(tenancy).where(eq(tenancy.id, binding.rowId)).limit(1);
			if (!row) return { ok: false, message: 'The tenancy behind that event is gone.' };

			const field = binding.field === 'endDate' ? 'endDate' : 'renewalNoticeDate';
			await tx
				.update(tenancy)
				.set({ [field]: value as string })
				.where(eq(tenancy.id, binding.rowId));

			message =
				field === 'endDate'
					? `${row.tenantName}: the lease end moved to ${value}, from a calendar edit.`
					: `${row.tenantName}: the renewal notice date moved to ${value}, from a calendar edit.`;
		} else {
			const [row] = await tx.select().from(document).where(eq(document.id, binding.rowId)).limit(1);
			if (!row) return { ok: false, message: 'The document behind that event is gone.' };

			await tx
				.update(document)
				.set({ expiresOn: value as string })
				.where(eq(document.id, binding.rowId));

			message = `${row.name}: the expiry moved to ${value}, from a calendar edit.`;
		}

		await tx.insert(calendarConflict).values({
			id: randomUUID(),
			localKey: context.localKey,
			accountId: context.accountId,
			ours: (context.ours ?? null) as never,
			theirs: (context.theirs ?? null) as never,
			resolution: 'wrote-back'
		});

		return { ok: true, message };
	});
}
