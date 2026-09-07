// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The stored file behind a document.
 *
 * `/files/[name]` opens whatever name it was handed, which is right for an
 * avatar and for property media. Filed paper is served through the document
 * instead, so the id in the URL is resolved to a row here rather than a
 * filename being trusted on its own — a name that names nothing gets the same
 * 404 as a document that is not there.
 */
import { eq } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { document } from '$lib/server/db/schema';

/** The file behind a document, or null when there is no such document. */
export async function documentStoredName(
	documentId: string,
	handle: Queryable = db
): Promise<string | null> {
	const [row] = await handle
		.select({ storedName: document.storedName })
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	return row?.storedName ?? null;
}
