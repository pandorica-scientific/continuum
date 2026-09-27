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
import { db, type Db } from '$lib/server/db';
import { document, documentLink, entity } from '$lib/server/db/schema';
import { insertDocumentAggregate } from '$lib/server/documents/mutations';
import { removeDocument } from '$lib/server/documents/lifecycle';
import { isFileableTarget } from '$lib/server/documents/targets';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { hashBytes, removeUpload, saveUploadBytes } from '$lib/server/system/files';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
import { tableReach } from './tables';
import { documentTypesOutOfReach, reaches, type ApiGrant } from './areas';
import { ApiError } from './errors';

/**
 * The magic bytes, not the name or the declared type: both are whatever the
 * caller says. PDF only — an HTML plan served from this origin could run script
 * with the viewer's session, and the plans this exists for arrive as PDFs.
 */
function isPdf(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 5 &&
		bytes[0] === 0x25 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x44 &&
		bytes[3] === 0x46 &&
		bytes[4] === 0x2d
	);
}

export interface AttachedFile {
	id: string;
	name: string;
	ext: string;
	addedOn: string;
	attachedTo: string[];
}

/**
 * Whether the grant reaches this record, and a document may be filed against
 * it — through the archive's own check, so a file cannot land on a kind the
 * archive never shows, such as another document or a tag. An entity's kind is
 * its table's name.
 */
async function reachesRecord(grant: ApiGrant, id: string, handle: Db): Promise<boolean> {
	if (!(await isFileableTarget(id, handle))) return false;
	const [row] = await handle.select({ kind: entity.kind }).from(entity).where(eq(entity.id, id));
	return !!row && reaches(grant, tableReach(row.kind) ?? 'shared');
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
	handle: Db
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
		if (!reaches(grant, tableReach(link.kind) ?? 'shared')) reached.delete(link.documentId);
	}
	return reached;
}

async function reachesDocument(grant: ApiGrant, documentId: string, handle: Db): Promise<boolean> {
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
	input: { attachTo: string; name: string; bytes: Uint8Array },
	handle: Db = db
): Promise<AttachedFile> {
	if (!(await reachesRecord(grant, input.attachTo, handle))) {
		// One answer for "no such record" and "not yours": a limited token must
		// not learn which ids exist outside its areas.
		throw new ApiError('There is no record with that id this token reaches.', 404);
	}
	if (!isPdf(input.bytes)) throw new ApiError('Only a PDF can be attached.', 415);

	const storedName = await saveUploadBytes(input.bytes, 'attachment.pdf');
	const id = uuidv7();
	const addedOn = new Date().toISOString().slice(0, 10);
	try {
		const shelfId = await shelfIdByKey(SYSTEM_SHELF_KEYS.inbox, handle);
		// Not `createDocument`, which also queues text extraction: a plan is read
		// by the household, not searched for, as a booking confirmation is.
		await handle.transaction((tx) =>
			insertDocumentAggregate(
				{
					id,
					name: input.name.trim() || 'Attachment',
					shelfId,
					type: 'other',
					note: null,
					storedName,
					ext: 'PDF',
					addedOn,
					expiresOn: null,
					expiryVerb: 'expires',
					targetIds: [input.attachTo],
					tagNames: [],
					contentHash: hashBytes(input.bytes)
				},
				tx
			)
		);
	} catch (error) {
		await removeUpload(storedName);
		throw error;
	}
	return {
		id,
		name: input.name.trim() || 'Attachment',
		ext: 'PDF',
		addedOn,
		attachedTo: [input.attachTo]
	};
}

/** The documents attached to one record, newest first. */
export async function listAttached(
	grant: ApiGrant,
	recordId: string,
	handle: Db = db
): Promise<AttachedFile[]> {
	if (!(await reachesRecord(grant, recordId, handle))) {
		throw new ApiError('There is no record with that id this token reaches.', 404);
	}
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
	const [row] = await handle
		.select({ storedName: document.storedName })
		.from(document)
		.where(eq(document.id, documentId));
	if (!row?.storedName || !(await reachesDocument(grant, documentId, handle))) {
		throw new ApiError('There is no file with that id this token reaches.', 404);
	}
	return row.storedName;
}

/** Remove a document and its file, where the token reaches everything it is attached to. */
export async function removeFile(
	grant: ApiGrant,
	documentId: string,
	handle: Db = db
): Promise<void> {
	const [row] = await handle
		.select({ id: document.id })
		.from(document)
		.where(eq(document.id, documentId));
	if (!row || !(await reachesDocument(grant, documentId, handle))) {
		throw new ApiError('There is no file with that id this token reaches.', 404);
	}
	const removed = await removeDocument(documentId, handle);
	if (!removed.ok) throw new ApiError(removed.message, removed.status);
}
