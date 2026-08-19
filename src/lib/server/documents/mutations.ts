import type { EnumValue } from '$lib/enums';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import {
	document,
	documentAccount,
	documentPerson,
	documentProperty,
	documentSubject,
	documentTag,
	subject
} from '$lib/server/db/schema';
import { upsertTag } from '$lib/server/tags';

export interface CreateDocumentInput {
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
			.values({ id: randomUUID(), name: input.newSubjectName, emoji: '📁' })
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

	if (input.personIds.length > 0) {
		await handle
			.insert(documentPerson)
			.values(input.personIds.map((personId) => ({ documentId: input.id, personId })))
			.onConflictDoNothing();
	}
	if (input.propertyIds.length > 0) {
		await handle
			.insert(documentProperty)
			.values(input.propertyIds.map((propertyId) => ({ documentId: input.id, propertyId })))
			.onConflictDoNothing();
	}
	if (input.accountIds.length > 0) {
		await handle
			.insert(documentAccount)
			.values(input.accountIds.map((accountId) => ({ documentId: input.id, accountId })))
			.onConflictDoNothing();
	}
	if (subjectIds.length > 0) {
		await handle
			.insert(documentSubject)
			.values(subjectIds.map((subjectId) => ({ documentId: input.id, subjectId })))
			.onConflictDoNothing();
	}

	for (const name of input.tagNames) {
		const resolved = await upsertTag(name, handle);
		await handle
			.insert(documentTag)
			.values({ documentId: input.id, tagId: resolved.id })
			.onConflictDoNothing();
	}
}
