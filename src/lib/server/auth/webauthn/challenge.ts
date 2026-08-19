// WebAuthn challenges are server-issued, single-use, short-lived and bounded.

import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import { webauthnChallenge } from '$lib/server/db/schema';
import { cookieSecure } from '$lib/server/auth/cookies';
import type { Cookies } from '@sveltejs/kit';

const CHALLENGE_COOKIE = 'continuum_webauthn_challenge';
const TTL_SECONDS = 5 * 60;
const MAX_PER_ADDRESS = 4;
const MAX_OUTSTANDING = 1024;

const idFor = (challenge: string) => createHash('sha256').update(challenge).digest('hex');

interface StoreChallengeOptions {
	address: string;
	personId?: string;
	authGeneration?: number;
	authSnapshot?: Record<string, number>;
	handle?: Db;
}

interface StoredChallenge {
	challenge: string;
	personId: string | null;
	authGeneration: number | null;
	authSnapshot: Record<string, number>;
}

export async function storeChallenge(
	cookies: Cookies,
	challenge: string,
	options: StoreChallengeOptions
): Promise<void> {
	const handle = options.handle ?? db;
	const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);

	await handle.transaction(async (tx) => {
		// One short database-wide lock makes the caps true under concurrent issue
		// requests as well as sequential ones. It is held only around indexed
		// pruning and one insert, never around WebAuthn option generation.
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('continuum-webauthn-challenge'))`);
		await tx.execute(sql`
			delete from ${webauthnChallenge}
			where ${webauthnChallenge.id} in (
				select ${webauthnChallenge.id} from ${webauthnChallenge}
				where ${webauthnChallenge.expiresAt} < now()
				order by ${webauthnChallenge.expiresAt}
				limit 64
			)
		`);
		await tx.execute(sql`
			delete from ${webauthnChallenge}
			where ${webauthnChallenge.id} in (
				select ${webauthnChallenge.id} from ${webauthnChallenge}
				where ${webauthnChallenge.address} = ${options.address}
				order by ${webauthnChallenge.createdAt} desc
				offset ${MAX_PER_ADDRESS - 1}
			)
		`);
		await tx.execute(sql`
			delete from ${webauthnChallenge}
			where ${webauthnChallenge.id} in (
				select ${webauthnChallenge.id} from ${webauthnChallenge}
				order by ${webauthnChallenge.createdAt} desc
				offset ${MAX_OUTSTANDING - 1}
			)
		`);
		await tx
			.insert(webauthnChallenge)
			.values({
				id: idFor(challenge),
				address: options.address,
				personId: options.personId,
				authGeneration: options.authGeneration,
				authSnapshot: options.authSnapshot ?? {},
				expiresAt
			})
			.onConflictDoNothing();
	});

	cookies.set(CHALLENGE_COOKIE, challenge, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		maxAge: TTL_SECONDS
	});
}

/** Read and atomically spend the challenge, or null when it is absent/expired. */
export async function takeChallenge(
	cookies: Cookies,
	handle: Queryable = db
): Promise<StoredChallenge | null> {
	const value = cookies.get(CHALLENGE_COOKIE) ?? null;
	cookies.delete(CHALLENGE_COOKIE, { path: '/' });
	if (!value) return null;

	const spent = await handle
		.delete(webauthnChallenge)
		.where(eq(webauthnChallenge.id, idFor(value)))
		.returning({
			expiresAt: webauthnChallenge.expiresAt,
			personId: webauthnChallenge.personId,
			authGeneration: webauthnChallenge.authGeneration,
			authSnapshot: webauthnChallenge.authSnapshot
		});
	if (!spent[0] || spent[0].expiresAt.getTime() < Date.now()) return null;
	return {
		challenge: value,
		personId: spent[0].personId,
		authGeneration: spent[0].authGeneration,
		authSnapshot: spent[0].authSnapshot
	};
}

export function challengeGenerationMatches(
	stored: StoredChallenge,
	personId: string,
	currentGeneration: number
): boolean {
	return stored.authSnapshot[personId] === currentGeneration;
}
