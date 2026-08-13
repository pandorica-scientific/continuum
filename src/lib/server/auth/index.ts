import { createHash, randomBytes } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { person, session } from '$lib/server/db/schema';
import type { Cookies } from '@sveltejs/kit';

const SESSION_COOKIE = 'continuum_session';
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
	return argonHash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	return argonVerify(passwordHash, password);
}

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export async function createSession(cookies: Cookies, personId: string): Promise<void> {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
	await db.insert(session).values({ id: hashToken(token), personId, expiresAt });
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// Home servers commonly run plain HTTP on the LAN; when the instance is
		// served over HTTPS (reverse proxy, Tailscale cert), the cookie locks
		// to it automatically via ORIGIN.
		secure: (env.ORIGIN ?? '').startsWith('https://'),
		expires: expiresAt
	});
}

export interface SessionPerson {
	id: string;
	name: string;
	initials: string;
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
			initials: person.initials
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
	return { id: row.id, name: row.name, initials: row.initials };
}

export async function destroySession(cookies: Cookies): Promise<void> {
	const token = cookies.get(SESSION_COOKIE);
	if (token) {
		await db.delete(session).where(eq(session.id, hashToken(token)));
	}
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
