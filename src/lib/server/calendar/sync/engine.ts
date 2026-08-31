// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuidv7 } from 'uuidv7';
import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db, type Db, type Queryable, type Tx } from '$lib/server/db';
import {
	calendarAccount,
	calendarEvent,
	calendarEventException,
	calendarSyncLink,
	job
} from '$lib/server/db/schema';
import { generateEvents, getCalendarMarkers } from '$lib/server/calendar';
import { hashSeries, type EventSeries } from '$lib/server/calendar/series';
import { decorate, markerForCategory, markerForGenerated, strip } from '$lib/calendar/markers';
import { merge, type MergeOutcome } from '$lib/calendar/merge';
import { fromRemoteId, isGeneratedKey, toRemoteId, type OriginBinding } from '$lib/calendar/keys';
import { applyWriteBack } from '$lib/server/calendar/bindings';
import { recordConflict } from '$lib/server/calendar/conflicts';
import type { CalendarProvider, PushOp, RemoteChange } from '$lib/server/calendar/sync/provider';

/**
 * How far either side of today generated events are published.
 *
 * Loan payments go out as individual dated events rather than one RRULE series:
 * the amount is part of the title and changes per fixation period, and the
 * payment day clamps to month length, so no single rule describes them honestly.
 * Events falling off the trailing edge are left alone — deleting someone's
 * history out of their own calendar is not ours to do.
 */
const HORIZON_BACK_DAYS = 90;
const HORIZON_FORWARD_DAYS = 365;

/**
 * How long a claimed pass may run before another may take it over.
 *
 * A lease, not a lock, because the work in the middle is network I/O that can
 * take minutes and no database lock should be held across it. Long enough that a
 * slow first pass over hundreds of events is never stolen; short enough that a
 * process killed mid-pass does not leave the account stuck.
 */
const LEASE_MINUTES = 30;

/**
 * How long a tombstone survives after the last link to it goes.
 *
 * Reaping in the same transaction that created the tombstone made a remote
 * deletion unrecoverable the instant it arrived: the row was tombstoned, its
 * link removed, and the reap — running a few lines later in the same
 * transaction — saw no link and hard-deleted it. With one account connected
 * there was nothing left to restore from. A week is long enough to notice.
 */
const TOMBSTONE_GRACE_DAYS = 7;

export interface SyncReport {
	pulled: number;
	pushed: number;
	applied: number;
	conflicts: number;
	writeBacks: number;
	reset: boolean;
	/** True when another pass already held this account and nothing was done.
	 *  Reported rather than swallowed: a manual "Sync now" that silently did
	 *  nothing looks exactly like one that ran and found no work. */
	skipped: boolean;
	/** Writes the provider refused. Recorded rather than skipped: a provider
	 *  rejecting every write used to look exactly like having nothing to do. */
	rejected: number;
	/** The first refusal, for the account's error line. */
	rejection: string | null;
}

/** A local event, in the shape the merge and the provider both understand. */
interface LocalItem {
	localKey: string;
	series: EventSeries;
	generated: boolean;
	binding: OriginBinding | null;
	marker: string | null;
}

function isoDay(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Everything this account should be holding, from both sources.
 *
 * Generated events stay derived — recomputed here rather than read from a table —
 * which is the property the whole design rests on. What gets stored is the
 * mapping to a remote counterpart, never the event.
 */
async function localItems(handle: Db): Promise<Map<string, LocalItem>> {
	const from = isoDay(-HORIZON_BACK_DAYS);
	const to = isoDay(HORIZON_FORWARD_DAYS);
	const markers = await getCalendarMarkers(handle);

	const items = new Map<string, LocalItem>();

	for (const event of await generateEvents(from, to, handle)) {
		const marker = markers ? markerForGenerated(event.ruleKey, event.binding) : null;
		items.set(event.key, {
			localKey: event.key,
			generated: true,
			binding: event.binding,
			marker,
			series: {
				uid: event.key,
				title: event.label,
				notes: null,
				category: null,
				allDay: true,
				startsAt: `${event.date}T00:00:00.000Z`,
				endsAt: `${event.date}T23:59:59.000Z`,
				tz: 'UTC',
				rrule: null,
				exceptions: [],
				updatedAt: new Date(0).toISOString()
			}
		});
	}

	const [rows, exceptions] = await Promise.all([
		handle.select().from(calendarEvent),
		handle.select().from(calendarEventException)
	]);

	// Grouped once rather than re-scanned per row: filtering the whole exception
	// list inside the loop is rows × exceptions comparisons on every pass.
	const exceptionsByEvent = new Map<string, typeof exceptions>();
	for (const exception of exceptions) {
		const list = exceptionsByEvent.get(exception.eventId);
		if (list) list.push(exception);
		else exceptionsByEvent.set(exception.eventId, [exception]);
	}

	for (const row of rows) {
		// A tombstone is carried, not skipped: the engine has to be able to push a
		// deletion, and an absent item is indistinguishable from one that never
		// existed.
		const mine = exceptionsByEvent.get(row.id) ?? [];
		items.set(row.id, {
			localKey: row.id,
			generated: false,
			binding: null,
			marker: markers ? markerForCategory(row.category) : null,
			series: row.deletedAt
				? null!
				: {
						uid: row.id,
						title: row.title,
						notes: row.notes,
						category: row.category,
						allDay: row.allDay,
						startsAt: row.startsAt.toISOString(),
						endsAt: row.endsAt.toISOString(),
						tz: row.tz,
						rrule: row.rrule,
						exceptions: mine.map((e) => ({
							recurrenceId: e.recurrenceId,
							cancelled: e.cancelled,
							title: e.title,
							startsAt: e.startsAt?.toISOString() ?? null,
							endsAt: e.endsAt?.toISOString() ?? null,
							notes: e.notes,
							category: e.category,
							allDay: e.allDay,
							tz: e.tz
						})),
						updatedAt: row.updatedAt.toISOString()
					}
		});
	}

	return items;
}

/** Whether the remote differs from what we sent in start/end ONLY. */
function dateOnlyDifference(
	ours: EventSeries,
	theirs: EventSeries,
	marker: string | null
): { dateOnly: boolean; newDate: string | null } {
	const sameExceptDates =
		hashSeries({ ...ours, startsAt: '', endsAt: '' }, marker) ===
		hashSeries({ ...theirs, startsAt: '', endsAt: '' }, marker);
	if (!sameExceptDates) return { dateOnly: false, newDate: null };
	return { dateOnly: true, newDate: theirs.startsAt.slice(0, 10) };
}

/**
 * One synchronisation pass for one account: pull → reconcile → merge → push →
 * commit.
 *
 * Pull comes FIRST and that ordering is not stylistic. Pushing first overwrites
 * remote changes we have not fetched, and a conflict that was never fetched
 * cannot be detected — the edit is simply gone, with nothing to show for it.
 */
export async function syncAccount(accountId: string, provider: CalendarProvider, handle: Db = db) {
	const report: SyncReport = {
		pulled: 0,
		pushed: 0,
		applied: 0,
		conflicts: 0,
		writeBacks: 0,
		reset: false,
		skipped: false,
		rejected: 0,
		rejection: null
	};

	const [account] = await handle
		.select()
		.from(calendarAccount)
		.where(eq(calendarAccount.id, accountId))
		.limit(1);
	if (!account) throw new Error(`No calendar account ${accountId}`);

	// One pass per account at a time.
	//
	// This used to be `pg_advisory_xact_lock` on the pool handle, OUTSIDE any
	// transaction — so the statement's own implicit transaction committed as it
	// returned and the xact-scoped lock was released before the pull even
	// started. It excluded nothing at all. Every other advisory lock in this
	// repository takes its lock inside a transaction; this one only looked like
	// it did.
	//
	// A lease rather than a lock, because the middle of a pass is network I/O
	// that can run for minutes, and no database lock belongs open across that.
	// The claim itself is atomic under a real advisory lock, and it works across
	// processes, which an in-memory guard would not.
	if (!(await claimAccount(handle, accountId))) {
		report.skipped = true;
		return report;
	}

	try {
		// ---- pull --------------------------------------------------------------
		const pulled = await provider.pull(account.cursor);
		report.pulled = pulled.changes.length;
		report.reset = pulled.reset;

		const links = await handle
			.select()
			.from(calendarSyncLink)
			.where(eq(calendarSyncLink.accountId, accountId));
		const linkByKey = new Map(links.map((l) => [l.localKey, l]));
		const keyByRemoteId = new Map(links.map((l) => [l.remoteId, l.localKey]));

		const items = await localItems(handle);

		// Every change filed under the LOCAL key it belongs to.
		//
		// A provider does not always know that key. CalDAV reports a deletion as a
		// path and nothing else, because the resource is gone and there is no body
		// left to read a UID from — so the resource name has to be turned back into
		// a local key here. Filing those under the resource name instead meant every
		// deletion made on a phone matched nothing, merged to a no-op, and the
		// cursor advanced past it: the event stayed in Continuum for good, and a
		// generated event the household had deliberately deleted came straight back.
		const remoteByKey = new Map<string, RemoteChange>();
		for (const change of pulled.changes) {
			const key = localKeyFor(change, items, linkByKey, keyByRemoteId);
			if (key) remoteByKey.set(key, change);
		}

		// ---- reconcile + merge -------------------------------------------------
		// Remote keys belong here too: an event created on someone's phone exists
		// in neither our tables nor the link table, so a set built from those two
		// alone would never look at it and it would never arrive.
		const keys = new Set([...items.keys(), ...linkByKey.keys(), ...remoteByKey.keys()]);
		const pushOps: Array<{
			op: PushOp;
			localKey: string;
			hash: string | null;
		}> = [];
		const outcomes = new Map<string, MergeOutcome>();

		for (const key of keys) {
			const item = items.get(key);
			const link = linkByKey.get(key);
			if (link?.suppressedAt) continue; // deliberately deleted on the remote

			const change = remoteByKey.get(key);
			// The name the PROVIDER uses wins over the one we would have chosen.
			// An event created on someone's phone lives at a resource name that
			// server picked; addressing a push at toRemoteId(key) instead sent it
			// to an address that does not exist, so the provider created a SECOND
			// copy of an event we were only trying to update. The link's recorded
			// name comes first because it is the one we last wrote to.
			const remoteId = link?.remoteId ?? change?.remoteId ?? toRemoteId(key);

			const localSeries = item?.series ?? null;
			const localHash = localSeries ? hashSeries(localSeries, item?.marker ?? null) : null;

			// On a full reset the pull carries everything the server holds, so absence
			// means "not there"; on an incremental pull absence means "unchanged", and
			// the last seen hash still stands.
			//
			// EXCEPT where the reset itself was windowed. A provider that lists only
			// the last ninety days has said nothing whatsoever about what came before,
			// and reading its silence as deletion is how one expired syncToken — a
			// routine, documented event — destroyed every authored event older than
			// that. Outside the window the event is treated as unchanged.
			const remoteSeries = change
				? change.series
				: pulled.reset && coveredByReset(localSeries, pulled.resetFrom ?? null)
					? null
					: undefined;
			// Hashed with the SAME marker used on the way out. We push a decorated
			// title and the remote hands it straight back; hashing the echo without
			// stripping that decoration makes every event compare as changed on every
			// pass — push, echo, push — silently, and forever.
			const remoteHash =
				remoteSeries === undefined
					? (link?.seenHash ?? null)
					: remoteSeries
						? hashSeries(remoteSeries, item?.marker ?? null)
						: null;

			const dates =
				localSeries && remoteSeries
					? dateOnlyDifference(localSeries, remoteSeries, item?.marker ?? null)
					: { dateOnly: false, newDate: null };

			const outcome = merge({
				baseHash: link?.pushedHash ?? null,
				localHash,
				remoteHash,
				localUpdatedAt: localSeries?.updatedAt ?? new Date(0).toISOString(),
				remoteUpdatedAt: remoteSeries?.updatedAt ?? new Date(0).toISOString(),
				// Read from the KEY when the event is not in hand. A generated event
				// that has aged past the trailing horizon is simply absent, and taking
				// that to mean "authored, and deleted here" sent a deletion for every
				// past mortgage payment out to the household's own calendar — one per
				// loan per month, forever, which is the exact opposite of what the
				// header of this file promises.
				generated: item?.generated ?? isGeneratedKey(key),
				dateOnlyChange: dates.dateOnly,
				newDate: dates.newDate,
				binding: item?.binding ?? null
			});

			outcomes.set(key, outcome);

			// The etag we just pulled beats the one stored from last time: when the
			// remote has moved, writing against the stale value fails as a conflict and
			// the correction is delayed a whole pass for no reason.
			//
			// `change ? change.etag : …` rather than `change?.etag ?? …`, because a
			// DELETION arrives with a null etag and that null is the answer, not a
			// missing value. Falling back to the stored one made the next write send
			// `If-Match: <etag of a resource that no longer exists>`, which is a 412
			// every time — so an event edited here and deleted there could never be
			// re-created, and retried identically on every pass forever.
			const currentEtag = change ? change.etag : (link?.remoteEtag ?? null);

			if (outcome.kind === 'push' && localSeries) {
				pushOps.push({
					op: {
						kind: 'upsert',
						remoteId,
						series: decorated(localSeries, item!),
						etag: currentEtag
					},
					localKey: key,
					hash: localHash
				});
			} else if (outcome.kind === 'push-delete') {
				pushOps.push({
					op: { kind: 'delete', remoteId, etag: currentEtag },
					localKey: key,
					hash: null
				});
			} else if (outcome.kind === 'conflict' && outcome.winner === 'local' && localSeries) {
				pushOps.push({
					op: {
						kind: 'upsert',
						remoteId,
						series: decorated(localSeries, item!),
						etag: currentEtag
					},
					localKey: key,
					hash: localHash
				});
			}
		}

		// ---- push ----------------------------------------------------------------
		const results = pushOps.length > 0 ? await provider.push(pushOps.map((p) => p.op)) : [];
		report.pushed = results.filter((r) => r.ok).length;

		// A refusal that is not a conflict is a real failure — a malformed body, a
		// permission, a calendar that cannot be written to. Conflicts are ordinary
		// and resolve on the next pass; these do not, and staying quiet about them
		// makes "rejected every write" indistinguishable from "nothing to send".
		const refused = results.filter((r) => !r.ok && !r.conflict);
		report.rejected = refused.length;
		report.rejection = refused[0]?.ok === false ? refused[0].message : null;

		// ---- commit --------------------------------------------------------------
		// Everything below runs in ONE transaction, and the cursor advances LAST. A
		// pass that dies partway re-fetches the same changes on the next run rather
		// than skipping them, because the cursor still points at where it started.
		await handle.transaction(async (tx) => {
			for (let i = 0; i < pushOps.length; i++) {
				const sent = pushOps[i];
				const result = results[i];

				if (!result?.ok) {
					// A rejected write means the remote moved under us. Take the etag the
					// pull just gave us so the NEXT pass can write; leaving the stale one
					// in place makes every future attempt fail the same way, and a
					// generated event retitled on someone's phone would never be corrected.
					const seen = remoteByKey.get(sent.localKey);
					if (result?.conflict && seen?.etag) {
						await tx
							.update(calendarSyncLink)
							.set({ remoteEtag: seen.etag })
							.where(
								and(
									eq(calendarSyncLink.localKey, sent.localKey),
									eq(calendarSyncLink.accountId, accountId)
								)
							);
					}
					continue;
				}

				if (sent.op.kind === 'delete') {
					// The remote copy is gone, so the mapping to it is meaningless. This
					// used to UPSERT the link instead, which left a row pointing at an
					// event that no longer existed — and since reapTombstones only fires
					// once no link mentions a row, tombstones and links then accumulated
					// with nothing able to clear either.
					await tx
						.delete(calendarSyncLink)
						.where(
							and(
								eq(calendarSyncLink.localKey, sent.localKey),
								eq(calendarSyncLink.accountId, accountId)
							)
						);
					continue;
				}

				await upsertLink(tx, {
					localKey: sent.localKey,
					accountId,
					remoteId: sent.op.remoteId,
					remoteEtag: result.etag,
					pushedHash: sent.hash,
					seenHash: sent.hash
				});
			}

			for (const [key, outcome] of outcomes) {
				const item = items.get(key);
				const change = remoteByKey.get(key);

				if (outcome.kind === 'apply' && change?.series) {
					await applyRemote(tx, key, change.series, item?.marker ?? null);
					await upsertLink(tx, {
						localKey: key,
						accountId,
						// The name the provider actually uses, so a later deletion — which
						// arrives as a path and nothing else — can be matched back to this
						// key, and so the next push goes to the resource we just read
						// rather than to the one we would have named ourselves.
						remoteId: change.remoteId ?? toRemoteId(key),
						remoteEtag: change.etag,
						pushedHash: hashSeries(change.series, item?.marker ?? null),
						seenHash: hashSeries(change.series, item?.marker ?? null)
					});
					report.applied += 1;
				}

				if (outcome.kind === 'apply-delete') {
					await tx
						.update(calendarEvent)
						.set({ deletedAt: new Date(), updatedAt: new Date() })
						.where(and(eq(calendarEvent.id, key), isNull(calendarEvent.deletedAt)));
					await tx
						.delete(calendarSyncLink)
						.where(
							and(eq(calendarSyncLink.localKey, key), eq(calendarSyncLink.accountId, accountId))
						);
					report.applied += 1;
				}

				if (outcome.kind === 'drop-link') {
					await tx
						.delete(calendarSyncLink)
						.where(
							and(eq(calendarSyncLink.localKey, key), eq(calendarSyncLink.accountId, accountId))
						);
				}

				if (outcome.kind === 'suppress') {
					await tx
						.update(calendarSyncLink)
						.set({ suppressedAt: new Date() })
						.where(
							and(eq(calendarSyncLink.localKey, key), eq(calendarSyncLink.accountId, accountId))
						);
				}

				if (outcome.kind === 'conflict') {
					await recordConflict(tx, {
						localKey: key,
						accountId,
						ours: item?.series ?? null,
						theirs: change?.series ?? null,
						resolution: outcome.winner === 'local' ? 'local-won' : 'remote-won'
					});
					if (outcome.winner === 'remote' && change?.series) {
						await applyRemote(tx, key, change.series, item?.marker ?? null);
						// The remote's version is now the agreed one, exactly as in the
						// write-back branch below. Without this the base hash still
						// described what we had pushed BEFORE the conflict, so the next
						// pass saw both sides changed again and filed a SECOND conflict
						// row for an edit that had already been resolved.
						const agreed = hashSeries(change.series, item?.marker ?? null);
						await upsertLink(tx, {
							localKey: key,
							accountId,
							remoteId: change.remoteId ?? linkByKey.get(key)?.remoteId ?? toRemoteId(key),
							remoteEtag: change.etag ?? linkByKey.get(key)?.remoteEtag ?? null,
							pushedHash: agreed,
							seenHash: agreed
						});
					}
					report.conflicts += 1;
				}

				if (outcome.kind === 'write-back') {
					// The ledger row is updated and the change recorded in one go —
					// applyWriteBack owns both, so a payment day that moved can always be
					// traced back to the calendar edit that moved it.
					const written = await applyWriteBack(
						item!.binding!,
						outcome.value,
						{
							localKey: key,
							accountId,
							ours: item?.series ?? null,
							theirs: change?.series ?? null
						},
						tx as unknown as Db
					);
					if (written.ok) {
						report.writeBacks += 1;
						// The remote's version is now the agreed one. Without this the base
						// hash still described the date BEFORE the move, so the same move
						// was rediscovered on every pass — writing the ledger again and
						// filing another conflict row every fifteen minutes.
						if (change?.series) {
							const agreed = hashSeries(change.series, item?.marker ?? null);
							await upsertLink(tx, {
								localKey: key,
								accountId,
								remoteId: change.remoteId ?? linkByKey.get(key)?.remoteId ?? toRemoteId(key),
								remoteEtag: change.etag ?? linkByKey.get(key)?.remoteEtag ?? null,
								pushedHash: agreed,
								seenHash: agreed
							});
						}
					}
				}
			}

			await reapTombstones(tx);

			// Last, deliberately. The lease is given up in the same statement: a pass
			// that reached here is finished, and holding the claim past that would
			// stall the next one for no reason.
			await tx
				.update(calendarAccount)
				.set({
					cursor: pulled.cursor,
					lastSyncAt: new Date(),
					lastError: report.rejection
						? `${report.rejected} of ${pushOps.length} writes refused — ${report.rejection}`
						: null
				})
				.where(eq(calendarAccount.id, accountId));
			// The lease is given up in the same transaction: a pass that reached here
			// is finished, and holding the claim past that stalls the next one for no
			// reason.
			await releaseAccount(tx, accountId);
		});

		return report;
	} catch (error) {
		// The claim is given up on the way out either way, or a pass that threw
		// would lock the account out until the lease expired.
		// Released on the way out either way, or a pass that threw would lock the
		// account out until the lease expired.
		await releaseAccount(handle, accountId, error instanceof Error ? error.message : String(error));
		throw error;
	}
}

/**
 * Take this account's pass, or report that somebody else has it.
 *
 * The advisory lock is held only for the read-modify-write of the claim, which
 * is the part that has to be atomic; the pass itself then runs outside it. That
 * is the whole difference from what was here before, where the lock was taken on
 * the pool handle outside any transaction and released again immediately,
 * excluding nothing.
 *
 * Overlap was easy to reach: the tick in hooks.server.ts fires every sixty
 * seconds, an account that has never synced is due unconditionally, and a first
 * pass pushes hundreds of events one request at a time with a twenty-second
 * timeout on each. Two passes then pulled the same cursor, pushed the same
 * writes twice, and both ran the commit block.
 */
async function claimAccount(handle: Db, accountId: string): Promise<boolean> {
	const staleBefore = new Date(Date.now() - LEASE_MINUTES * 60_000);
	const jobId = `calendar-sync:${accountId}`;

	return handle.transaction(async (tx) => {
		// The advisory lock is what makes read-then-claim atomic ACROSS PROCESSES,
		// which an in-memory guard would not be. Held only for the claim itself —
		// the pass that follows is minutes of network I/O and no database lock
		// belongs open across it.
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`calendar-sync:${accountId}`}))`);

		// The lease lives in `job` rather than on the account: it is the same
		// take-it-and-stamp-it mechanism the import queue uses, and it was written
		// twice before this. One row per account, reused, so a pass leaves no
		// history to sweep up.
		const claimed = await tx
			.insert(job)
			.values({
				id: jobId,
				kind: 'calendar_sync',
				subjectId: accountId,
				state: 'running',
				claimedAt: new Date(),
				attempts: 1
			})
			.onConflictDoUpdate({
				target: job.id,
				set: {
					state: 'running',
					claimedAt: new Date(),
					attempts: sql`${job.attempts} + 1`,
					finishedAt: null,
					error: null
				},
				// Taken only when nobody holds it, or when whoever did has gone
				// quiet for longer than the lease. Without the second clause a
				// process killed mid-pass would lock the account out for good.
				setWhere: or(ne(job.state, 'running'), lt(job.claimedAt, staleBefore))
			})
			.returning({ id: job.id });

		return claimed.length > 0;
	});
}

/** Give up the pass, whether it finished or threw. */
async function releaseAccount(handle: Queryable, accountId: string, error?: string): Promise<void> {
	await handle
		.update(job)
		.set({ state: error ? 'failed' : 'done', finishedAt: new Date(), error: error ?? null })
		.where(eq(job.id, `calendar-sync:${accountId}`));
}

/**
 * Whether a windowed reset actually says anything about this event.
 *
 * A reset listing that reaches back only so far is silent about everything
 * older, and silence is not deletion. Recurring series are never judged by this
 * either: the master can predate the window by years while its occurrences fall
 * inside it, so its absence is not evidence of anything.
 */
function coveredByReset(localSeries: EventSeries | null, resetFrom: string | null): boolean {
	if (!resetFrom) return true; // the listing covered the whole calendar
	if (!localSeries || localSeries.rrule) return false;
	return new Date(localSeries.startsAt).getTime() >= new Date(resetFrom).getTime();
}

/**
 * The local key a pulled change belongs to.
 *
 * Four ways of asking, in order of how much they are trusted: a uid we already
 * know, the link table's record of how this provider names the resource, the
 * remote id decoded back into the key it was built from, and finally the uid as
 * given — which is what a genuinely new remote event looks like.
 */
function localKeyFor(
	change: RemoteChange,
	items: Map<string, LocalItem>,
	linkByKey: Map<string, { localKey: string }>,
	keyByRemoteId: Map<string, string>
): string | null {
	if (change.uid && (items.has(change.uid) || linkByKey.has(change.uid))) return change.uid;

	if (change.remoteId) {
		const linked = keyByRemoteId.get(change.remoteId);
		if (linked) return linked;
		const decoded = fromRemoteId(change.remoteId);
		if (decoded) return decoded;
	}

	return change.uid || null;
}

/**
 * Remove tombstones whose deletion every account has now taken.
 *
 * deleteEvent tombstones rather than deleting, because sync must be able to tell
 * "deleted here, push it" from "never existed" — a vanished row says nothing and
 * the engine would pull the remote copy back. Once no sync link references the
 * row, the deletion has been carried everywhere it needed to go and the
 * tombstone is only taking up space.
 *
 * Deliberately conservative: a row is reaped only when NO link mentions it at
 * all, AND the tombstone has had time to be noticed. Without that second
 * condition a deletion arriving from a remote was unrecoverable the moment it
 * landed — apply-delete tombstoned the row and dropped its link, and this ran a
 * few lines later in the SAME transaction, saw no link, and hard-deleted it.
 *
 * An account added later starts from an empty cursor and reconciles from
 * scratch, so nothing is lost by having forgotten a deletion it never saw.
 */
async function reapTombstones(tx: Tx) {
	await tx.execute(sql`
		delete from calendar_event
		where deleted_at is not null
		  and deleted_at < now() - ${sql.raw(`interval '${TOMBSTONE_GRACE_DAYS} days'`)}
		  and not exists (
			-- local_key is text on purpose: it holds an authored event's uuid OR a
			-- generated event's \`gen:\` key, so it is not always a uuid and the cast
			-- has to go the other way.
			select 1 from calendar_sync_link
			 where calendar_sync_link.local_key = calendar_event.id::text
		  )
	`);
}

/**
 * The series as it should appear remotely, marker and source tag included.
 *
 * Composed by markers.decorate, which is also what the ICS feed and the calendar
 * screen use. This file used to build the same string by hand, so "· Continuum"
 * lived in two places and only one of them had a matching `strip`.
 */
function decorated(series: EventSeries, item: LocalItem): EventSeries {
	return { ...series, title: decorate(series.title, item.marker, item.generated) };
}

async function upsertLink(
	tx: Parameters<Parameters<Db['transaction']>[0]>[0],
	values: {
		localKey: string;
		accountId: string;
		remoteId: string;
		remoteEtag: string | null;
		pushedHash: string | null;
		seenHash: string | null;
	}
) {
	await tx
		.insert(calendarSyncLink)
		.values(values)
		.onConflictDoUpdate({
			target: [calendarSyncLink.localKey, calendarSyncLink.accountId],
			set: {
				remoteId: values.remoteId,
				remoteEtag: values.remoteEtag,
				pushedHash: values.pushedHash,
				seenHash: values.seenHash
			}
		});
}

/**
 * Write a remote series into our own tables.
 *
 * The marker comes off the title on the way IN, mirroring decorate() on the way
 * out. Storing the title as the remote returned it baked our own decoration
 * into the row — and since the calendar screen draws the marker separately from
 * the title, the event then showed two of them, with another added every time a
 * remote edit came back. markers.ts is explicit that decoration is composed at
 * the edge and never stored, for exactly this reason.
 */
async function applyRemote(
	tx: Parameters<Parameters<Db['transaction']>[0]>[0],
	localKey: string,
	series: EventSeries,
	marker: string | null
) {
	const values = {
		title: strip(series.title, marker),
		notes: series.notes,
		category: series.category,
		allDay: series.allDay,
		startsAt: new Date(series.startsAt),
		endsAt: new Date(series.endsAt),
		tz: series.tz,
		rrule: series.rrule,
		updatedAt: new Date(),
		deletedAt: null
	};

	await tx
		.insert(calendarEvent)
		.values({ id: localKey, ...values })
		.onConflictDoUpdate({ target: calendarEvent.id, set: values });

	// Replace rather than diff: the series is the transfer unit, so its exceptions
	// arrive as a set and a leftover row would be an occurrence nobody asked for.
	await tx.delete(calendarEventException).where(eq(calendarEventException.eventId, localKey));
	if (series.exceptions.length > 0) {
		await tx.insert(calendarEventException).values(
			series.exceptions.map((e) => ({
				id: uuidv7(),
				eventId: localKey,
				recurrenceId: e.recurrenceId,
				cancelled: e.cancelled,
				title: e.title ?? null,
				startsAt: e.startsAt ? new Date(e.startsAt) : null,
				endsAt: e.endsAt ? new Date(e.endsAt) : null,
				notes: e.notes ?? null,
				category: e.category ?? null,
				allDay: e.allDay ?? null,
				tz: e.tz ?? null
			}))
		);
	}
}
