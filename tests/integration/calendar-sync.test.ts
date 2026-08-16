import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { createEvent, deleteEvent, updateEvent } from '$lib/server/calendar/mutations';
import { syncAccount } from '$lib/server/calendar/sync/engine';
import type { EventSeries } from '$lib/server/calendar/series';
import { toRemoteId } from '$lib/calendar/keys';
import { calendarConflicts, calendarSyncFailures } from '$lib/server/briefing';
import { removeStalePostgresDirectory } from './embedded-postgres';
import { FakeCalendarProvider } from './fake-calendar-provider';

const PORT = 55448;
const DATABASE = 'continuum_calendar_sync';
const DATABASE_DIR = resolve('scratch-workspace/calendar-sync-postgres');
const URL = `postgres://postgres:password@127.0.0.1:${PORT}/${DATABASE}`;
const ACCOUNT = 'acct-1';

let embedded: EmbeddedPostgres;
let sqlClient: postgres.Sql;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let fake: FakeCalendarProvider;

const event = (over: Partial<Parameters<typeof createEvent>[0]> = {}) => ({
	title: 'Dentist',
	notes: null,
	category: null,
	allDay: false,
	startsAt: new Date('2026-09-10T09:00:00.000Z'),
	endsAt: new Date('2026-09-10T10:00:00.000Z'),
	tz: 'Europe/Prague',
	rrule: null,
	...over
});

const remoteSeries = (uid: string, over: Partial<EventSeries> = {}): EventSeries => ({
	uid,
	title: 'From the phone',
	notes: null,
	category: null,
	allDay: false,
	startsAt: '2026-09-12T09:00:00.000Z',
	endsAt: '2026-09-12T10:00:00.000Z',
	tz: 'Europe/Prague',
	rrule: null,
	exceptions: [],
	updatedAt: '2026-09-12T00:00:00.000Z',
	...over
});

const sync = () => syncAccount(ACCOUNT, fake, testDb);

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

	sqlClient = postgres(URL, { max: 5, onnotice: () => undefined });
	testDb = drizzle(sqlClient, { schema });

	const migrations = readdirSync('drizzle')
		.filter(
			(name) => /^\d{4}_.+\.sql$/.test(name) && name !== '0027_repair_transaction_fingerprints.sql'
		)
		.sort();
	for (const name of migrations) {
		const sql = readFileSync(resolve('drizzle', name), 'utf8');
		for (const part of sql.split('--> statement-breakpoint')) {
			if (part.split('\n').some((l) => l.trim() && !l.trim().startsWith('--'))) {
				await sqlClient.unsafe(part);
			}
		}
	}
}, 60_000);

afterAll(async () => {
	await sqlClient?.end();
	await embedded?.stop();
});

beforeEach(async () => {
	await sqlClient.unsafe(`
		delete from calendar_conflict;
		delete from calendar_sync_link;
		delete from calendar_event_exception;
		delete from calendar_event;
		delete from calendar_account;
		-- No loans, tenancies or documents, so generateEvents produces nothing and
		-- these tests are about the engine rather than the ledger's own output.
		delete from loan_fixation_period; delete from loan_property; delete from loan;
		delete from tenancy; delete from document; delete from property;
	`);
	await testDb.insert(schema.calendarAccount).values({
		id: ACCOUNT,
		provider: 'icloud',
		label: 'Fake',
		credential: 'x'
	});
	fake = new FakeCalendarProvider();
});

describe('the push-loop guard', () => {
	// THE failure this class of feature dies of. Insufficient hash normalisation
	// makes every event compare as changed on every pass: push, remote echoes,
	// push again — silently, showing up as rate-limit exhaustion, not an error.
	it('issues zero writes on a second pass over unchanged state', async () => {
		await createEvent(event(), null, testDb);
		await sync();
		expect(fake.pushCount).toBeGreaterThan(0);

		fake.resetCounters();
		await sync();
		expect(fake.pushCount).toBe(0);
	});

	it('stays quiet over several idle passes', async () => {
		await createEvent(event(), null, testDb);
		await sync();
		fake.resetCounters();
		for (let i = 0; i < 3; i++) await sync();
		expect(fake.pushCount).toBe(0);
	});
});

describe('no duplicates', () => {
	it('does not duplicate after a cursor reset', async () => {
		await createEvent(event(), null, testDb);
		await sync();
		const before = fake.uids();

		fake.forceReset();
		await sync();

		expect(fake.uids().sort()).toEqual(before.sort());
		expect(new Set(fake.uids()).size).toBe(fake.uids().length);
	});

	// Losing the link table is the disaster case: without derived remote ids the
	// engine would create a second copy of every event on someone's phone.
	it('re-attaches to existing remote events when the link table is lost', async () => {
		const created = await createEvent(event(), null, testDb);
		await sync();
		const before = fake.uids();

		await sqlClient.unsafe('delete from calendar_sync_link');
		fake.forceReset();
		await sync();

		expect(fake.uids().sort()).toEqual(before.sort());
		if (created.ok) expect(fake.has(toRemoteId(created.id))).toBe(true);
	});
});

describe('no resurrection', () => {
	it('does not bring back an event deleted here', async () => {
		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('seed failed');
		await sync();
		expect(fake.has(toRemoteId(created.id))).toBe(true);

		await deleteEvent(created.id, 'all', null, testDb);
		await sync();
		expect(fake.has(toRemoteId(created.id))).toBe(false);

		// And it stays gone across further passes.
		await sync();
		await sync();
		expect(fake.has(toRemoteId(created.id))).toBe(false);
	});

	it('does not bring back an event deleted remotely', async () => {
		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('seed failed');
		await sync();

		fake.deleteRemote(toRemoteId(created.id));
		await sync();

		// Gone here as well. The row is tombstoned when the deletion still has to
		// reach another account, and reaped once no link references it — this being
		// the only account, it is reaped in the same pass. Either way what matters
		// is that nothing live remains.
		const [row] = await testDb
			.select()
			.from(schema.calendarEvent)
			.where(eq(schema.calendarEvent.id, created.id));
		expect(row === undefined || row.deletedAt !== null).toBe(true);

		// And it does not come back on any later pass.
		await sync();
		await sync();
		expect(fake.has(toRemoteId(created.id))).toBe(false);
		expect(
			await testDb
				.select()
				.from(schema.calendarEvent)
				.where(eq(schema.calendarEvent.id, created.id))
				.then((rows) => rows.filter((r) => r.deletedAt === null))
		).toHaveLength(0);
	});
});

describe('pulling remote changes in', () => {
	it('creates a local event for one that appeared remotely', async () => {
		const uid = randomUUID();
		fake.setRemote(uid, remoteSeries(uid));
		await sync();

		const rows = await testDb.select().from(schema.calendarEvent);
		expect(rows).toHaveLength(1);
		expect(rows[0].title).toBe('From the phone');
	});

	it('applies a remote edit to an event we pushed', async () => {
		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('seed failed');
		await sync();

		const remoteId = toRemoteId(created.id);
		// Addressed by resource id, but carrying OUR uid — which is how a real
		// server hands back an event we created.
		fake.setRemote(
			remoteId,
			remoteSeries(created.id, { title: 'Dentist — moved', updatedAt: '2027-01-01T00:00:00.000Z' })
		);
		await sync();

		const [row] = await testDb
			.select()
			.from(schema.calendarEvent)
			.where(eq(schema.calendarEvent.id, created.id));
		expect(row.title).toBe('Dentist — moved');
	});
});

describe('conflicts', () => {
	it('records the discarded version rather than losing it silently', async () => {
		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('seed failed');
		await sync();

		// Both sides move, remote more recently.
		await updateEvent(created.id, event({ title: 'Edited here' }), 'all', null, testDb);
		const remoteId = toRemoteId(created.id);
		fake.setRemote(
			remoteId,
			remoteSeries(created.id, { title: 'Edited there', updatedAt: '2030-01-01T00:00:00.000Z' })
		);

		await sync();

		const conflicts = await testDb.select().from(schema.calendarConflict);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].resolution).toBe('remote-won');
	});
});

describe('crash safety', () => {
	// The cursor advances LAST, inside the transaction that applies the pull. A
	// pass that dies partway must re-fetch, never skip.
	it('leaves the cursor untouched when a pass dies mid-push', async () => {
		await createEvent(event(), null, testDb);
		const [before] = await testDb
			.select()
			.from(schema.calendarAccount)
			.where(eq(schema.calendarAccount.id, ACCOUNT));
		expect(before.cursor).toBeNull();

		fake.failNextPush();
		await expect(sync()).rejects.toThrow(/push failed/);

		const [after] = await testDb
			.select()
			.from(schema.calendarAccount)
			.where(eq(schema.calendarAccount.id, ACCOUNT));
		expect(after.cursor).toBeNull();
		expect(after.lastSyncAt).toBeNull();
	});

	it('completes normally on the pass after a failure', async () => {
		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('seed failed');

		fake.failNextPush();
		await expect(sync()).rejects.toThrow();

		await sync();
		expect(fake.has(toRemoteId(created.id))).toBe(true);
	});
});

describe('write-back into the ledger', () => {
	/** A mortgage whose payment day produces generated events in the horizon. */
	async function seedLoan(paymentDay: number) {
		const id = randomUUID();
		const today = new Date().toISOString().slice(0, 10);
		await testDb.insert(schema.loan).values({
			id,
			name: 'Mortgage ČS',
			lender: 'Česká spořitelna',
			kind: 'mortgage',
			currency: 'CZK',
			principalMinor: 990000000n,
			owedMinor: 927000000n,
			owedAsOf: today,
			startDate: '2020-01-01',
			regime: 'fixed_period',
			dayCount: 'act/360',
			accrualStyle: 'calendar',
			paymentDay,
			interestDeductible: 1
		});
		await testDb.insert(schema.loanFixationPeriod).values({
			id: randomUUID(),
			loanId: id,
			startDate: '2020-01-01',
			endDate: '2035-01-01',
			annualRatePct: '4.44',
			paymentMinor: 5445600n
		});
		return id;
	}

	/**
	 * The remote copy of the LOAN PAYMENT event specifically.
	 *
	 * The horizon also carries import reminders and quarterly-report events, which
	 * are schedule rules with no row behind them — picking one of those by
	 * accident tests the unbound path while claiming to test write-back.
	 */
	function pushedLoanPayment(): { resourceId: string; series: EventSeries } {
		const resourceId = [...fake.uids()].find((id) => fake.get(id)?.uid.includes('loanPayments'));
		if (!resourceId) throw new Error('no loan payment event was pushed');
		return { resourceId, series: fake.get(resourceId)! };
	}

	it('moves the payment day when the date is moved remotely', async () => {
		const loanId = await seedLoan(15);
		await sync();

		// The generated payment events went out.
		expect(fake.uids().length).toBeGreaterThan(0);
		const { resourceId, series } = pushedLoanPayment();

		// Someone drags it to the 20th of the same month, changing nothing else.
		const moved = new Date(series.startsAt);
		moved.setUTCDate(20);
		fake.setRemote(resourceId, {
			...series,
			startsAt: moved.toISOString(),
			endsAt: moved.toISOString(),
			updatedAt: new Date().toISOString()
		});

		await sync();

		const [row] = await testDb.select().from(schema.loan).where(eq(schema.loan.id, loanId));
		expect(row.paymentDay).toBe(20);
	});

	it('records the write-back so it can be traced afterwards', async () => {
		await seedLoan(15);
		await sync();
		const { resourceId, series } = pushedLoanPayment();

		const moved = new Date(series.startsAt);
		moved.setUTCDate(20);
		fake.setRemote(resourceId, {
			...series,
			startsAt: moved.toISOString(),
			endsAt: moved.toISOString(),
			updatedAt: new Date().toISOString()
		});
		await sync();

		const written = await testDb
			.select()
			.from(schema.calendarConflict)
			.where(eq(schema.calendarConflict.resolution, 'wrote-back'));
		expect(written.length).toBeGreaterThan(0);
	});

	// The ledger owns a generated event's CONTENT. Retitling one in a phone
	// calendar is not a fact about the amortisation schedule, so it is reverted
	// rather than accepted — and it must not be mistaken for a date move.
	it('re-asserts a remote retitle instead of writing anything back', async () => {
		const loanId = await seedLoan(15);
		await sync();
		const { resourceId, series } = pushedLoanPayment();

		fake.setRemote(resourceId, {
			...series,
			title: 'Something else entirely',
			updatedAt: new Date().toISOString()
		});
		await sync();

		const [row] = await testDb.select().from(schema.loan).where(eq(schema.loan.id, loanId));
		expect(row.paymentDay).toBe(15);
		expect(fake.get(resourceId)!.title).toContain('Mortgage ČS');
	});
});

describe('what the household is told', () => {
	const conflict = (resolution: 'local-won' | 'remote-won' | 'wrote-back') => ({
		id: randomUUID(),
		localKey: 'k1',
		accountId: ACCOUNT,
		ours: {} as never,
		theirs: {} as never,
		resolution
	});

	// The justification for last-writer-wins. An overwritten edit that nobody is
	// told about is just a lost edit.
	it('raises a discarded edit', async () => {
		await testDb.insert(schema.calendarConflict).values(conflict('remote-won'));
		const items = await calendarConflicts(testDb);
		expect(items).toHaveLength(1);
		expect(items[0].hue).toBe('yellow');
		expect(items[0].title).toMatch(/overwritten/i);
	});

	// Louder than a discarded edit, because this one changed ledger data from
	// outside the ledger.
	it('raises a write-back in red', async () => {
		await testDb.insert(schema.calendarConflict).values(conflict('wrote-back'));
		const items = await calendarConflicts(testDb);
		expect(items).toHaveLength(1);
		expect(items[0].hue).toBe('red');
		expect(items[0].title).toMatch(/changed a date in the ledger/i);
	});

	it('separates write-backs from overwritten edits', async () => {
		await testDb
			.insert(schema.calendarConflict)
			.values([conflict('wrote-back'), conflict('remote-won'), conflict('local-won')]);
		const items = await calendarConflicts(testDb);
		expect(items).toHaveLength(2);
		expect(items.find((i) => i.hue === 'red')!.pill).toBe('1 change');
		expect(items.find((i) => i.hue === 'yellow')!.pill).toBe('2 edits');
	});

	it('stops raising one that has been acknowledged', async () => {
		await testDb
			.insert(schema.calendarConflict)
			.values({ ...conflict('remote-won'), acknowledgedAt: new Date() });
		expect(await calendarConflicts(testDb)).toHaveLength(0);
	});

	it('says nothing when there is nothing to say', async () => {
		expect(await calendarConflicts(testDb)).toHaveLength(0);
		expect(await calendarSyncFailures(testDb)).toHaveLength(0);
	});

	// A sync that fails quietly is worse than one that never ran: the calendar
	// goes on showing what it last saw, looking correct while drifting.
	it('raises an account that is failing', async () => {
		await testDb
			.update(schema.calendarAccount)
			.set({ lastError: 'Server answered 401.', lastSyncAt: new Date() })
			.where(eq(schema.calendarAccount.id, ACCOUNT));

		const items = await calendarSyncFailures(testDb);
		expect(items).toHaveLength(1);
		expect(items[0].detail).toContain('401');
		// Recently synced, so it may still be a blip.
		expect(items[0].hue).toBe('yellow');
	});

	it('turns red once it has been broken for more than a day', async () => {
		await testDb
			.update(schema.calendarAccount)
			.set({
				lastError: 'Server answered 401.',
				lastSyncAt: new Date(Date.now() - 40 * 60 * 60 * 1000)
			})
			.where(eq(schema.calendarAccount.id, ACCOUNT));

		expect((await calendarSyncFailures(testDb))[0].hue).toBe('red');
	});

	it('says nothing about an account that is working', async () => {
		await testDb
			.update(schema.calendarAccount)
			.set({ lastError: null, lastSyncAt: new Date() })
			.where(eq(schema.calendarAccount.id, ACCOUNT));
		expect(await calendarSyncFailures(testDb)).toHaveLength(0);
	});
});

describe('convergence', () => {
	// Randomised interleavings, fixed seed. The two invariants that matter after
	// every round: nothing is duplicated, and nothing deleted comes back.
	it('converges under interleaved local and remote edits', async () => {
		let seed = 42;
		const random = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};

		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('seed failed');
		const remoteId = toRemoteId(created.id);
		let deletedLocally = false;

		for (let round = 0; round < 20; round++) {
			const roll = random();
			if (roll < 0.35 && !deletedLocally) {
				await updateEvent(created.id, event({ title: `local ${round}` }), 'all', null, testDb);
			} else if (roll < 0.7 && !deletedLocally) {
				// Only while it still exists here. Writing it remotely after a local
				// delete is a genuine re-creation, not a resurrection, and asserting
				// against that would be testing the wrong thing.
				fake.setRemote(
					remoteId,
					remoteSeries(created.id, {
						title: `remote ${round}`,
						updatedAt: new Date(2027, 0, round + 1).toISOString()
					})
				);
			} else if (roll < 0.85 && !deletedLocally) {
				await deleteEvent(created.id, 'all', null, testDb);
				deletedLocally = true;
			}

			await sync();

			// No duplicates, ever.
			expect(new Set(fake.uids()).size).toBe(fake.uids().length);
			// Once deleted here, it must not reappear on the remote.
			if (deletedLocally) expect(fake.has(remoteId)).toBe(false);
		}
	}, 60_000);
});
