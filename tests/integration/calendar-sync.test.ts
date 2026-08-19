import { rowId } from '../row-id';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { createEvent, deleteEvent, updateEvent } from '$lib/server/calendar/mutations';
import { syncAccount } from '$lib/server/calendar/sync/engine';
import type { EventSeries } from '$lib/server/calendar/series';
import { toRemoteId } from '$lib/calendar/keys';
import { calendarConflicts, calendarSyncFailures } from '$lib/server/briefing';
import { EXCEPT_FINGERPRINT_REPAIR, startPostgres, type Harness, type TestDb } from './harness';
import { FakeCalendarProvider } from './fake-calendar-provider';

const ACCOUNT = rowId('acct-1');

let harness: Harness;
let testDb: TestDb;
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
	harness = await startPostgres('calendar-sync');
	testDb = harness.db;
	await harness.applyMigrations(EXCEPT_FINGERPRINT_REPAIR);
}, 60_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql.unsafe(`
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

		await harness.sql.unsafe('delete from calendar_sync_link');
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
			interestDeductible: true
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
	// The link was never updated after a write-back, so the base hash still
	// described the date BEFORE the move: the same move was rediscovered on every
	// pass, writing the ledger again and filing another conflict row every fifteen
	// minutes, without end.
	it('does not write the same remote move back twice', async () => {
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

		const first = await sync();
		expect(first.writeBacks).toBe(1);

		const second = await sync();
		expect(second.writeBacks).toBe(0);

		const written = await testDb
			.select()
			.from(schema.calendarConflict)
			.where(eq(schema.calendarConflict.resolution, 'wrote-back'));
		expect(written).toHaveLength(1);
	});

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

// Every case below shipped broken. They are grouped by what went wrong rather
// than by the function, because what makes them worth keeping is the failure.
describe('regressions', () => {
	// "Edited here, deleted there" is an ordinary outcome, and merge routes it to
	// a conflict — where one side is genuinely null. `ours` and `theirs` are jsonb
	// NOT NULL, so writing a JavaScript null raised 23502 INSIDE the single commit
	// transaction and rolled the WHOLE pass back: no cursor, no links, everything
	// re-pushed next time, failing in exactly the same place. One event was enough
	// to wedge an account for good.
	it('records a conflict whose other side is a deletion', async () => {
		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('setup failed');
		await sync();

		const remoteId = toRemoteId(created.id);
		await updateEvent(created.id, event({ title: 'Dentist, moved' }), 'all', null, testDb);
		fake.deleteRemote(remoteId);

		const report = await sync();
		expect(report.conflicts).toBe(1);

		const rows = await testDb.select().from(schema.calendarConflict);
		expect(rows).toHaveLength(1);
		expect(rows[0].theirs).toBeNull();
		expect(rows[0].ours).not.toBeNull();

		// The pass FINISHED: the cursor advanced and the account is not in error.
		const [account] = await testDb
			.select()
			.from(schema.calendarAccount)
			.where(eq(schema.calendarAccount.id, ACCOUNT));
		expect(account.cursor).not.toBeNull();
		expect(account.lastSyncAt).not.toBeNull();
	});

	// A reset listing that reaches back ninety days says nothing whatsoever about
	// what came before. Reading that silence as deletion is how one expired
	// syncToken — routine and documented — destroyed every authored event older
	// than the window, hard-deleted rather than tombstoned.
	it('does not delete events older than a windowed reset', async () => {
		const old = await createEvent(
			event({
				title: 'Last year',
				startsAt: new Date('2025-01-15T09:00:00.000Z'),
				endsAt: new Date('2025-01-15T10:00:00.000Z')
			}),
			null,
			testDb
		);
		if (!old.ok) throw new Error('setup failed');
		await sync();

		// The listing starts well after the event, so the event is simply unlisted.
		fake.forceReset('2026-06-01T00:00:00.000Z');
		await sync();

		const [row] = await testDb
			.select()
			.from(schema.calendarEvent)
			.where(eq(schema.calendarEvent.id, old.id));
		expect(row).toBeDefined();
		expect(row.deletedAt).toBeNull();
	});

	// The control: a reset that genuinely covered the whole calendar still means
	// what it says. Fixing the window must not have made deletion undetectable.
	it('still applies a deletion found by an unwindowed reset', async () => {
		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('setup failed');
		await sync();

		fake.deleteRemote(toRemoteId(created.id));
		fake.forceReset(null);
		await sync();

		const [row] = await testDb
			.select()
			.from(schema.calendarEvent)
			.where(eq(schema.calendarEvent.id, created.id));
		expect(row?.deletedAt).not.toBeNull();
	});

	// CalDAV reports a deletion as a resource path and nothing else, because the
	// body is gone. Filed under the path, it matched no local key and no link, so
	// it merged to a no-op while the cursor advanced past it: the event stayed
	// here for good and was never seen again.
	it('applies a deletion the provider could only report by path', async () => {
		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('setup failed');
		await sync();

		fake.deleteRemoteUnnamed(toRemoteId(created.id));
		const report = await sync();
		expect(report.applied).toBe(1);

		const [row] = await testDb
			.select()
			.from(schema.calendarEvent)
			.where(eq(schema.calendarEvent.id, created.id));
		expect(row?.deletedAt).not.toBeNull();
	});

	// A tombstone reaped in the same transaction that created it is a deletion
	// nobody can undo. The row survives its grace period, so a mistaken remote
	// deletion is still there to be found.
	it('keeps a freshly tombstoned row rather than reaping it in the same pass', async () => {
		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('setup failed');
		await sync();

		fake.deleteRemote(toRemoteId(created.id));
		await sync();

		const rows = await testDb
			.select()
			.from(schema.calendarEvent)
			.where(eq(schema.calendarEvent.id, created.id));
		expect(rows).toHaveLength(1);
	});

	// A link pointing at an event that no longer exists is not a cache, it is
	// rubbish — and while it is there reapTombstones can never fire, so tombstones
	// and links both accumulate with nothing able to clear either.
	it('drops the link after successfully pushing a deletion', async () => {
		const created = await createEvent(event(), null, testDb);
		if (!created.ok) throw new Error('setup failed');
		await sync();

		await deleteEvent(created.id, 'all', null, testDb);
		await sync();

		expect(fake.has(toRemoteId(created.id))).toBe(false);
		const links = await testDb
			.select()
			.from(schema.calendarSyncLink)
			.where(eq(schema.calendarSyncLink.localKey, created.id));
		expect(links).toHaveLength(0);
	});

	// A generated event that has aged past the trailing horizon is simply absent,
	// and the engine took that to mean "authored, and deleted here" — so it pushed
	// a deletion for every past mortgage payment out to the household's own
	// calendar, one per loan per month, forever. The file's own header promises
	// the opposite.
	//
	// Modelled directly: a link and a remote copy for a `gen:` key that no ledger
	// row currently produces, which is exactly what a payment past the horizon
	// looks like.
	it('never deletes a generated event that has aged out of the horizon', async () => {
		const key = 'gen:loanPayments:loan:gone:paymentDay:2024-01';
		const remoteId = toRemoteId(key);
		const series = remoteSeries(key, {
			title: 'Mortgage payment',
			startsAt: '2024-01-15T00:00:00.000Z',
			endsAt: '2024-01-15T23:59:59.000Z'
		});

		fake.setRemote(remoteId, series);
		await testDb.insert(schema.calendarSyncLink).values({
			localKey: key,
			accountId: ACCOUNT,
			remoteId,
			pushedHash: 'stale',
			seenHash: 'stale'
		});

		await sync();

		// Still in the household's calendar.
		expect(fake.has(remoteId)).toBe(true);
		// And no longer tracked, so it will not be looked at again.
		const links = await testDb
			.select()
			.from(schema.calendarSyncLink)
			.where(eq(schema.calendarSyncLink.localKey, key));
		expect(links).toHaveLength(0);
	});

	// The advisory lock was taken on the pool handle outside any transaction, so
	// its own implicit transaction committed as the statement returned and the
	// xact-scoped lock was gone before the pull began. It excluded nothing.
	it('refuses a second pass while one is already running', async () => {
		// The lease lives in `job` since 0051, one row per account, reused.
		await testDb
			.insert(schema.job)
			.values({
				id: `calendar-sync:${ACCOUNT}`,
				kind: 'calendar_sync',
				subjectId: ACCOUNT,
				state: 'running',
				claimedAt: new Date()
			})
			// One row per account, reused across passes, so setting up a held lease is
			// an upsert rather than an insert.
			.onConflictDoUpdate({
				target: schema.job.id,
				set: { state: 'running', claimedAt: new Date() }
			});

		fake.resetCounters();
		const report = await sync();
		expect(fake.pullCount).toBe(0);
		expect(report.pulled).toBe(0);
	});

	// A lease, not a lock: a process killed mid-pass must not lock the account out
	// for good.
	it('takes over a lease left behind by a pass that died', async () => {
		const stale = new Date(Date.now() - 60 * 60_000);
		await testDb
			.insert(schema.job)
			.values({
				id: `calendar-sync:${ACCOUNT}`,
				kind: 'calendar_sync',
				subjectId: ACCOUNT,
				state: 'running',
				claimedAt: stale,
				attempts: 1
			})
			.onConflictDoUpdate({
				target: schema.job.id,
				set: { state: 'running', claimedAt: stale, attempts: 1 }
			});

		fake.resetCounters();
		await sync();
		expect(fake.pullCount).toBe(1);

		const [lease] = await testDb
			.select()
			.from(schema.job)
			.where(eq(schema.job.id, `calendar-sync:${ACCOUNT}`));
		expect(lease.state).toBe('done');
		// Taken over rather than left alone, and the count says so.
		expect(lease.attempts).toBe(2);
	});

	// A pass that throws has to give the claim up on the way out, or the account
	// is locked out until the lease expires.
	it('releases the lease when a pass fails', async () => {
		await createEvent(event(), null, testDb);
		fake.failNextPush();
		await expect(sync()).rejects.toThrow();

		const [lease] = await testDb
			.select()
			.from(schema.job)
			.where(eq(schema.job.id, `calendar-sync:${ACCOUNT}`));
		// Not still running: a pass that threw must give the claim up on the way out,
		// or the account is locked out until the lease expires. The failure is
		// recorded on the work rather than only on the account.
		expect(lease.state).toBe('failed');
		expect(lease.error).toBeTruthy();
	});
});
