// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Database side of tax statements: load, upsert, delete. All arithmetic lives
// in the pure module; nothing here computes what is owed.

import { uuidv7 } from 'uuidv7';
import { and, eq } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import {
	document,
	documentLink,
	person,
	taxStatement,
	taxStatementLine
} from '$lib/server/db/schema';
import { insertDocumentAggregate } from '$lib/server/documents/mutations';
import { documentsAbout } from '$lib/server/documents/targets';
import type { Actor } from '$lib/server/documents/visibility';
import { enqueueExtraction } from '$lib/server/documents/extract/queue';
import { shelfIdByKey } from '$lib/server/documents/shelves';
// Naming a filed document needs no database, and the screen renders the same
// kinds this module files under — so both live in the pure module. Re-exported
// because callers have always reached for it here.
import { attachmentKind, statementDocumentName, type AttachmentKind } from '$lib/tax';

export { statementDocumentName };

/**
 * A file uploaded with a statement, to be filed on the Finance shelf and linked to
 * the statement in one commit.
 *
 * The screen used to assume the paperwork had already been filed elsewhere: the
 * only way to attach it was to pick from a list of tax documents that someone
 * had to go and create first, on another screen, before the statement could be
 * recorded. Recording the statement and filing the paper it came from are one
 * act, so they are one save.
 */
export interface StatementAttachment {
	/** The stored upload's name on the data volume, from `saveUpload`. */
	storedName: string;
	ext: string;
	addedOn: string;
	kind: AttachmentKind;
	/**
	 * The name the browser sent. Used only to break a collision between two
	 * attachments of one kind in one year — never as the document's own name,
	 * because a scan called `scan_0043.pdf` identifies nothing.
	 */
	original?: string;
	/** SHA-256 of the upload's own bytes, from `hashBytes`. */
	contentHash?: string | null;
}

interface StatementInput {
	personId: string;
	year: number;
	country: string;
	currency: string;
	grossIncomeMinor: bigint;
	taxPaidMinor: bigint;
	note: string | null;
	lines: { label: string; amountMinor: bigint }[];
	/** Uploads to file on the Finance shelf and link, in this same commit. */
	attachments: StatementAttachment[];
	/** Documents already on the shelf, to link without filing anything new. */
	linkDocumentIds: string[];
}

type TaxResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * Every statement, with the paper this reader is allowed to know about.
 *
 * The statement itself is never hidden: what was declared and what was paid are
 * the tax module's own figures, and D2 hides the document, not the record. Only
 * the attachments list shortens.
 */
export async function loadStatements(actor: Actor | null, handle: Db = db) {
	const [rows, lines, people] = await Promise.all([
		handle.select().from(taxStatement),
		handle.select().from(taxStatementLine),
		handle.select({ id: person.id, name: person.name }).from(person)
	]);

	// One `documentsAbout` call per statement, which is THE query behind every
	// documents card — read-rule and shelf label included, rather than a
	// bespoke join this module kept its own copy of. A household files a
	// handful of statements a year, never hundreds, so a call per row stays a
	// few round trips rather than the one-query-per-record cost a hot loop
	// would be.
	const attachments = await Promise.all(rows.map((r) => documentsAbout(r.id, actor, handle)));

	const personName = new Map(people.map((p) => [p.id, p.name]));
	return rows.map((r, i) => ({
		...r,
		personName: personName.get(r.personId) ?? '—',
		attachments: attachments[i],
		lines: lines
			.filter((l) => l.statementId === r.id)
			.sort((a, b) => a.sort - b.sort)
			.map((l) => ({ label: l.label, amountMinor: l.amountMinor }))
	}));
}

/**
 * File a batch of uploads against a statement and link each one to it.
 *
 * Names collide when two files of one kind land in one year, so a name already
 * linked to this statement forces the newcomer to carry the file it came from.
 * Checked against what is STORED, not just within the batch: the second broker
 * report might arrive a week after the first.
 *
 * Returns the id of every document it just filed, so a caller can ask for
 * extraction once ITS OWN transaction — which this function only ever
 * borrows, never opens — has actually committed.
 */
export async function attachDocumentsToStatement(
	statementId: string,
	personId: string,
	year: number,
	country: string,
	attachments: StatementAttachment[],
	handle: Queryable
): Promise<string[]> {
	if (attachments.length === 0) return [];

	const linked = await handle
		.select({ name: document.name })
		.from(documentLink)
		.innerJoin(document, eq(document.id, documentLink.documentId))
		.where(eq(documentLink.targetId, statementId));
	const taken = new Set(linked.map((row) => row.name));

	const filedIds: string[] = [];
	for (const attachment of attachments) {
		const plain = statementDocumentName(year, country, attachment.kind);
		const name = taken.has(plain)
			? statementDocumentName(year, country, attachment.kind, attachment.original)
			: plain;
		taken.add(name);

		const documentId = uuidv7();
		await insertDocumentAggregate(
			{
				id: documentId,
				name,
				// The `tax` shelf is gone: a tax document is finance paperwork with
				// a type that says so, which survives a household renaming shelves.
				shelfId: await shelfIdByKey('finance', handle),
				type: 'tax_document',
				storedName: attachment.storedName,
				ext: attachment.ext,
				addedOn: attachment.addedOn,
				expiresOn: null,
				expiryVerb: 'expires',
				contentHash: attachment.contentHash ?? null,
				// Filed against whose statement it is. Without this link the
				// documents screen builds no column for it, so a document filed
				// here would be missing from the household's own files.
				personIds: [personId],
				propertyIds: [],
				accountIds: [],
				transactionIds: [],
				subjectIds: [],
				tagNames: [attachmentKind(attachment.kind).tag]
			},
			handle
		);
		await handle
			.insert(documentLink)
			.values({ documentId, targetId: statementId })
			.onConflictDoNothing();
		filedIds.push(documentId);
	}
	return filedIds;
}

/**
 * Unlink one document from one statement.
 *
 * The document stays on the Finance shelf, still filed against the person. Deleting
 * filed paperwork is the documents screen's job, and it asks twice first.
 */
export async function detachDocument(
	statementId: string,
	documentId: string,
	handle: Db = db
): Promise<{ ok: boolean }> {
	const removed = await handle
		.delete(documentLink)
		.where(and(eq(documentLink.targetId, statementId), eq(documentLink.documentId, documentId)))
		.returning({ documentId: documentLink.documentId });
	return { ok: removed.length > 0 };
}

/**
 * One statement per person per country per year: an existing one is updated in
 * place and its lines replaced wholesale — the same contract tags use.
 */
export async function saveStatement(input: StatementInput, handle: Db = db): Promise<TaxResult> {
	if (!input.personId) return { ok: false, status: 400, message: 'Pick whose statement this is.' };
	if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 2200)
		return { ok: false, status: 400, message: 'That year does not look right.' };
	if (!input.country.trim()) return { ok: false, status: 400, message: 'Name the country.' };
	const currency = input.currency.trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency))
		return { ok: false, status: 400, message: 'Use a three-letter currency code.' };
	if (input.grossIncomeMinor < 0n || input.taxPaidMinor < 0n)
		return { ok: false, status: 400, message: 'Figures on a statement cannot be negative.' };

	const country = input.country.trim().toUpperCase();
	const values = {
		personId: input.personId,
		year: input.year,
		country,
		currency,
		grossIncomeMinor: input.grossIncomeMinor,
		taxPaidMinor: input.taxPaidMinor,
		note: input.note
	};

	let filedDocumentIds: string[] = [];
	await handle.transaction(async (tx) => {
		// The statement goes in FIRST, which reverses what this did before
		// v0.4.3. A document is no longer pointed at by a column on the statement
		// — it is linked to the statement's `entity` row, and that row does not
		// exist until the statement is inserted. Same transaction either way, so
		// a statement that fails to save still cannot leave its paperwork filed
		// on the shelf on its own.
		//
		// The unique key resolves concurrent saves of the same statement and
		// RETURNING gives us the winning row id.
		const saved = await tx
			.insert(taxStatement)
			.values({ id: uuidv7(), ...values })
			.onConflictDoUpdate({
				target: [taxStatement.personId, taxStatement.year, taxStatement.country],
				set: values
			})
			.returning({ id: taxStatement.id });
		const id = saved[0].id;

		filedDocumentIds = await attachDocumentsToStatement(
			id,
			input.personId,
			input.year,
			country,
			input.attachments,
			tx
		);

		// A document already on the shelf is linked, never re-filed. Filing a
		// second copy of paper the household already has is how a shelf fills
		// with duplicates nobody can tell apart.
		if (input.linkDocumentIds.length > 0) {
			await tx
				.insert(documentLink)
				.values(input.linkDocumentIds.map((documentId) => ({ documentId, targetId: id })))
				.onConflictDoNothing();
		}

		// Replacing the lines in this same transaction means a failed insert can
		// never leave an empty statement.
		await tx.delete(taxStatementLine).where(eq(taxStatementLine.statementId, id));
		if (input.lines.length > 0) {
			await tx.insert(taxStatementLine).values(
				input.lines.map((line, sort) => ({
					id: uuidv7(),
					statementId: id,
					label: line.label,
					amountMinor: line.amountMinor,
					sort
				}))
			);
		}
	});
	// After the commit, never inside it: a queued job pointing at a document
	// the transaction went on to roll back is work with nothing to read.
	for (const documentId of filedDocumentIds) await enqueueExtraction(documentId, handle);
	return { ok: true };
}

export async function deleteStatement(id: string): Promise<TaxResult> {
	await db.delete(taxStatement).where(eq(taxStatement.id, id));
	return { ok: true };
}
