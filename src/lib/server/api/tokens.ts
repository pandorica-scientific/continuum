// Bearer tokens for the read-only API. The raw token is shown once at creation
// and never stored — only its sha256, exactly as sessions are handled.

import { randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { apiToken } from '$lib/server/db/schema';
// Same hashing as sessions and enrollment links, and the same symbol rather
// than a third copy of it.
import { hashToken } from '$lib/server/auth/token-hash';

export async function createToken(label: string): Promise<{ raw: string }> {
	const raw = randomBytes(32).toString('base64url');
	await db.insert(apiToken).values({ id: hashToken(raw), label: label.trim() || 'Unnamed token' });
	return { raw };
}

/** True when the token is known. Stamps lastUsedAt so dormant tokens show up. */
export async function verifyToken(raw: string | null): Promise<boolean> {
	if (!raw) return false;
	const id = hashToken(raw);
	const rows = await db.select().from(apiToken).where(eq(apiToken.id, id));
	if (!rows[0]) return false;
	await db.update(apiToken).set({ lastUsedAt: new Date() }).where(eq(apiToken.id, id));
	return true;
}

export async function listTokens() {
	return db.select().from(apiToken).orderBy(desc(apiToken.createdAt));
}

export async function revokeToken(id: string): Promise<void> {
	await db.delete(apiToken).where(eq(apiToken.id, id));
}
