// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { uuidv7 } from 'uuidv7';
import type { EnumValue } from '$lib/enums';
import { eq, sql } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import { document, documentLink, tagLink, subject } from '$lib/server/db/schema';
import { upsertTag } from '$lib/server/tags';
import { removeUpload } from '$lib/server/system/files';

interface CreateDocumentInput {
	id: string;
	name: string;
	shelf: EnumValue<'document.shelf'>;
	storedName: string | null;
	ext: string;
	addedOn: string;
	expiresOn: string | null;
	expiryVerb: EnumValue<'document.expiry_verb'>;
	personIds: string[];
	propertyIds: string[];
	accountIds: string[];
	/**
	 * Transactions this document belongs to — a receipt against the payment it
	 * evidences. Needs no table of its own: the far end of a document link is an
	 * `entity`, and `transaction` is a registered kind.
	 */
	transactionIds: string[];
	subjectIds: string[];
	newSubjectName?: string;
	tagNames: string[];
}

export async function createDocument(input: CreateDocumentInput, handle: Db = db): Promise<void> {
	await handle.transaction((tx) => insertDocumentAggregate(input, tx));
}

/** Insert a complete document aggregate using the transaction a caller owns. */
export async function insertDocumentAggregate(
	input: CreateDocumentInput,
	handle: Queryable
): Promise<void> {
	const subjectIds = [...input.subjectIds];
	if (input.newSubjectName) {
		await handle
			.insert(subject)
			.values({ id: uuidv7(), name: input.newSubjectName, emoji: '📁' })
			.onConflictDoNothing();
		const existing = await handle
			.select({ id: subject.id })
			.from(subject)
			.where(sql`lower(${subject.name}) = ${input.newSubjectName.toLowerCase()}`);
		subjectIds.push(existing[0].id);
	}

	await handle.insert(document).values({
		id: input.id,
		name: input.name,
		shelf: input.shelf,
		storedName: input.storedName,
		ext: input.ext,
		addedOn: input.addedOn,
		expiresOn: input.expiresOn,
		expiryVerb: input.expiryVerb
	});

	// Four inserts became one. The far end of a document link is an `entity`, so
	// what a target IS no longer decides which table the link goes in — which is
	// what stops a new module needing a document_<thing> table of its own.
	const targetIds = [
		...input.personIds,
		...input.propertyIds,
		...input.accountIds,
		...input.transactionIds,
		...subjectIds
	];
	if (targetIds.length > 0) {
		await handle
			.insert(documentLink)
			.values(targetIds.map((targetId) => ({ documentId: input.id, targetId })))
			.onConflictDoNothing();
	}

	for (const name of input.tagNames) {
		const resolved = await upsertTag(name, handle);
		await handle
			.insert(tagLink)
			.values({ tagId: resolved.id, targetId: input.id })
			.onConflictDoNothing();
	}
}

/**
 * Remove a document from the household entirely: the record, everything it was
 * linked to, and the uploaded file behind it.
 *
 * Only the `document` row is deleted here. The AFTER DELETE trigger on the
 * table retires its `entity` row, and every link — document_link at both ends,
 * tag_link — carries ON DELETE CASCADE from there, so the connectors go with
 * it. Enumerating them in application code would be a second, quietly
 * divergent copy of a rule the database already enforces.
 *
 * The file is unlinked after the row is gone, not before: a delete that fails
 * must not leave a record pointing at a file that is no longer there.
 */
export async function deleteDocument(
	documentId: string,
	handle: Db = db
): Promise<{ ok: boolean; removedFile: boolean }> {
	const [row] = await handle
		.delete(document)
		.where(eq(document.id, documentId))
		.returning({ storedName: document.storedName });
	if (!row) return { ok: false, removedFile: false };
	const removedFile = row.storedName ? await removeUpload(row.storedName) : false;
	return { ok: true, removedFile };
}
