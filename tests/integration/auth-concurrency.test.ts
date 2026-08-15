import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import {
	claimInitialSetup,
	createCredentialAtGeneration,
	createSessionAtGeneration,
	initialSetupPeopleLimitError,
	runInitialSetup,
	revokeAuthenticationGeneration
} from '$lib/server/auth/generation';
import { completeEnrollment } from '$lib/server/auth/enrollment';
import { advanceCredentialCounter } from '$lib/server/auth/webauthn/counter';
import {
	challengeGenerationMatches,
	storeChallenge,
	takeChallenge
} from '$lib/server/auth/webauthn/challenge';
import { pruneExpiredSessions, validateSession } from '$lib/server/auth';
import { verifyToken } from '$lib/server/api/tokens';
import { hashToken } from '$lib/server/auth/token-hash';
import type { Cookies } from '@sveltejs/kit';
import { removeStalePostgresDirectory } from './embedded-postgres';

const PORT = 55440;
const DATABASE = 'continuum_task2';
const DATABASE_DIR = resolve('scratch-workspace/task2-auth-postgres');
const URL = `postgres://postgres:password@127.0.0.1:${PORT}/${DATABASE}`;
const AUTH_MIGRATION = resolve('drizzle/0028_auth_concurrency.sql');

let embedded: EmbeddedPostgres;
let sqlClient: postgres.Sql;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

async function executeSqlFile(path: string): Promise<void> {
	await sqlClient.unsafe(readFileSync(path, 'utf8'));
}

function testCookies(): Cookies {
	const values = new Map<string, string>();
	return {
		get: (name: string) => values.get(name),
		getAll: () => [...values].map(([name, value]) => ({ name, value })),
		set: (name: string, value: string) => values.set(name, value),
		delete: (name: string) => values.delete(name),
		serialize: () => ''
	} as Cookies;
}

beforeAll(async () => {
	removeStalePostgresDirectory(DATABASE_DIR);
	embedded = new EmbeddedPostgres({
		databaseDir: DATABASE_DIR,
		port: PORT,
		user: 'postgres',
		password: 'password',
		persistent: false,
		onLog: () => undefined,
		onError: () => undefined
	});
	await embedded.initialise();
	await embedded.start();
	await embedded.createDatabase(DATABASE);

	sqlClient = postgres(URL, { max: 10 });
	testDb = drizzle(sqlClient, { schema });

	const baseMigrations = readdirSync('drizzle')
		.filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0027_')
		.sort();
	for (const name of baseMigrations) await executeSqlFile(resolve('drizzle', name));
	if (existsSync(AUTH_MIGRATION)) await executeSqlFile(AUTH_MIGRATION);
}, 30_000);

beforeEach(async () => {
	await sqlClient.unsafe(`
		truncate table webauthn_challenge, credential, session, person, setup_claim, api_token
			restart identity cascade;
	`);
});

afterAll(async () => {
	await sqlClient?.end();
	await embedded?.stop();
}, 30_000);

describe('authentication concurrency', () => {
	it('allows exactly one initial setup transaction to claim the instance', async () => {
		const attempts = await Promise.all(
			['first-admin', 'second-admin'].map((id) =>
				testDb.transaction(async (tx) => {
					if (!(await claimInitialSetup(tx))) return false;
					await tx.insert(schema.person).values({ id, name: id, initials: 'A', role: 'admin' });
					return true;
				})
			)
		);

		expect(attempts.filter(Boolean)).toHaveLength(1);
		expect(await testDb.select().from(schema.person)).toHaveLength(1);
	});

	it('runs expensive setup work only for the winning claim and caps household rows', async () => {
		let initializersRun = 0;
		const attempts = await Promise.all(
			['first-admin', 'second-admin'].map((id) =>
				runInitialSetup(testDb, async (tx) => {
					initializersRun++;
					await tx.insert(schema.person).values({ id, name: id, initials: 'A', role: 'admin' });
					return id;
				})
			)
		);

		expect(attempts.filter((attempt) => attempt.claimed)).toHaveLength(1);
		expect(initializersRun).toBe(1);
		expect(initialSetupPeopleLimitError(20)).toBeNull();
		expect(initialSetupPeopleLimitError(21)).toBe('Setup supports at most 20 people.');
	});

	it('leaves no session or credential when revocation races their creation', async () => {
		await testDb.insert(schema.person).values({
			id: 'person-a',
			name: 'Person A',
			initials: 'PA',
			passwordHash: 'old-hash'
		});

		await Promise.all([
			testDb.transaction((tx) => revokeAuthenticationGeneration(tx, 'person-a')),
			createSessionAtGeneration(testDb, {
				id: 'session-a',
				personId: 'person-a',
				authGeneration: 0,
				expiresAt: new Date('2026-09-15T00:00:00Z')
			}),
			createCredentialAtGeneration(testDb, {
				id: 'credential-a',
				personId: 'person-a',
				authGeneration: 0,
				publicKey: 'public-key',
				counter: 0,
				transports: [],
				label: 'Passkey'
			})
		]);

		expect(await testDb.select().from(schema.session)).toHaveLength(0);
		expect(await testDb.select().from(schema.credential)).toHaveLength(0);
	});

	it('cannot finish in-flight authentication work after deactivation commits', async () => {
		await testDb.insert(schema.person).values({
			id: 'person-a',
			name: 'Person A',
			initials: 'PA',
			authGeneration: 0
		});
		await testDb.insert(schema.credential).values({
			id: 'credential-a',
			personId: 'person-a',
			authGeneration: 0,
			publicKey: 'public-key',
			counter: 5,
			transports: [],
			label: 'Passkey'
		});

		// These values model work captured while the person was active. Once the
		// deactivation commits, none of that work may create or advance an
		// authentication artifact that survives until a later reactivation.
		await testDb
			.update(schema.person)
			.set({ deactivatedAt: new Date('2026-08-15T12:00:00Z') })
			.where(eq(schema.person.id, 'person-a'));

		const sessionCreated = await createSessionAtGeneration(testDb, {
			id: 'session-after-deactivation',
			personId: 'person-a',
			authGeneration: 0,
			expiresAt: new Date('2026-09-15T00:00:00Z')
		});
		const credentialCreated = await createCredentialAtGeneration(testDb, {
			id: 'credential-after-deactivation',
			personId: 'person-a',
			authGeneration: 0,
			publicKey: 'new-public-key',
			counter: 0,
			transports: [],
			label: 'Attacker passkey'
		});
		const counterAdvanced = await advanceCredentialCounter(testDb, 'credential-a', 5, 6, 0);

		expect({ sessionCreated, credentialCreated, counterAdvanced }).toEqual({
			sessionCreated: false,
			credentialCreated: false,
			counterAdvanced: false
		});
		expect(await testDb.select().from(schema.session)).toHaveLength(0);
		const credentials = await testDb
			.select({ id: schema.credential.id, counter: schema.credential.counter })
			.from(schema.credential);
		expect(credentials).toEqual([{ id: 'credential-a', counter: 5 }]);
	});

	it('does not consume enrollment or set a password/session for an inactive person', async () => {
		const raw = 'inactive-person-enrollment-token';
		await testDb.insert(schema.person).values({
			id: 'person-a',
			name: 'Person A',
			initials: 'PA',
			deactivatedAt: new Date('2026-08-15T12:00:00Z')
		});
		await testDb.insert(schema.enrollmentToken).values({
			id: hashToken(raw),
			personId: 'person-a',
			expiresAt: new Date('2027-01-01T00:00:00Z')
		});
		const cookies = testCookies();

		expect(await completeEnrollment(raw, 'long-enough-password', cookies, testDb)).toBe(false);

		const people = await testDb
			.select({ passwordHash: schema.person.passwordHash })
			.from(schema.person);
		expect(people[0].passwordHash).toBeNull();
		const tokens = await testDb
			.select({ usedAt: schema.enrollmentToken.usedAt })
			.from(schema.enrollmentToken);
		expect(tokens[0].usedAt).toBeNull();
		expect(await testDb.select().from(schema.session)).toHaveLength(0);
		expect(cookies.get('continuum_session')).toBeUndefined();
	});

	it('allows one concurrent enrollment to commit password, token, and first session', async () => {
		const raw = 'active-person-enrollment-token';
		await testDb.insert(schema.person).values({
			id: 'person-a',
			name: 'Person A',
			initials: 'PA'
		});
		await testDb.insert(schema.enrollmentToken).values({
			id: hashToken(raw),
			personId: 'person-a',
			expiresAt: new Date('2027-01-01T00:00:00Z')
		});
		const firstCookies = testCookies();
		const secondCookies = testCookies();

		const attempts = await Promise.all([
			completeEnrollment(raw, 'long-enough-password', firstCookies, testDb),
			completeEnrollment(raw, 'another-long-password', secondCookies, testDb)
		]);
		expect(attempts.filter(Boolean)).toHaveLength(1);

		const people = await testDb
			.select({ passwordHash: schema.person.passwordHash })
			.from(schema.person);
		expect(people[0].passwordHash).not.toBeNull();
		const tokens = await testDb
			.select({ usedAt: schema.enrollmentToken.usedAt })
			.from(schema.enrollmentToken);
		expect(tokens[0].usedAt).not.toBeNull();
		expect(await testDb.select().from(schema.session)).toHaveLength(1);
		expect(
			[firstCookies, secondCookies].filter((cookies) => cookies.get('continuum_session')).length
		).toBe(1);
	});

	it('allows one positive counter advance from the same stored counter', async () => {
		await testDb.insert(schema.person).values({ id: 'person-a', name: 'Person A', initials: 'PA' });
		await testDb.insert(schema.credential).values({
			id: 'credential-a',
			personId: 'person-a',
			authGeneration: 0,
			publicKey: 'public-key',
			counter: 5,
			transports: [],
			label: 'Passkey'
		});

		const winners = await Promise.all([
			advanceCredentialCounter(testDb, 'credential-a', 5, 6, 0),
			advanceCredentialCounter(testDb, 'credential-a', 5, 7, 0)
		]);

		expect(winners.filter(Boolean)).toHaveLength(1);
		const stored = await testDb
			.select({ counter: schema.credential.counter })
			.from(schema.credential);
		expect([6, 7]).toContain(stored[0].counter);
	});

	it('caps outstanding challenges for one address', async () => {
		const cookies = testCookies();
		for (let i = 0; i < 10; i++) {
			await storeChallenge(cookies, `challenge-${i}`, {
				address: '192.0.2.30',
				handle: testDb
			});
		}

		const rows = await testDb.select().from(schema.webauthnChallenge);
		expect(rows).toHaveLength(4);
	});

	it('binds a discoverable login challenge to the issued person generations', async () => {
		await testDb.insert(schema.person).values({ id: 'person-a', name: 'Person A', initials: 'PA' });
		const cookies = testCookies();
		await storeChallenge(cookies, 'login-challenge', {
			address: '192.0.2.31',
			authSnapshot: { 'person-a': 0 },
			handle: testDb
		});
		await testDb
			.update(schema.person)
			.set({ authGeneration: 1 })
			.where(eq(schema.person.id, 'person-a'));

		const stored = await takeChallenge(cookies, testDb);
		expect(stored).not.toBeNull();
		expect(challengeGenerationMatches(stored!, 'person-a', 1)).toBe(false);
	});

	it('clears an invalid session cookie and prunes expired rows in bounded batches', async () => {
		await testDb.insert(schema.person).values({ id: 'person-a', name: 'Person A', initials: 'PA' });
		const cookies = testCookies();
		cookies.set('continuum_session', 'expired-token', { path: '/' });
		await testDb.insert(schema.session).values(
			Array.from({ length: 70 }, (_, index) => ({
				id: index === 0 ? hashToken('expired-token') : `expired-${index}`,
				personId: 'person-a',
				authGeneration: 0,
				expiresAt: new Date('2026-01-01T00:00:00Z')
			}))
		);

		expect(await validateSession(cookies, testDb)).toBeNull();
		expect(cookies.get('continuum_session')).toBeUndefined();
		expect(await pruneExpiredSessions(testDb, 32)).toBe(32);
		expect(await testDb.select().from(schema.session)).toHaveLength(37);
	});

	it('refuses and clears a session from an older authentication generation', async () => {
		await testDb.insert(schema.person).values({
			id: 'person-a',
			name: 'Person A',
			initials: 'PA',
			authGeneration: 1
		});
		const cookies = testCookies();
		cookies.set('continuum_session', 'stale-token', { path: '/' });
		await testDb.insert(schema.session).values({
			id: hashToken('stale-token'),
			personId: 'person-a',
			authGeneration: 0,
			expiresAt: new Date('2027-01-01T00:00:00Z')
		});

		expect(await validateSession(cookies, testDb)).toBeNull();
		expect(cookies.get('continuum_session')).toBeUndefined();
		expect(await testDb.select().from(schema.session)).toHaveLength(0);
	});

	it('recognises recent API tokens without refreshing their usage row on every read', async () => {
		const raw = 'api-token-for-refresh-test';
		const initialUse = new Date('2026-08-15T10:00:00.000Z');
		await testDb.insert(schema.apiToken).values({
			id: hashToken(raw),
			label: 'test',
			lastUsedAt: initialUse
		});

		expect(await verifyToken(raw, testDb, new Date('2026-08-15T10:01:00.000Z'))).toBe(true);
		let rows = await testDb.select().from(schema.apiToken);
		expect(rows[0].lastUsedAt).toEqual(initialUse);

		const laterUse = new Date('2026-08-15T10:10:00.000Z');
		expect(await verifyToken(raw, testDb, laterUse)).toBe(true);
		rows = await testDb.select().from(schema.apiToken);
		expect(rows[0].lastUsedAt).toEqual(laterUse);
	});
});
