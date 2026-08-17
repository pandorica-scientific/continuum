import type { EventSeries } from '$lib/server/calendar/series';
import type {
	CalendarProvider,
	PullResult,
	PushOp,
	PushResult,
	RemoteCalendar
} from '$lib/server/calendar/sync/provider';

/**
 * An in-memory calendar server, standing in for Google and iCloud.
 *
 * A test double rather than shipped code. It exists so the engine's real risks —
 * duplication, resurrection, the push loop, a half-finished pass — can be
 * exercised deterministically and in milliseconds, instead of against a live
 * account with rate limits and a network.
 *
 * It models the parts of a real server that the engine actually has to survive:
 * a monotonic change log, opaque cursors, etags with optimistic concurrency, and
 * the ability to invalidate a cursor or fail a write on demand.
 */
export class FakeCalendarProvider implements CalendarProvider {
	readonly id = 'fake';
	readonly label = 'Fake calendar';

	// Keyed by RESOURCE ID — the address we write to — while the series carries
	// our own uid inside it. Real servers keep these apart: CalDAV has a UID:
	// property distinct from the resource path, Google an iCalUID distinct from
	// its id. Collapsing them here would hide the mapping the engine has to get
	// right.
	private store = new Map<string, { series: EventSeries; etag: string }>();
	/** Append-only log of {resourceId, uid} that changed. Cursors index into it. */
	private log: Array<{ resourceId: string; uid: string }> = [];
	private etagCounter = 0;

	private forceResetNext = false;
	/** When set, the next reset lists only events starting at or after this. */
	private resetFromNext: string | null = null;
	private failNextPushOnce = false;
	/** Resource ids whose deletion is reported WITHOUT a uid, as CalDAV does. */
	private unnamedDeletions = new Set<string>();

	/** Counters a test can assert on — the push-loop guard reads pushCount. */
	pushCount = 0;
	pullCount = 0;

	resetCounters(): void {
		this.pushCount = 0;
		this.pullCount = 0;
	}

	// ---- what a test drives the remote side with -----------------------------

	/** Someone edited or created an event directly on the remote. */
	setRemote(resourceId: string, series: EventSeries): void {
		this.etagCounter += 1;
		this.store.set(resourceId, { series, etag: `etag-${this.etagCounter}` });
		this.log.push({ resourceId, uid: series.uid });
	}

	/** Someone deleted an event on the remote. */
	deleteRemote(resourceId: string): void {
		// The uid is captured BEFORE the row goes: after deletion there is nothing
		// left to read it from, and a deletion the caller cannot name is a deletion
		// the engine cannot act on.
		const uid = this.store.get(resourceId)?.series.uid ?? resourceId;
		this.store.delete(resourceId);
		this.log.push({ resourceId, uid });
	}

	has(uid: string): boolean {
		return this.store.has(uid);
	}

	get(uid: string): EventSeries | undefined {
		return this.store.get(uid)?.series;
	}

	uids(): string[] {
		return [...this.store.keys()];
	}

	/**
	 * Invalidate the cursor, as Google does with 410 Gone on a stale syncToken.
	 *
	 * `from` models a WINDOWED reset: Google's reset listing reaches back only
	 * ninety days, so it says nothing at all about anything older. The engine has
	 * to be told where the listing starts, or it reads that silence as deletion.
	 */
	forceReset(from: string | null = null): void {
		this.forceResetNext = true;
		this.resetFromNext = from;
	}

	/**
	 * Delete an event and report it the way CalDAV must: by resource path only.
	 *
	 * There is no body left to read a UID out of, so the provider genuinely
	 * cannot name it. The engine has to map the path back to a local key itself.
	 */
	deleteRemoteUnnamed(resourceId: string): void {
		this.unnamedDeletions.add(resourceId);
		this.deleteRemote(resourceId);
	}

	/** Make the next push throw, to leave a pass half-finished. */
	failNextPush(): void {
		this.failNextPushOnce = true;
	}

	// ---- the provider contract ------------------------------------------------

	async probe() {
		return { ok: true, detail: 'fake provider' };
	}

	async listCalendars(): Promise<RemoteCalendar[]> {
		return [{ id: 'fake-cal', name: 'Fake calendar' }];
	}

	async pull(cursor: string | null): Promise<PullResult> {
		this.pullCount += 1;

		if (this.forceResetNext) {
			this.forceResetNext = false;
			const from = this.resetFromNext;
			this.resetFromNext = null;
			// A reset hands back EVERYTHING the server holds and no deletions —
			// exactly what a real full resync gives you, and the reason the engine
			// cannot infer "deleted remotely" from absence during one.
			return {
				changes: [...this.store.entries()]
					.filter(
						([, held]) =>
							!from || new Date(held.series.startsAt).getTime() >= new Date(from).getTime()
					)
					.map(([resourceId, held]) => ({
						uid: held.series.uid,
						remoteId: resourceId,
						series: held.series,
						etag: held.etag
					})),
				cursor: String(this.log.length),
				reset: true,
				resetFrom: from
			};
		}

		const from = cursor === null ? 0 : Number(cursor);
		const touched = new Map<string, string>();
		for (const entry of this.log.slice(from)) touched.set(entry.resourceId, entry.uid);
		return {
			changes: [...touched].map(([resourceId, uid]) => {
				const held = this.store.get(resourceId);
				return {
					// An unnamed deletion reports the path and nothing else, because
					// that is genuinely all a CalDAV server has left to report.
					uid: !held && this.unnamedDeletions.has(resourceId) ? '' : uid,
					remoteId: resourceId,
					series: held?.series ?? null,
					etag: held?.etag ?? null
				};
			}),
			cursor: String(this.log.length),
			reset: false
		};
	}

	async push(ops: PushOp[]): Promise<PushResult[]> {
		if (this.failNextPushOnce) {
			this.failNextPushOnce = false;
			throw new Error('fake provider: push failed');
		}

		this.pushCount += ops.length;

		return ops.map((op) => {
			const held = this.store.get(op.remoteId);

			// Optimistic concurrency: a stale etag means someone else wrote first,
			// and the caller must re-read rather than retry the same write.
			if (op.etag && held && held.etag !== op.etag) {
				return {
					ok: false as const,
					remoteId: op.remoteId,
					conflict: true,
					message: 'etag mismatch'
				};
			}

			if (op.kind === 'delete') {
				const uid = held?.series.uid ?? op.remoteId;
				this.store.delete(op.remoteId);
				this.log.push({ resourceId: op.remoteId, uid });
				return { ok: true as const, remoteId: op.remoteId, etag: null };
			}

			this.etagCounter += 1;
			const etag = `etag-${this.etagCounter}`;
			this.store.set(op.remoteId, { series: op.series, etag });
			this.log.push({ resourceId: op.remoteId, uid: op.series.uid });
			return { ok: true as const, remoteId: op.remoteId, etag };
		});
	}
}
