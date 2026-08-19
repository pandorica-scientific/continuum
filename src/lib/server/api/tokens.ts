// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Bearer tokens for the read-only API. The raw token is shown once at creation
// and never stored — only its sha256, exactly as sessions are handled.

import { randomBytes } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { apiToken } from '$lib/server/db/schema';
// Same hashing as sessions and enrollment links, and the same symbol rather
// than a third copy of it.
import { hashToken } from '$lib/server/auth/token-hash';

export async function createToken(label: string): Promise<{ raw: string }> {
	const raw = randomBytes(32).toString('base64url');
	await db.insert(apiToken).values({ id: hashToken(raw), label: label.trim() || 'Unnamed token' });
	return { raw };
}

const USAGE_REFRESH_MS = 5 * 60 * 1000;

/**
 * True when the token is known. Refreshes lastUsedAt at most once per five
 * minutes, so a frequently polled read-only API does not turn every request
 * into a new PostgreSQL row version.
 */
export async function verifyToken(
	raw: string | null,
	handle: Queryable = db,
	now = new Date()
): Promise<boolean> {
	if (!raw) return false;
	const id = hashToken(raw);
	const refreshBefore = new Date(now.getTime() - USAGE_REFRESH_MS);
	// One round trip recognizes both recently used and newly refreshed tokens;
	// the data-modifying CTE writes only when the timestamp is stale.
	const rows = await handle.execute<{ id: string }>(sql`
		with refreshed as (
			update ${apiToken}
			set last_used_at = ${now.toISOString()}::timestamptz
			where ${apiToken.id} = ${id}
				and (${apiToken.lastUsedAt} is null
					or ${apiToken.lastUsedAt} < ${refreshBefore.toISOString()}::timestamptz)
			returning id
		)
		select id from refreshed
		union all
		select ${apiToken.id} as id from ${apiToken}
		where ${apiToken.id} = ${id}
			and not exists (select 1 from refreshed)
		limit 1
	`);
	return rows.length === 1;
}

export async function listTokens() {
	return db.select().from(apiToken).orderBy(desc(apiToken.createdAt));
}

export async function revokeToken(id: string): Promise<void> {
	await db.delete(apiToken).where(eq(apiToken.id, id));
}
