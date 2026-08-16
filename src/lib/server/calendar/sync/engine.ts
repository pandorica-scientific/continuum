import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import {
	calendarAccount,
	calendarConflict,
	calendarEvent,
	calendarEventException,
	calendarSyncLink
} from '$lib/server/db/schema';
import { generateEvents, getCalendarMarkers } from '$lib/server/calendar';
import { hashSeries, type EventSeries } from '$lib/server/calendar/series';
import { markerForCategory, markerForGenerated } from '$lib/calendar/markers';
import { merge, type MergeOutcome } from '$lib/calendar/merge';
import { toRemoteId, type OriginBinding } from '$lib/calendar/keys';
import { applyWriteBack } from '$lib/server/calendar/bindings';
import type { CalendarProvider, PushOp } from '$lib/server/calendar/sync/provider';

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

export interface SyncReport {
	pulled: number;
	pushed: number;
	applied: number;
	conflicts: number;
	writeBacks: number;
	reset: boolean;
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

	const rows = await handle.select().from(calendarEvent);
	const exceptions = await handle.select().from(calendarEventException);

	for (const row of rows) {
		// A tombstone is carried, not skipped: the engine has to be able to push a
		// deletion, and an absent item is indistinguishable from one that never
		// existed.
		const mine = exceptions.filter((e) => e.eventId === row.id);
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
							notes: e.notes
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
		reset: false
	};

	const [account] = await handle
		.select()
		.from(calendarAccount)
		.where(eq(calendarAccount.id, accountId))
		.limit(1);
	if (!account) throw new Error(`No calendar account ${accountId}`);

	// One pass per account at a time. Two overlapping passes would each decide
	// what to push from a snapshot the other is invalidating — the same technique
	// transfer pairing already uses.
	await handle.execute(
		sql`select pg_advisory_xact_lock(hashtext(${`calendar-sync:${accountId}`}))`
	);

	// ---- pull ------------------------------------------------------------------
	const pulled = await provider.pull(account.cursor);
	report.pulled = pulled.changes.length;
	report.reset = pulled.reset;

	const remoteByUid = new Map(pulled.changes.map((c) => [c.uid, c]));

	const links = await handle
		.select()
		.from(calendarSyncLink)
		.where(eq(calendarSyncLink.accountId, accountId));
	const linkByKey = new Map(links.map((l) => [l.localKey, l]));

	const items = await localItems(handle);

	// ---- reconcile + merge -----------------------------------------------------
	// Remote uids belong here too: an event created on someone's phone exists in
	// neither our tables nor the link table, so a set built from those two alone
	// would never look at it and it would never arrive.
	const keys = new Set([...items.keys(), ...linkByKey.keys(), ...remoteByUid.keys()]);
	const pushOps: Array<{ op: PushOp; localKey: string; hash: string | null }> = [];
	const outcomes = new Map<string, MergeOutcome>();

	for (const key of keys) {
		const item = items.get(key);
		const link = linkByKey.get(key);
		if (link?.suppressedAt) continue; // deliberately deleted on the remote

		const remoteId = link?.remoteId ?? toRemoteId(key);
		const change = remoteByUid.get(key);

		const localSeries = item?.series ?? null;
		const localHash = localSeries ? hashSeries(localSeries, item?.marker ?? null) : null;

		// On a full reset the pull carries everything the server holds, so absence
		// means "not there"; on an incremental pull absence means "unchanged", and
		// the last seen hash still stands.
		const remoteSeries = change ? change.series : pulled.reset ? null : undefined;
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
			generated: item?.generated ?? false,
			dateOnlyChange: dates.dateOnly,
			newDate: dates.newDate,
			binding: item?.binding ?? null
		});

		outcomes.set(key, outcome);

		if (outcome.kind === 'push' && localSeries) {
			pushOps.push({
				op: {
					kind: 'upsert',
					remoteId,
					series: decorated(localSeries, item!),
					etag: link?.remoteEtag ?? null
				},
				localKey: key,
				hash: localHash
			});
		} else if (outcome.kind === 'push-delete') {
			pushOps.push({
				op: { kind: 'delete', remoteId, etag: link?.remoteEtag ?? null },
				localKey: key,
				hash: null
			});
		} else if (outcome.kind === 'conflict' && outcome.winner === 'local' && localSeries) {
			pushOps.push({
				op: {
					kind: 'upsert',
					remoteId,
					series: decorated(localSeries, item!),
					etag: link?.remoteEtag ?? null
				},
				localKey: key,
				hash: localHash
			});
		}
	}

	// ---- push ------------------------------------------------------------------
	const results = pushOps.length > 0 ? await provider.push(pushOps.map((p) => p.op)) : [];
	report.pushed = results.filter((r) => r.ok).length;

	// ---- commit ----------------------------------------------------------------
	// Everything below runs in ONE transaction, and the cursor advances LAST. A
	// pass that dies partway re-fetches the same changes on the next run rather
	// than skipping them, because the cursor still points at where it started.
	await handle.transaction(async (tx) => {
		for (let i = 0; i < pushOps.length; i++) {
			const sent = pushOps[i];
			const result = results[i];
			if (!result?.ok) continue;

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
			const change = remoteByUid.get(key);

			if (outcome.kind === 'apply' && change?.series) {
				await applyRemote(tx, key, change.series);
				await upsertLink(tx, {
					localKey: key,
					accountId,
					remoteId: change.uid ? toRemoteId(key) : toRemoteId(key),
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
				await tx.insert(calendarConflict).values({
					id: randomUUID(),
					localKey: key,
					accountId,
					ours: (item?.series ?? null) as never,
					theirs: (change?.series ?? null) as never,
					resolution: outcome.winner === 'local' ? 'local-won' : 'remote-won'
				});
				if (outcome.winner === 'remote' && change?.series) {
					await applyRemote(tx, key, change.series);
				}
				report.conflicts += 1;
			}

			if (outcome.kind === 'write-back') {
				// The ledger row is updated and the change recorded in one go —
				// applyWriteBack owns both, so a payment day that moved can always be
				// traced back to the calendar edit that moved it.
				const result = await applyWriteBack(
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
				if (result.ok) report.writeBacks += 1;
			}
		}

		await reapTombstones(tx);

		// Last, deliberately.
		await tx
			.update(calendarAccount)
			.set({ cursor: pulled.cursor, lastSyncAt: new Date(), lastError: null })
			.where(eq(calendarAccount.id, accountId));
	});

	return report;
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
 * all. An account added later starts from an empty cursor and reconciles from
 * scratch, so nothing is lost by having forgotten a deletion it never saw.
 */
async function reapTombstones(tx: Parameters<Parameters<Db['transaction']>[0]>[0]) {
	await tx.execute(sql`
		delete from calendar_event
		where deleted_at is not null
		  and not exists (
			select 1 from calendar_sync_link where calendar_sync_link.local_key = calendar_event.id
		  )
	`);
}

/** The series as it should appear remotely, marker and source tag included. */
function decorated(series: EventSeries, item: LocalItem): EventSeries {
	const head = item.marker ? `${item.marker} ` : '';
	const tag = item.generated ? ' · Continuum' : '';
	return { ...series, title: `${head}${series.title}${tag}` };
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

/** Write a remote series into our own tables. */
async function applyRemote(
	tx: Parameters<Parameters<Db['transaction']>[0]>[0],
	localKey: string,
	series: EventSeries
) {
	const values = {
		title: series.title,
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
				id: randomUUID(),
				eventId: localKey,
				recurrenceId: e.recurrenceId,
				cancelled: e.cancelled,
				title: e.title ?? null,
				startsAt: e.startsAt ? new Date(e.startsAt) : null,
				endsAt: e.endsAt ? new Date(e.endsAt) : null,
				notes: e.notes ?? null
			}))
		);
	}
}
