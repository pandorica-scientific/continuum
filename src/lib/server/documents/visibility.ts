// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which documents a read path is allowed to return, as SQL fragments.
 *
 * Two independent questions live here — may this actor know the document exists,
 * and is its subject still current — and both are applied by every read path
 * rather than by the screen that happens to need them.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { document, documentLink, subject } from '$lib/server/db/schema';

/**
 * Absent, not forbidden — the sentence every refusal of an unreadable document
 * uses, here rather than typed out per caller.
 *
 * A member who names a restricted document is told what someone naming a
 * deleted one is told. "You may not" would confirm it exists, which is the one
 * fact the read rule protects, so the two answers have to be the same string
 * and not merely two strings that currently agree.
 */
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

/**
 * Who is asking. Structural on purpose: `SessionPerson` satisfies it, and so
 * does the little the ICS route knows, which is not a session at all.
 */
export interface Actor {
	id: string;
	role: 'admin' | 'member';
}

/**
 * Whether this actor may know a document exists — at all, anywhere.
 *
 * ONE fragment, used by the Documents load, search, every count, the briefing,
 * calendar generation, the ICS feed and file serving. It is an invariant rather
 * than a filter: a member must not be able to infer a restricted document from
 * a count that is one too high, a search hint that mentions matches they cannot
 * see, or a calendar event with no document behind it.
 *
 * A NULL actor is a member, deliberately. The ICS feed carries a token, not a
 * session, and reading "no person" as "no restriction" would make the feed the
 * one door left open.
 */
export function visibleDocumentPredicate(actor: Actor | null): SQL | undefined {
	if (actor?.role === 'admin') return undefined;
	return eq(document.sensitivity, 'normal');
}

/** A read the rule refused, in the shape an action hands to `fail`. */
export type NoSuchDocument = { ok: false; status: 404; message: typeof NO_SUCH_DOCUMENT };

/** Either the id, or the same answer a document that does not exist gets. */
export type VisibleDocument = { ok: true; id: string } | NoSuchDocument;

/**
 * May this actor act on this document at all?
 *
 * The predicate above says what a LIST may return; this says what a WRITE may
 * name. Both questions have to be asked or the rule is only half a rule: a
 * member who never saw a restricted document in any list could still rename it,
 * retype it or put different bytes behind it by posting its id, and none of
 * those needs the row to have been listed anywhere.
 *
 * One helper rather than the check written out per action, because five
 * actions each spelling it themselves is five places for one of them to be
 * forgotten — which is exactly how the Documents screen's write actions ended
 * up unguarded while its reads were not.
 *
 * The refusal carries `NO_SUCH_DOCUMENT`, so an action that has no such
 * document and an action that has one it may not touch answer identically.
 */
export async function assertVisibleDocument(
	id: string,
	actor: Actor | null,
	handle: Queryable = db
): Promise<VisibleDocument> {
	const [row] = await handle
		.select({ id: document.id })
		.from(document)
		.where(and(eq(document.id, id), visibleDocumentPredicate(actor)))
		.limit(1);
	return row ? { ok: true, id: row.id } : { ok: false, status: 404, message: NO_SUCH_DOCUMENT };
}

/**
 * The same question for a selection: which of these may this actor act on.
 *
 * A bulk edit is refused per document rather than as a whole. Failing the
 * entire bar because one id in forty is not the caller's to touch would be a
 * louder answer than the question, and — worse — would tell them the id they
 * cannot see is special. What they can act on happens; the rest is not there.
 */
export async function visibleDocumentIds(
	ids: readonly string[],
	actor: Actor | null,
	handle: Queryable = db
): Promise<string[]> {
	if (ids.length === 0) return [];
	const rows = await handle
		.select({ id: document.id })
		.from(document)
		.where(and(inArray(document.id, [...ids]), visibleDocumentPredicate(actor)));
	const allowed = new Set(rows.map((row) => row.id));
	// In the order they were given, so a caller's own ordering survives.
	return ids.filter((id) => allowed.has(id));
}
