// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Everything the Documents screen reads, in one place and one round of queries.
 *
 * It lives here rather than in `+page.server.ts` because it is a domain read,
 * not a route concern: the read rule is the archive's invariant, and a route
 * that builds its own selects is free to forget it. Eleven hand-written queries
 * sat in the route beside a fully-formed domain package — which is how a screen
 * ends up being the second place that knows how a document is stored.
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
	readable: SQL | undefined;
	/**
	 * The read rule WITHOUT the archive half, which is how many are being
	 * hidden. Separate on purpose: the two answer different questions and a
	 * single predicate cannot give both.
	 */
	readableEverywhere: SQL | undefined;
}

/**
 * One trip for the whole screen.
 *
 * `Promise.all` rather than sequential awaits: none of these depends on
 * another, and a documents screen that opens in eleven round trips is a
 * documents screen that feels slow on the one machine it runs on.
 */
export async function readDocumentsScreen(
	{ readable, readableEverywhere }: DocumentsScreenRead,
	handle: Queryable = db
) {
	const [docs, railCounts, everywhereCount, docLinks, docTags, tags, texts, pending, identities] =
		await Promise.all([
			// The shelf key travels with the row: the rail filters by key and the
			// label is the household's to change, so neither may be a code list.
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
			// Rail counts are computed in SQL, after the read rule and nothing else.
			// They deliberately ignore the search term and the active tag: a rail
			// whose numbers move as you type cannot be used to navigate.
			handle
				.select({ key: shelfTable.key, n: count() })
				.from(document)
				.innerJoin(shelfTable, eq(shelfTable.id, document.shelfId))
				.where(readable)
				.groupBy(shelfTable.key),
			handle.select({ n: count() }).from(document).where(readableEverywhere),
			// One select for every kind of target; the kind comes from `entity`.
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
			// Every identity row the archive holds, keyed by document by the caller.
			// Whole rather than by id: there is one per identity document and a
			// household has a handful, which is cheaper than a second round trip
			// once the selected document turns out to be one of them.
			handle.select().from(documentIdentity)
		]);

	return { docs, railCounts, everywhereCount, docLinks, docTags, tags, texts, pending, identities };
}
