// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db, Queryable, Tx } from '$lib/server/db';
import { credential, person, session, setupClaim } from '$lib/server/db/schema';

const MAX_INITIAL_SETUP_PEOPLE = 20;

export function initialSetupPeopleLimitError(count: number): string | null {
	return count > MAX_INITIAL_SETUP_PEOPLE
		? `Setup supports at most ${MAX_INITIAL_SETUP_PEOPLE} people.`
		: null;
}

interface GenerationSession {
	id: string;
	personId: string;
	authGeneration: number;
	expiresAt: Date;
}

interface GenerationCredential {
	id: string;
	personId: string;
	authGeneration: number;
	publicKey: string;
	counter: number;
	transports: string[];
	label: string;
}

export async function claimInitialSetup(handle: Queryable): Promise<boolean> {
	const claimed = await handle
		.insert(setupClaim)
		.values({ claimed: true })
		.onConflictDoNothing()
		.returning({ claimed: setupClaim.claimed });
	return Boolean(claimed[0]);
}

/**
 * Claim and initialize in one transaction. The callback starts only after this
 * request owns the singleton, so losing setup requests never perform password
 * hashing or any other expensive initialization work.
 */
export async function runInitialSetup<T>(
	handle: Db,
	initialize: (tx: Tx) => Promise<T>
): Promise<{ claimed: false } | { claimed: true; value: T }> {
	return handle.transaction(async (tx) => {
		if (!(await claimInitialSetup(tx))) return { claimed: false as const };
		return { claimed: true as const, value: await initialize(tx) };
	});
}

/** Insert only while the person's generation still equals the captured one. */
export async function createSessionAtGeneration(
	handle: Queryable,
	values: GenerationSession
): Promise<boolean> {
	const rows = await handle.execute(sql`
		insert into ${session} (id, person_id, auth_generation, expires_at)
		select ${values.id}, ${values.personId}, ${values.authGeneration},
			${values.expiresAt.toISOString()}::timestamptz
		from ${person}
		where ${person.id} = ${values.personId}
			and ${person.authGeneration} = ${values.authGeneration}
			and ${person.deactivatedAt} is null
		for no key update
		on conflict do nothing
		returning id
	`);
	return rows.length === 1;
}

/** Insert or rename only while the registration ceremony's generation is current. */
export async function createCredentialAtGeneration(
	handle: Queryable,
	values: GenerationCredential
): Promise<boolean> {
	const rows = await handle.execute(sql`
		insert into ${credential}
			(id, person_id, auth_generation, public_key, counter, transports, label)
		select ${values.id}, ${values.personId}, ${values.authGeneration}, ${values.publicKey},
			${values.counter}, ${JSON.stringify(values.transports)}::jsonb, ${values.label}
		from ${person}
		where ${person.id} = ${values.personId}
			and ${person.authGeneration} = ${values.authGeneration}
			and ${person.deactivatedAt} is null
		for no key update
		on conflict (id) do update set
			public_key = excluded.public_key,
			counter = excluded.counter,
			transports = excluded.transports,
			label = excluded.label
		where ${credential.personId} = excluded.person_id
			and ${credential.authGeneration} = excluded.auth_generation
		returning id
	`);
	return rows.length === 1;
}

/** Advance the generation and remove every artifact carrying the old value. */
export async function revokeAuthenticationGeneration(
	handle: Queryable,
	personId: string,
	keepSessionId: string | null = null
): Promise<number | null> {
	const advanced = await handle.execute<{ auth_generation: number }>(sql`
		update ${person}
		set auth_generation = ${person.authGeneration} + 1
		where ${person.id} = ${personId}
		returning auth_generation
	`);
	if (!advanced[0]) return null;
	if (keepSessionId) {
		await handle
			.update(session)
			.set({ authGeneration: advanced[0].auth_generation })
			.where(and(eq(session.id, keepSessionId), eq(session.personId, personId)));
		await handle
			.delete(session)
			.where(and(eq(session.personId, personId), ne(session.id, keepSessionId)));
	} else {
		await handle.delete(session).where(eq(session.personId, personId));
	}
	await handle.delete(credential).where(eq(credential.personId, personId));
	return advanced[0].auth_generation;
}
