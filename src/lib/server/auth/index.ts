import { randomBytes } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person, session } from '$lib/server/db/schema';
import { cookieSecure } from './cookies';
import { hashToken } from './token-hash';
import type { Cookies } from '@sveltejs/kit';
import type { PersonRole } from './policy';

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

export async function createSession(cookies: Cookies, personId: string): Promise<void> {
	// Signing in replaces whatever session the caller arrived with. The cookie is
	// overwritten either way, so leaving the old row behind would strand a fully
	// valid 30-day session for the previous person — reachable by anyone who
	// still had that cookie value, and invisible to revokeOtherSessions because
	// it belongs to a different account.
	const previous = currentSessionId(cookies);
	if (previous) await db.delete(session).where(eq(session.id, previous));

	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
	await db.insert(session).values({ id: hashToken(token), personId, expiresAt });
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		expires: expiresAt
	});
}

export interface SessionPerson {
	id: string;
	name: string;
	initials: string;
	role: PersonRole;
}

/** The current session's row id, or null when there is no session cookie. */
export function currentSessionId(cookies: Cookies): string | null {
	const token = cookies.get(SESSION_COOKIE);
	return token ? hashToken(token) : null;
}

export async function validateSession(cookies: Cookies): Promise<SessionPerson | null> {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return null;
	const rows = await db
		.select({
			sessionId: session.id,
			expiresAt: session.expiresAt,
			id: person.id,
			name: person.name,
			initials: person.initials,
			role: person.role,
			deactivatedAt: person.deactivatedAt
		})
		.from(session)
		.innerJoin(person, eq(session.personId, person.id))
		.where(eq(session.id, hashToken(token)));
	const row = rows[0];
	if (!row) return null;
	if (row.expiresAt < new Date()) {
		await db.delete(session).where(eq(session.id, row.sessionId));
		return null;
	}
	// A person deactivated mid-session loses access on their next request.
	if (row.deactivatedAt) {
		await db.delete(session).where(eq(session.id, row.sessionId));
		return null;
	}
	return { id: row.id, name: row.name, initials: row.initials, role: row.role };
}

export async function destroySession(cookies: Cookies): Promise<void> {
	const token = cookies.get(SESSION_COOKIE);
	if (token) {
		await db.delete(session).where(eq(session.id, hashToken(token)));
	}
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
