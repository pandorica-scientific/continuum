// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Files over /api/v1/files: a PDF attached to a record, filed as a document.
 *
 * The one way a token puts bytes on the data volume. The table API cannot —
 * every column naming a file is read-only there — because a name a caller
 * chose could only be another row's file or a path. Here the server mints the
 * name, so neither is possible.
 *
 * Reach follows the RECORD, not the document: a token limited to trips sees a
 * file because it is attached to a trip it reaches, and a file attached to
 * anything outside its areas as well is not its to see or delete. The one
 * exception is a token given Documents, which is the whole archive — every
 * document, whatever it is filed against, as the Documents screen shows it and
 * as `/api/v1/tables/document` already answers that token.
 *
 * Either way, a kind of paper that belongs to an area of its own — a payslip,
 * Salary's — needs that area as well.
 */
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db, type Queryable } from '$lib/server/db';
import { document, documentLink, entity } from '$lib/server/db/schema';
import { attachmentFiling, insertDocumentAggregate } from '$lib/server/documents/mutations';
import { enqueueExtraction } from '$lib/server/documents/extract/queue';
import { documentStoredName } from '$lib/server/documents/files';
import { removeDocumentRow } from '$lib/server/documents/lifecycle';
import { isFileableTarget } from '$lib/server/documents/targets';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { sniffFormat } from '$lib/server/import/format';
import { hashBytes, removeUpload, saveUploadBytes } from '$lib/server/system/files';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
import { tableReach } from './tables';
import { documentTypesOutOfReach, reaches, type ApiGrant } from './areas';
import { ApiError, refusingBadRows } from './errors';

/**
 * Enough of the file's start to tell what it is: the magic bytes, not the name
 * or the declared type, both of which are whatever the caller says. PDF only —
 * an HTML plan served from this origin could run script with the viewer's
 * session, and the plans this exists for arrive as PDFs.
 */
const SNIFF_BYTES = 16;

export interface AttachedFile {
	id: string;
	name: string;
	ext: string;
	addedOn: string;
	attachedTo: string[];
}

const NO_SUCH_RECORD = 'There is no record with that id this token reaches.';
const NO_SUCH_FILE = 'There is no file with that id this token reaches.';

/**
 * Whether the grant reaches this record, and a document may be filed against
 * it — through the archive's own check, so a file cannot land on a kind the
 * archive never shows, such as another document or a tag, nor on a trip that
 * is waiting to be swept. An entity's kind is its table's name.
 */
async function reachesRecord(grant: ApiGrant, id: string, handle: Queryable): Promise<boolean> {
	if (!(await isFileableTarget(id, handle))) return false;
	const [row] = await handle.select({ kind: entity.kind }).from(entity).where(eq(entity.id, id));
	return !!row && reaches(grant, tableReach(row.kind));
}

/**
 * Which of these documents the grant reaches: a token limited to some areas
 * reaches a document only when it reaches EVERY record the document is
 * attached to, and at least one. An unattached document is the archive's
 * alone, and the archive is the Documents area's. A payslip also needs Salary.
 */
async function reachableDocuments(
	grant: ApiGrant,
	documentIds: string[],
	handle: Queryable
): Promise<Set<string>> {
	if (grant.areas === null || documentIds.length === 0) return new Set(documentIds);
	const outOfReach = documentTypesOutOfReach(grant).map((t) => t.type);
	const kept =
		outOfReach.length === 0
			? documentIds
			: (
					await handle
						.select({ id: document.id })
						.from(document)
						.where(and(inArray(document.id, documentIds), notInArray(document.type, outOfReach)))
				).map((row) => row.id);
	if (reaches(grant, 'documents') || kept.length === 0) return new Set(kept);
	const links = await handle
		.select({ documentId: documentLink.documentId, kind: entity.kind })
		.from(documentLink)
		.innerJoin(entity, eq(entity.id, documentLink.targetId))
		.where(inArray(documentLink.documentId, kept));
	const reached = new Set(links.map((link) => link.documentId));
	for (const link of links) {
		if (!reaches(grant, tableReach(link.kind))) reached.delete(link.documentId);
	}
	return reached;
}

async function reachesDocument(
	grant: ApiGrant,
	documentId: string,
	handle: Queryable
): Promise<boolean> {
	return (await reachableDocuments(grant, [documentId], handle)).has(documentId);
}

async function targetsOf(ids: string[], handle: Db): Promise<Map<string, string[]>> {
	const links =
		ids.length === 0
			? []
			: await handle
					.select({ documentId: documentLink.documentId, targetId: documentLink.targetId })
					.from(documentLink)
					.where(inArray(documentLink.documentId, ids));
	const byDocument = new Map<string, string[]>();
	for (const link of links) {
		byDocument.set(link.documentId, [...(byDocument.get(link.documentId) ?? []), link.targetId]);
	}
	return byDocument;
}

export async function attachFile(
	grant: ApiGrant,
	input: { attachTo: string; name: string; file: Blob },
	handle: Db = db
): Promise<AttachedFile> {
	// Both before a byte is copied or written: an upload this token may not
	// make costs nothing but the request it arrived in.
	if (!(await reachesRecord(grant, input.attachTo, handle))) {
		// One answer for "no such record" and "not yours": a limited token must
		// not learn which ids exist outside its areas.
		throw new ApiError(NO_SUCH_RECORD, 404);
	}
	const head = new Uint8Array(await input.file.slice(0, SNIFF_BYTES).arrayBuffer());
	if (sniffFormat(head).format !== 'pdf') throw new ApiError('Only a PDF can be attached.', 415);

	const bytes = new Uint8Array(await input.file.arrayBuffer());
	const name = input.name.trim() || 'Attachment';
	const storedName = await saveUploadBytes(bytes, 'attachment.pdf');
	const id = uuidv7();
	const addedOn = new Date().toISOString().slice(0, 10);
	try {
		const shelfId = await shelfIdByKey(SYSTEM_SHELF_KEYS.inbox, handle);
		// Postgres' refusals — a NUL in the name, above all — are the caller's
		// to fix, so they answer 400 rather than 500.
		await refusingBadRows(() =>
			handle.transaction(async (tx) => {
				// Asked again with the record locked: one deleted or taken off the
				// board since the check above would otherwise be linked anyway, or
				// fail the insert with a 500. Deleting it now waits for this commit,
				// and takes the new link with it.
				await tx
					.select({ id: entity.id })
					.from(entity)
					.where(eq(entity.id, input.attachTo))
					.for('share');
				if (!(await reachesRecord(grant, input.attachTo, tx))) {
					throw new ApiError(NO_SUCH_RECORD, 404);
				}
				await insertDocumentAggregate(
					attachmentFiling({
						id,
						name,
						shelfId,
						storedName,
						ext: 'PDF',
						contentHash: hashBytes(bytes),
						targetId: input.attachTo,
						addedOn
					}),
					tx
				);
			})
		);
	} catch (error) {
		await removeUpload(storedName);
		throw error;
	}
	// After the commit, as `createDocument` does. Unlike a booking confirmation,
	// a plan is what somebody searches for later — "the Lofoten one" — and the
	// search says a document it cannot find words in is a scan without a text
	// layer, which a planner's PDF is not.
	await enqueueExtraction(id, handle);
	return { id, name, ext: 'PDF', addedOn, attachedTo: [input.attachTo] };
}

/**
 * The documents attached to one record, newest first.
 *
 * A token given Documents lists any record's paper, as it can already open
 * each piece and read every link under `/api/v1/tables`; any other token only
 * a record in its areas.
 */
export async function listAttached(
	grant: ApiGrant,
	recordId: string,
	handle: Db = db
): Promise<AttachedFile[]> {
	const listable = reaches(grant, 'documents')
		? await isFileableTarget(recordId, handle)
		: await reachesRecord(grant, recordId, handle);
	if (!listable) throw new ApiError(NO_SUCH_RECORD, 404);
	const rows = await handle
		.select({ id: document.id, name: document.name, ext: document.ext, addedOn: document.addedOn })
		.from(document)
		.innerJoin(documentLink, eq(documentLink.documentId, document.id))
		.where(eq(documentLink.targetId, recordId))
		.orderBy(desc(document.addedOn), desc(document.id));
	const reached = await reachableDocuments(
		grant,
		rows.map((row) => row.id),
		handle
	);
	const visible = rows.filter((row) => reached.has(row.id));
	const targets = await targetsOf(
		visible.map((row) => row.id),
		handle
	);
	return visible.map((row) => ({ ...row, attachedTo: targets.get(row.id) ?? [] }));
}

/** The stored name to serve, or a 404 for a document this token does not reach. */
export async function storedFileOf(
	grant: ApiGrant,
	documentId: string,
	handle: Db = db
): Promise<string> {
	const storedName = await documentStoredName(documentId, handle);
	if (!storedName || !(await reachesDocument(grant, documentId, handle))) {
		throw new ApiError(NO_SUCH_FILE, 404);
	}
	return storedName;
}

/**
 * Remove a document and its file, where the token reaches everything it is
 * attached to.
 *
 * Reach is asked inside the removal's transaction, with the document locked:
 * a link written meanwhile — to a record outside this token's areas — waits
 * for this to finish rather than being deleted along with a document the
 * token no longer wholly reaches. The file goes once the rows have.
 */
export async function removeFile(
	grant: ApiGrant,
	documentId: string,
	handle: Db = db
): Promise<void> {
	const removed = await handle.transaction(async (tx) => {
		const [row] = await tx
			.select({ id: document.id })
			.from(document)
			.where(eq(document.id, documentId))
			.for('update');
		if (!row || !(await reachesDocument(grant, documentId, tx))) {
			throw new ApiError(NO_SUCH_FILE, 404);
		}
		const outcome = await removeDocumentRow(documentId, tx);
		if (!outcome.ok) throw new ApiError(outcome.message, outcome.status);
		return outcome;
	});
	if (removed.storedName) await removeUpload(removed.storedName);
}
