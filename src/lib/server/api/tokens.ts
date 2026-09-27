// SPDX-License-Identifier: AGPL-3.0-or-later
// Bearer tokens for the API. The raw token is shown once at creation and never
// stored — only its sha256, exactly as sessions are handled.

import { randomBytes } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { apiToken } from '$lib/server/db/schema';
// Same hashing as sessions and enrollment links, and the same symbol rather
// than a third copy of it.
import { hashToken } from '$lib/server/auth/token-hash';
import type { ApiAccess, ApiArea, ApiGrant } from './areas';

export type { ApiAccess, ApiArea, ApiGrant } from './areas';

/**
 * @param areas The areas the token reaches, or null for all of them. Kept as
 * given, so an empty list is a token that reaches nothing — never widened to
 * everything on the way in.
 */
export async function createToken(
	label: string,
	access: ApiAccess,
	areas: readonly ApiArea[] | null = null,
	handle: Queryable = db
): Promise<{ raw: string; id: string }> {
	const raw = randomBytes(32).toString('base64url');
	const id = hashToken(raw);
	await handle.insert(apiToken).values({
		id,
		label: label.trim() || 'Unnamed token',
		access,
		areas: areas === null ? null : [...new Set(areas)]
	});
	return { raw, id };
}

/** Change which areas an issued token reaches, from its next request on. */
export async function setTokenAreas(
	id: string,
	areas: readonly ApiArea[] | null,
	handle: Queryable = db
): Promise<void> {
	await handle
		.update(apiToken)
		.set({ areas: areas === null ? null : [...new Set(areas)] })
		.where(eq(apiToken.id, id));
}

/**
 * Change what an issued token may do. Takes effect on its next request: the
 * access is read per request, never cached with the token.
 */
export async function setTokenAccess(
	id: string,
	access: ApiAccess,
	handle: Queryable = db
): Promise<void> {
	await handle.update(apiToken).set({ access }).where(eq(apiToken.id, id));
}

const USAGE_REFRESH_MS = 5 * 60 * 1000;

/**
 * What the token may do and where, or null when it is not known. Refreshes
 * lastUsedAt at most once per five minutes, so a frequently polled API does not
 * turn every request into a new PostgreSQL row version.
 */
export async function verifyToken(
	raw: string | null,
	handle: Queryable = db,
	now = new Date()
): Promise<ApiGrant | null> {
	if (!raw) return null;
	const id = hashToken(raw);
	const refreshBefore = new Date(now.getTime() - USAGE_REFRESH_MS);
	// One round trip recognizes both recently used and newly refreshed tokens;
	// the data-modifying CTE writes only when the timestamp is stale.
	const rows = await handle.execute<{ access: ApiAccess; areas: ApiArea[] | null }>(sql`
		with refreshed as (
			update ${apiToken}
			set last_used_at = ${now.toISOString()}::timestamptz
			where ${apiToken.id} = ${id}
				and (${apiToken.lastUsedAt} is null
					or ${apiToken.lastUsedAt} < ${refreshBefore.toISOString()}::timestamptz)
			returning access, areas
		)
		select access, areas from refreshed
		union all
		select ${apiToken.access} as access, ${apiToken.areas} as areas from ${apiToken}
		where ${apiToken.id} = ${id}
			and not exists (select 1 from refreshed)
		limit 1
	`);
	return rows.length === 1 ? { access: rows[0].access, areas: rows[0].areas } : null;
}

export async function listTokens() {
	return db.select().from(apiToken).orderBy(desc(apiToken.createdAt));
}

export async function revokeToken(id: string): Promise<void> {
	await db.delete(apiToken).where(eq(apiToken.id, id));
}
