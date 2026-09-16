// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which documents a read path is allowed to return, as SQL fragments.
 *
 * One question lives here: is this document's subject still current.
 * Everyone in a household sees everything — there is no per-actor permission
 * check, since anyone who can reach the address can sign in as anyone.
 *
 * What survives is EXISTENCE: a write action still may not name a document
 * that is not there.
 */
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { document, documentLink, subject } from '$lib/server/db/schema';

/** The sentence a document that is not there gets, here rather than per caller. */
export const NO_SUCH_DOCUMENT = 'That document is not there.';

/**
 * Archived subjects demote their paper, and only their paper.
 *
 * The expression is exactly v3 §2.3, and the shape matters: it is
 *
 *   hide ⇔ EXISTS(a subject link) AND NOT EXISTS(an ACTIVE subject link)
 *
 * not "every linked subject is archived", which is vacuously TRUE for a
 * document linked to no subject at all and would therefore hide every
 * unlinked document in the archive. `tests/integration/archive-scope`
 * holds the truth table.
 */
export function archiveScopePredicate(includeArchived: boolean): SQL | undefined {
	if (includeArchived) return undefined;
	return sql`not (
		exists (
			select 1 from ${documentLink} dl
			join ${subject} s on s.id = dl.target_id
			where dl.document_id = ${document.id}
		)
		and not exists (
			select 1 from ${documentLink} dl
			join ${subject} s on s.id = dl.target_id
			where dl.document_id = ${document.id} and s.archived_at is null
		)
	)`;
}

/** A read that found nothing, in the shape an action hands to `fail`. */
export type NoSuchDocument = { ok: false; status: 404; message: typeof NO_SUCH_DOCUMENT };

/** Either the id, or the answer a document that does not exist gets. */
export type VisibleDocument = { ok: true; id: string } | NoSuchDocument;

/**
 * Is there such a document at all?
 *
 * A write may not name a row that is not there, and this is the one place
 * that asks — one shared check rather than each action spelling out its own
 * and risking one being forgotten.
 */
export async function assertDocumentExists(
	id: string,
	handle: Queryable = db
): Promise<VisibleDocument> {
	const [row] = await handle
		.select({ id: document.id })
		.from(document)
		.where(eq(document.id, id))
		.limit(1);
	return row ? { ok: true, id: row.id } : { ok: false, status: 404, message: NO_SUCH_DOCUMENT };
}

/**
 * The same question for a selection: which of these are really there.
 *
 * A bulk edit drops the ids that are not rather than failing the whole batch:
 * refusing forty documents over one stale id is a louder answer than the question.
 */
export async function existingDocumentIds(
	ids: readonly string[],
	handle: Queryable = db
): Promise<string[]> {
	if (ids.length === 0) return [];
	const rows = await handle
		.select({ id: document.id })
		.from(document)
		.where(inArray(document.id, [...ids]));
	const found = new Set(rows.map((row) => row.id));
	// In the order they were given, so a caller's own ordering survives.
	return ids.filter((id) => found.has(id));
}
