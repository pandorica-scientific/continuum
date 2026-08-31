// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { person, session } from '$lib/server/db/schema';
import { createSessionAtGeneration } from './generation';
import { cookieSecure } from './cookies';
import { hashToken } from './token-hash';
import type { Cookies } from '@sveltejs/kit';
import type { PersonRole } from './policy';
import type { EnumValue } from '$lib/enums';

const SESSION_COOKIE = 'continuum_session';
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
	return argonHash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

/**
 * A hash of a value nobody will ever type, verified against when there is no
 * real hash to check. Derived from hashPassword rather than written out as a
 * constant so it cannot drift from the parameters a real password uses — the
 * whole point is that the two cost the same.
 *
 * A rejection is not cached. Storing one would make every later sign-in for an
 * unknown or unenrolled person answer 500 instead of "wrong person or
 * password", which is a far louder account oracle than the timing difference
 * this exists to remove.
 */
let decoyHash: Promise<string> | null = null;

function decoy(): Promise<string> {
	decoyHash ??= hashPassword(randomBytes(32).toString('base64url')).catch((err) => {
		decoyHash = null;
		throw err;
	});
	return decoyHash;
}

// Built at start-up, so the first refusal after a restart does not pay for
// constructing it on top of verifying against it and stand out by taking twice
// as long as every refusal after it.
void decoy().catch(() => {});

export async function verifyPassword(
	passwordHash: string | null,
	password: string
): Promise<boolean> {
	if (passwordHash) return argonVerify(passwordHash, password);
	// A person created by an administrator has no hash until they enrol, and
	// argon2 would throw on null. Returning false outright kept that a plain
	// failed sign-in rather than a 500 — but it also answered in about a
	// millisecond where a wrong password costs a full verify, so how long the
	// refusal took said "this account has not enrolled" as plainly as a
	// different message would have. Spending the work anyway costs one
	// deliberately doomed verify on a path that has already failed.
	try {
		await argonVerify(await decoy(), password);
	} catch {
		// Spending the work defends against timing analysis; it is not what
		// decides the answer. If argon2 is unavailable the answer is still no.
	}
	return false;
}

export async function pruneExpiredSessions(handle: Queryable = db, limit = 64): Promise<number> {
	const removed = await handle.execute(sql`
		delete from ${session}
		where ${session.id} in (
			select ${session.id} from ${session}
			where ${session.expiresAt} < now()
			order by ${session.expiresAt}
			limit ${Math.max(1, limit)}
		)
		returning ${session.id}
	`);
	return removed.length;
}

interface SessionGrant {
	token: string;
	expiresAt: Date;
}

/** Create the database half of a session; callers publish its cookie after commit. */
export async function createSessionGrant(
	handle: Queryable,
	personId: string,
	expectedGeneration: number,
	previousSessionId: string | null = null
): Promise<SessionGrant | null> {
	if (previousSessionId) {
		await handle.delete(session).where(eq(session.id, previousSessionId));
	}
	await pruneExpiredSessions(handle);

	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
	const created = await createSessionAtGeneration(handle, {
		id: hashToken(token),
		personId,
		authGeneration: expectedGeneration,
		expiresAt
	});
	return created ? { token, expiresAt } : null;
}

/** Publish a session only after the row that backs it has committed. */
export function applySessionCookie(cookies: Cookies, grant: SessionGrant): void {
	cookies.set(SESSION_COOKIE, grant.token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		expires: grant.expiresAt
	});
}

export async function createSession(
	cookies: Cookies,
	personId: string,
	expectedGeneration?: number
): Promise<boolean> {
	// Signing in replaces whatever session the caller arrived with. The cookie is
	// overwritten either way, so leaving the old row behind would strand a fully
	// valid 30-day session for the previous person — reachable by anyone who
	// still had that cookie value, and invisible to revokeOtherAccess because
	// it belongs to a different account.
	const previous = currentSessionId(cookies);

	let generation = expectedGeneration;
	if (generation === undefined) {
		const rows = await db
			.select({ authGeneration: person.authGeneration })
			.from(person)
			.where(eq(person.id, personId));
		generation = rows[0]?.authGeneration;
	}
	if (generation === undefined) {
		if (previous) await db.delete(session).where(eq(session.id, previous));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return false;
	}

	const grant = await createSessionGrant(db, personId, generation, previous);
	if (!grant) {
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return false;
	}
	applySessionCookie(cookies, grant);
	return true;
}

export interface SessionPerson {
	id: string;
	name: string;
	initials: string;
	role: PersonRole;
	/** Null until they choose one; the app paints dark until they do. */
	theme: EnumValue<'person.theme'> | null;
}

/** The current session's row id, or null when there is no session cookie. */
export function currentSessionId(cookies: Cookies): string | null {
	const token = cookies.get(SESSION_COOKIE);
	return token ? hashToken(token) : null;
}

export async function validateSession(
	cookies: Cookies,
	handle: Queryable = db
): Promise<SessionPerson | null> {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return null;
	const rows = await handle
		.select({
			sessionId: session.id,
			expiresAt: session.expiresAt,
			id: person.id,
			name: person.name,
			initials: person.initials,
			role: person.role,
			theme: person.theme,
			deactivatedAt: person.deactivatedAt,
			sessionAuthGeneration: session.authGeneration,
			personAuthGeneration: person.authGeneration
		})
		.from(session)
		.innerJoin(person, eq(session.personId, person.id))
		.where(eq(session.id, hashToken(token)));
	const row = rows[0];
	if (!row) {
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return null;
	}
	if (row.expiresAt < new Date()) {
		await handle.delete(session).where(eq(session.id, row.sessionId));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return null;
	}
	// A person deactivated mid-session loses access on their next request.
	if (row.deactivatedAt) {
		await handle.delete(session).where(eq(session.id, row.sessionId));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return null;
	}
	if (row.sessionAuthGeneration !== row.personAuthGeneration) {
		await handle.delete(session).where(eq(session.id, row.sessionId));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return null;
	}
	return {
		id: row.id,
		name: row.name,
		initials: row.initials,
		role: row.role,
		theme: row.theme
	};
}

export async function destroySession(cookies: Cookies): Promise<void> {
	const token = cookies.get(SESSION_COOKIE);
	if (token) {
		await db.delete(session).where(eq(session.id, hashToken(token)));
	}
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
