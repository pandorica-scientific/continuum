// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Everything the Documents screen reads, in one place and one round of queries.
 *
 * Lives here rather than in `+page.server.ts` because it is a domain read: the
 * archive scope is the archive's invariant, and a route building its own
 * selects is free to forget it.
 *
 * The shaping stays in the route. What comes back here is rows; turning them
 * into chips, groups and counts is presentation and belongs with the markup.
 */
import { and, count, eq, getTableColumns, inArray, type SQL } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import {
	document,
	documentIdentity,
	documentLink,
	documentText,
	entity,
	job,
	shelf as shelfTable,
	tag,
	tagLink
} from '$lib/server/db/schema';

export interface DocumentsScreenRead {
	/** The archive scope, which is what decides the list and the rail counts. */
	readable: SQL | undefined;
}

/**
 * One trip for the whole screen.
 *
 * `Promise.all` rather than sequential awaits: none of these depends on
 * another, and a documents screen that opens in eleven round trips is a
 * documents screen that feels slow on the one machine it runs on.
 */
export async function readDocumentsScreen(
	{ readable }: DocumentsScreenRead,
	handle: Queryable = db
) {
	const [docs, railCounts, everywhereCount, docLinks, docTags, tags, texts, pending, identities] =
		await Promise.all([
			// The shelf key travels with the row: the label is the household's to
			// change, so neither may be a code list.
			handle
				.select({
					...getTableColumns(document),
					shelfKey: shelfTable.key,
					shelfLabel: shelfTable.label
				})
				.from(document)
				.innerJoin(shelfTable, eq(shelfTable.id, document.shelfId))
				.where(readable)
				.orderBy(document.addedOn),
			// Rail counts are computed in SQL, after the archive scope and nothing else.
			// They deliberately ignore the search term and the active tag: a rail
			// whose numbers move as you type cannot be used to navigate.
			handle
				.select({ key: shelfTable.key, n: count() })
				.from(document)
				.innerJoin(shelfTable, eq(shelfTable.id, document.shelfId))
				.where(readable)
				.groupBy(shelfTable.key),
			// Without the archive scope, which is how many are being hidden.
			handle.select({ n: count() }).from(document),
			handle
				.select({
					documentId: documentLink.documentId,
					targetId: documentLink.targetId,
					kind: entity.kind
				})
				.from(documentLink)
				.innerJoin(entity, eq(entity.id, documentLink.targetId)),
			handle.select({ documentId: tagLink.targetId, tagId: tagLink.tagId }).from(tagLink),
			handle.select({ id: tag.id, name: tag.name }).from(tag),
			handle
				.select({
					documentId: documentText.documentId,
					complete: documentText.complete,
					pagesExtracted: documentText.pagesExtracted,
					engine: documentText.engine,
					engineVersion: documentText.engineVersion,
					meanConfidence: documentText.meanConfidence,
					languages: documentText.languages
				})
				.from(documentText),
			handle
				.select({ documentId: job.subjectId })
				.from(job)
				.where(and(eq(job.kind, 'extract_text'), inArray(job.state, ['queued', 'running']))),
			// Whole table rather than by id: a household has a handful, cheaper than
			// a second round trip once the selected document turns out to be one.
			handle.select().from(documentIdentity)
		]);

	return { docs, railCounts, everywhereCount, docLinks, docTags, tags, texts, pending, identities };
}
