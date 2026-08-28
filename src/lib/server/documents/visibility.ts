// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Which documents a read path is allowed to return, as SQL fragments.
 *
 * Two independent questions live here — may this actor know the document exists,
 * and is its subject still current — and both are applied by every read path
 * rather than by the screen that happens to need them.
 */
import { eq, sql, type SQL } from 'drizzle-orm';
import { document, documentLink, subject } from '$lib/server/db/schema';

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
