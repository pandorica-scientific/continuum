// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Which stored file an actor is allowed to open.
 *
 * `/files/[name]` guards the session and then opens whatever name it was
 * handed, which is right for an avatar and wrong for filed paper: a member
 * holding a stored name could fetch a restricted document without ever asking
 * which document it belonged to. Both questions are answered here, against the
 * document row, so the two routes cannot come to disagree.
 */
import { and, eq } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { document } from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from './visibility';

/** The file behind a document, or null when the actor may not know it exists. */
export async function visibleStoredName(
	documentId: string,
	actor: Actor | null,
	handle: Queryable = db
): Promise<string | null> {
	const [row] = await handle
		.select({ storedName: document.storedName })
		.from(document)
		.where(and(eq(document.id, documentId), visibleDocumentPredicate(actor)))
		.limit(1);
	return row?.storedName ?? null;
}

/**
 * May this actor open this stored file by name?
 *
 * A name that belongs to no document — an avatar, property media — is served
 * as before; that is what `/files/[name]` is for. A name that belongs to a
 * document is answered by the document.
 */
export async function storedNameIsVisible(
	name: string,
	actor: Actor | null,
	handle: Queryable = db
): Promise<boolean> {
	const rows = await handle
		.select({ id: document.id })
		.from(document)
		.where(eq(document.storedName, name))
		.limit(1);
	if (rows.length === 0) return true;
	const visible = await handle
		.select({ id: document.id })
		.from(document)
		.where(and(eq(document.storedName, name), visibleDocumentPredicate(actor)))
		.limit(1);
	return visible.length > 0;
}
