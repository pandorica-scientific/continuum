// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Removing a document, with everything that hangs off it.
 *
 * `deleteDocument` deletes a row. That is right for most paper — a bill keeps
 * its expense and loses its paperclip, because the link carries ON DELETE
 * CASCADE and nothing else pointed at it. It is wrong for a payslip: the
 * salary a month is credited with hangs off the document by a foreign key that
 * SET NULLs, so deleting the paper either left an unclaimed row for a month
 * with nothing behind it — invisible on screen and still counted in every
 * total — or, when the month already had one, collided with the partial unique
 * index that keeps exactly one and answered a person's tap with a 500.
 *
 * So removal is an operation of its own, and it orchestrates: the salary
 * module is asked to forget the payslip first, the document goes second, and
 * the file is unlinked last of all. The direction is deliberate — this module
 * may reach into `salary`, and `salary` must never reach back here, or "what a
 * month is worth" would depend on how paper is filed.
 *
 * A restricted document is ABSENT to a member, so a member's removal of one is
 * answered the way a removal of something already deleted is answered: 404,
 * same sentence. A 403 would confirm it exists.
 */

import { and, eq } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import { document } from '$lib/server/db/schema';
import { forgetPayslip, salaryEntryPeople } from '$lib/server/salary';
import { deleteDocumentRow, IMPORT_STATEMENT_REFUSAL } from './mutations';
import { removeUpload } from '$lib/server/system/files';
import { NO_SUCH_DOCUMENT, visibleDocumentPredicate, type Actor } from './visibility';

type RemoveDocumentResult = { ok: true } | { ok: false; status: 404 | 409; message: string };

/**
 * Thrown to unwind the transaction with an answer attached.
 *
 * A refusal has to roll back everything the removal had already done — the
 * salary rows above all — and a callback that simply RETURNS a failure would
 * commit them. Throwing is the only way to say "undo this" to a transaction,
 * so the answer travels with the throw and is unwrapped on the far side.
 */
class RemovalRefused extends Error {
	constructor(readonly outcome: RemoveDocumentResult & { ok: false }) {
		super(outcome.message);
	}
}

/**
 * Remove one document from the household, salary and file included.
 *
 * Everything that touches the database happens in one transaction, so a
 * refusal — a member who may not see it, or the statement an accepted import
 * filed for itself — leaves the household exactly as it was. The file is
 * unlinked only after that transaction has committed: a delete that rolls back
 * must not leave a record pointing at bytes that are gone.
 */
export async function removeDocument(
	documentId: string,
	actor: Actor | null,
	handle: Db = db
): Promise<RemoveDocumentResult> {
	let storedName: string | null = null;
	try {
		await handle.transaction(async (tx) => {
			// The read rule, in SQL and inside the transaction: a member must not
			// be able to remove — or learn the existence of — restricted paper.
			const [visible] = await tx
				.select({ id: document.id })
				.from(document)
				.where(and(eq(document.id, documentId), visibleDocumentPredicate(actor)))
				.limit(1);
			if (!visible) {
				throw new RemovalRefused({ ok: false, status: 404, message: NO_SUCH_DOCUMENT });
			}

			// Salary FIRST, before the row it hangs off is gone: the foreign key
			// would otherwise SET NULL underneath the delete below. Asked
			// unconditionally, because "is there any" is the same query
			// `forgetPayslip` opens with, and it answers ok when there is none.
			const forgotten = await forgetPayslip(documentId, tx);
			if (!forgotten.ok) {
				throw new RemovalRefused({ ok: false, status: 409, message: forgotten.message });
			}

			const removed = await deleteDocumentRow(documentId, tx);
			if (removed.refused) {
				throw new RemovalRefused({ ok: false, status: 409, message: IMPORT_STATEMENT_REFUSAL });
			}
			// Deleted between the visibility read and here. Nothing to undo, and
			// the answer is the one the household would expect.
			if (!removed.ok) {
				throw new RemovalRefused({ ok: false, status: 404, message: NO_SUCH_DOCUMENT });
			}
			storedName = removed.storedName;
		});
	} catch (error) {
		if (error instanceof RemovalRefused) return error.outcome;
		throw error;
	}

	// Committed. Only now are the bytes nobody's.
	if (storedName) await removeUpload(storedName);
	return { ok: true };
}

/** What an editor says when it will not make the change. One sentence, once. */
export const SALARY_ENTRY_REFUSAL =
	'This payslip carries a salary entry; delete it from the Salary screen to unhook it.';

/**
 * Which of these documents an edit must not be applied to.
 *
 * Two edits orphan the salary a month is credited with, and both are silent:
 * the tracker reads `type`, so retyping a payslip as anything else leaves a row
 * nothing on the Documents screen accounts for; and the entry belongs to a
 * PERSON, so unticking that person leaves paper stating somebody's pay with no
 * link to them. The figure keeps counting either way, and nothing on screen
 * says why.
 *
 * `keptTargetIds` is the whole set of links the edit intends to leave behind —
 * the inspector's form carries it. An edit that does not touch links at all
 * passes nothing, which is not the same as passing an empty list: the bulk bar
 * only ever ADDS links, so it can never untick the person an entry belongs to,
 * and reading its silence as "everything was unticked" would refuse a bulk edit
 * that takes nothing away.
 *
 * What the CALLER does with the answer differs on purpose. The inspector
 * refuses outright, because one document was asked about and the person can see
 * the whole answer. The bulk bar skips them and says how many it left, because
 * refusing forty documents over one is a bigger answer than the question.
 */
export async function salaryGuardedDocuments(
	documentIds: readonly string[],
	edit: { type: string; keptTargetIds?: readonly string[] },
	handle: Queryable = db
): Promise<string[]> {
	const people = await salaryEntryPeople(documentIds, handle);
	return documentIds.filter((id) => {
		const owners = people.get(id);
		if (!owners || owners.length === 0) return false;
		if (edit.type !== 'payslip') return true;
		if (edit.keptTargetIds === undefined) return false;
		return owners.some((personId) => !edit.keptTargetIds!.includes(personId));
	});
}
