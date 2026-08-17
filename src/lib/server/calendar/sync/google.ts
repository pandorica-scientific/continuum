// Google Calendar.
//
// The API is free — 1,000,000 requests a day, no billing account — and this
// design polls every 15 minutes, so the cost is entirely in setup: each
// household creates its own Cloud project and OAuth client, because Google will
// not verify a self-hosted app on behalf of everyone who installs it. See
// docs/google-calendar-setup.md, and note the publishing-status trap called out
// in the field hint below.
//
// THE ONE THING THIS FILE EXISTS FOR: Google gives every exception its own event
// resource, tied to the parent by recurringEventId, where CalDAV keeps the whole
// series in one .ics. Because the engine's transfer unit is a whole series, that
// asymmetry is absorbed here — toGoogleEvents fans out, fromGoogleEvents folds
// back — and the engine never learns about it.

import {
	registerCalendarProvider,
	type CalendarProvider,
	type PullResult,
	type PushOp,
	type PushResult,
	type RemoteCalendar,
	type RemoteChange
} from '$lib/server/calendar/sync/provider';
import type { EventSeries, SeriesException } from '$lib/server/calendar/series';
import { overrideRemoteId } from '$lib/calendar/keys';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 20_000;

/**
 * How far back a full listing reaches when the syncToken is no good.
 *
 * Named and reported rather than inlined twice, because the engine has to know
 * it. Under a reset an absent event means a deleted one; an event older than
 * this window is merely unlisted, and the two were indistinguishable, so one
 * expired syncToken — an ordinary, documented event — hard-deleted every
 * authored event older than ninety days.
 */
const RESET_WINDOW_DAYS = 90;

function resetWindowStart(): string {
	return new Date(Date.now() - RESET_WINDOW_DAYS * 86_400_000).toISOString();
}

export interface GoogleTime {
	date?: string;
	dateTime?: string;
	timeZone?: string;
}

export interface GoogleEvent {
	id: string;
	/** Read-only on events.insert — present only on what Google hands back. */
	iCalUID?: string;
	/** Where our own uid travels. Unlike iCalUID, insert accepts this. */
	extendedProperties?: { private?: Record<string, string> };
	status?: string;
	summary?: string;
	description?: string;
	start?: GoogleTime;
	end?: GoogleTime;
	recurrence?: string[];
	recurringEventId?: string;
	originalStartTime?: GoogleTime;
	updated?: string;
	etag?: string;
}

function time(iso: string, allDay: boolean, tz: string): GoogleTime {
	if (allDay) return { date: new Date(iso).toISOString().slice(0, 10) };
	return { dateTime: new Date(iso).toISOString(), timeZone: tz };
}

/**
 * The END of an all-day event, which Google treats as EXCLUSIVE.
 *
 * A one-day event on the 1st ends on the 2nd. Sending the same date for both is
 * a zero-length range and Google refuses it with a bare 400 — and since every
 * event the ledger generates is all-day, it refused every single one.
 */
function endTime(iso: string, allDay: boolean, tz: string): GoogleTime {
	if (!allDay) return time(iso, allDay, tz);
	const day = new Date(iso);
	day.setUTCDate(day.getUTCDate() + 1);
	return { date: day.toISOString().slice(0, 10) };
}

/** Undo the exclusive end, so a round trip does not shorten the event daily. */
function readEndTime(value: GoogleTime | undefined, allDay: boolean): string | null {
	const read = readTime(value);
	if (!read || !allDay) return read;
	const day = new Date(read);
	day.setUTCDate(day.getUTCDate() - 1);
	// End of that day, matching how an all-day event is held internally.
	return new Date(`${day.toISOString().slice(0, 10)}T23:59:59.000Z`).toISOString();
}

function readTime(value: GoogleTime | undefined): string | null {
	if (!value) return null;
	if (value.date) return new Date(`${value.date}T00:00:00.000Z`).toISOString();
	return value.dateTime ? new Date(value.dateTime).toISOString() : null;
}

/**
 * A series as Google resources: the master, then one per exception.
 *
 * Every override carries `recurringEventId` pointing at the master and
 * `originalStartTime` saying WHICH occurrence it replaces. originalStartTime is
 * where the occurrence was, never where it moved to — send the new time and
 * Google creates a second event instead of moving the existing one.
 */
export function toGoogleEvents(series: EventSeries, remoteId: string): GoogleEvent[] {
	const master: GoogleEvent = {
		id: remoteId,
		// Our uid rides in extendedProperties, NOT iCalUID: that field is writable
		// on events.import but read-only on events.insert, and sending it there is
		// another way to earn a 400. Google's `id` is the resource address; our uid
		// is what the engine keys on, and the two are deliberately different.
		extendedProperties: { private: { continuumUid: series.uid } },
		summary: series.title,
		description: series.notes ?? undefined,
		start: time(series.startsAt, series.allDay, series.tz),
		end: endTime(series.endsAt, series.allDay, series.tz),
		recurrence: series.rrule ? [`RRULE:${series.rrule}`] : undefined,
		status: 'confirmed'
	};

	const overrides = series.exceptions.map((exception): GoogleEvent => {
		const startsAt = exception.startsAt ?? exception.recurrenceId;
		const endsAt = exception.endsAt ?? startsAt;
		return {
			// Google assigns override ids itself on the server, but a deterministic
			// one keeps a re-push idempotent rather than piling up duplicates.
			//
			// Built by overrideRemoteId, which stays inside base32hex and keys on the
			// RECURRENCE-ID. The old `${remoteId}_${index}` failed both ways: `_` is
			// outside the alphabet Google requires, so every override was refused
			// with a bare 400 and no recurring event with an exception ever reached
			// Google at all; and indexing by position meant deleting the first of
			// three overrides renamed the other two, leaving duplicates behind at the
			// times they used to name.
			id: overrideRemoteId(remoteId, exception.recurrenceId),
			extendedProperties: { private: { continuumUid: series.uid } },
			recurringEventId: remoteId,
			originalStartTime: time(exception.recurrenceId, series.allDay, series.tz),
			summary: exception.title ?? series.title,
			description: exception.notes ?? series.notes ?? undefined,
			start: time(startsAt, series.allDay, series.tz),
			end: endTime(endsAt, series.allDay, series.tz),
			status: exception.cancelled ? 'cancelled' : 'confirmed'
		};
	});

	return [master, ...overrides];
}

/** Fold a master and its overrides back into one series. */
export function fromGoogleEvents(events: GoogleEvent[]): EventSeries | null {
	const master = events.find((event) => !event.recurringEventId);
	if (!master) return null;

	const start = readTime(master.start);
	if (!start) return null;
	const allDay = Boolean(master.start?.date);

	const exceptions: SeriesException[] = events
		.filter((event) => event.recurringEventId)
		.map((event) => ({
			recurrenceId: readTime(event.originalStartTime) ?? '',
			cancelled: event.status === 'cancelled',
			title: event.summary ?? null,
			startsAt: readTime(event.start),
			endsAt: readEndTime(event.end, Boolean(event.start?.date)),
			notes: event.description ?? null
		}))
		.filter((exception) => exception.recurrenceId);

	return {
		// Ours first; iCalUID second for an event Google or another client made.
		uid: master.extendedProperties?.private?.continuumUid ?? master.iCalUID ?? master.id,
		title: master.summary ?? '',
		notes: master.description ?? null,
		category: null,
		allDay,
		startsAt: start,
		endsAt: readEndTime(master.end, allDay) ?? start,
		tz: master.start?.timeZone ?? 'UTC',
		rrule: master.recurrence?.[0]?.replace(/^RRULE:/, '') ?? null,
		exceptions,
		updatedAt: master.updated ?? new Date(0).toISOString()
	};
}

export function makeGoogleProvider(raw: Record<string, string>): CalendarProvider {
	const clientId = raw.clientId ?? '';
	const clientSecret = raw.clientSecret ?? '';
	const refreshToken = raw.refreshToken ?? '';
	const calendarId = raw.calendarUrl || 'primary';

	let accessToken: string | null = null;
	let expiresAt = 0;
	// One full listing per pass at most. A provider instance is built per sync
	// pass, so this cache lives and dies with it and never goes stale.
	let fullListCache: GoogleEvent[] | null = null;

	async function token(): Promise<string> {
		if (accessToken && Date.now() < expiresAt - 30_000) return accessToken;

		const response = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				refresh_token: refreshToken,
				grant_type: 'refresh_token'
			}).toString(),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});

		const payload = (await response.json()) as {
			access_token?: string;
			expires_in?: number;
			error?: string;
		};

		// invalid_grant means revoked or expired. Nothing about retrying fixes it,
		// and a retry loop against Google's token endpoint gets the account
		// rate-limited on top of being broken.
		if (payload.error === 'invalid_grant') {
			throw new Error('Google refused the saved authorisation — reconnect the account.');
		}
		if (!response.ok || !payload.access_token) {
			throw new Error(`Google token exchange failed (${response.status}).`);
		}

		accessToken = payload.access_token;
		expiresAt = Date.now() + (payload.expires_in ?? 3600) * 1000;
		return accessToken;
	}

	async function api(
		path: string,
		init: { method?: string; body?: unknown; query?: Record<string, string> } = {}
	): Promise<{ status: number; body: Record<string, unknown> }> {
		const url = new URL(`${API}${path}`);
		for (const [key, value] of Object.entries(init.query ?? {})) {
			if (value) url.searchParams.set(key, value);
		}
		const response = await fetch(url, {
			method: init.method ?? 'GET',
			headers: {
				Authorization: `Bearer ${await token()}`,
				'Content-Type': 'application/json'
			},
			body: init.body ? JSON.stringify(init.body) : undefined,
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		const text = await response.text();
		return {
			status: response.status,
			body: text ? (JSON.parse(text) as Record<string, unknown>) : {}
		};
	}

	/**
	 * Group a flat list of resources by the series each belongs to.
	 *
	 * `complete` says whether the list is the WHOLE truth — a full listing — or
	 * an incremental page carrying only what changed. That distinction is the
	 * one this function used to get wrong, and it cost data both ways.
	 *
	 * An incremental page holds only changed resources, so retitling the master
	 * of a recurring event yields a group of exactly one: the series is rebuilt
	 * with `exceptions: []`, and applyRemote replaces the exception set with
	 * that, destroying every cancelled and moved occurrence the series had.
	 * Change only an override and the group has no master at all, so
	 * fromGoogleEvents returns null, the change is silently dropped — and the
	 * syncToken still advances past it, so the move is never learned. Neither
	 * was recoverable without a 410.
	 */
	async function groupChanges(items: GoogleEvent[], complete: boolean): Promise<RemoteChange[]> {
		const bySeries = new Map<string, GoogleEvent[]>();
		for (const item of items) {
			const key = item.recurringEventId ?? item.id;
			bySeries.set(key, [...(bySeries.get(key) ?? []), item]);
		}

		const changes: RemoteChange[] = [];
		for (const [masterId, page] of bySeries) {
			let group = page;

			if (!complete && mayBeIncomplete(page)) {
				// Re-read the series whole. Costs one full listing per pass, cached,
				// and only when a recurring event actually changed.
				const whole = await seriesResources(masterId);
				if (whole.length > 0) group = whole;
			}

			const master = group.find((event) => !event.recurringEventId);
			// A cancelled MASTER is a deleted event. A cancelled override is only a
			// removed occurrence, and belongs inside the series rather than as a
			// deletion of the whole thing.
			if (master && master.status === 'cancelled') {
				changes.push({
					uid: master.extendedProperties?.private?.continuumUid ?? master.iCalUID ?? master.id,
					remoteId: master.id,
					series: null,
					etag: null
				});
				continue;
			}
			const series = fromGoogleEvents(group);
			if (series) {
				changes.push({
					uid: series.uid,
					remoteId: master?.id ?? masterId,
					series,
					etag: master?.etag ?? null
				});
			}
		}
		return changes;
	}

	/**
	 * Whether a page's view of a series might be missing resources.
	 *
	 * A single non-recurring event that came back on its own is complete. A group
	 * with no master, or one whose master carries a recurrence rule, may have
	 * overrides that simply did not change this time and so were not sent.
	 */
	function mayBeIncomplete(page: GoogleEvent[]): boolean {
		const master = page.find((event) => !event.recurringEventId);
		if (!master) return true;
		return Boolean(master.recurrence?.length) || page.length > 1;
	}

	return {
		id: 'google',
		label: 'Google Calendar',

		async probe() {
			try {
				const result = await api('/users/me/calendarList', { query: { maxResults: '1' } });
				if (result.status === 401)
					return { ok: false, detail: 'Google rejected the authorisation.' };
				if (result.status >= 400) return { ok: false, detail: `Google answered ${result.status}.` };
				return { ok: true, detail: 'Connected.' };
			} catch (error) {
				return { ok: false, detail: error instanceof Error ? error.message : 'Could not connect.' };
			}
		},

		async listCalendars(): Promise<RemoteCalendar[]> {
			interface Entry {
				id: string;
				summary?: string;
				/** What the person renamed it to in their own list, if anything. */
				summaryOverride?: string;
				primary?: boolean;
				deleted?: boolean;
				accessRole?: string;
			}

			const entries: Entry[] = [];
			let pageToken: string | undefined;

			for (;;) {
				const result = await api('/users/me/calendarList', {
					query: {
						// Calendars the person has hidden in Google's own sidebar are
						// omitted by default — and hiding one there is exactly what
						// somebody does with a calendar kept for an app.
						showHidden: 'true',
						showDeleted: 'false',
						maxResults: '250',
						...(pageToken ? { pageToken } : {})
					}
				});
				if (result.status === 403) {
					// Expected under calendar.app.created: the account's calendar list
					// is not something this scope may read. There is nothing to choose
					// from, which is why the provider creates its own instead.
					return [];
				}
				if (result.status >= 400) {
					throw new Error(`Google answered ${result.status} listing calendars.`);
				}
				entries.push(...((result.body.items ?? []) as Entry[]));
				pageToken = result.body.nextPageToken as string | undefined;
				if (!pageToken) break;
			}

			return (
				entries
					.filter((entry) => !entry.deleted)
					// Under calendar.app.created this list already contains only what
					// Continuum made. The filter stays as a second line: a scope change
					// would otherwise silently start offering calendars it cannot write.
					.filter((entry) => entry.accessRole === 'owner' || entry.accessRole === 'writer')
					// Primary last: the point of choosing is usually to keep household
					// events OUT of the personal calendar, so it should not be the
					// default the dropdown lands on.
					.sort((a, b) => Number(a.primary ?? false) - Number(b.primary ?? false))
					.map((entry) => ({
						id: entry.id,
						// summaryOverride is what the person actually sees in Google.
						name: entry.summaryOverride ?? entry.summary ?? entry.id
					}))
			);
		},

		/**
		 * Create the calendar Continuum writes to.
		 *
		 * Deliberately does NOT list first. Under `calendar.app.created` the
		 * calendarList endpoint answers 403 — the scope grants creating a calendar
		 * and managing events on it, and nothing that would let an app enumerate
		 * what else the account has. Listing first is what made this fail at step
		 * one and left the button looking dead.
		 *
		 * Not creating a duplicate is therefore the CALLER's job: the account row
		 * already records which calendar was made, so this is only ever called
		 * when that is empty.
		 */
		async ensureCalendar(): Promise<RemoteCalendar | null> {
			const created = await api('/calendars', {
				method: 'POST',
				body: {
					summary: 'Continuum',
					description:
						'Household events from Continuum. Safe to hide or unsubscribe — nothing else writes here.'
				}
			});
			if (created.status >= 400) {
				throw new Error(`Google answered ${created.status} creating a calendar.`);
			}
			const id = created.body.id as string | undefined;
			if (!id) throw new Error('Google created a calendar but did not name it.');
			return { id, name: (created.body.summary as string) ?? 'Continuum' };
		},

		async pull(cursor: string | null): Promise<PullResult> {
			const collected: GoogleEvent[] = [];
			let pageToken: string | undefined;
			const syncToken = cursor ?? undefined;

			for (;;) {
				const result = await api(`/calendars/${encodeURIComponent(calendarId)}/events`, {
					query: {
						...(syncToken ? { syncToken } : { timeMin: resetWindowStart() }),
						...(pageToken ? { pageToken } : {}),
						showDeleted: 'true',
						singleEvents: 'false',
						maxResults: '250'
					}
				});

				// 410 Gone: the syncToken is too old. Not an error — it means start
				// over, and treating it as a failure stalls sync permanently.
				//
				// resetFrom is what keeps starting over from being destructive: the
				// listing reaches back ninety days, so it says nothing about anything
				// older, and the engine must not read that silence as deletion.
				if (result.status === 410) {
					return {
						changes: await groupChanges(await fullList(), true),
						cursor: null,
						reset: true,
						resetFrom: resetWindowStart()
					};
				}
				if (result.status >= 400) {
					throw new Error(`Google answered ${result.status} listing events.`);
				}

				collected.push(...((result.body.items ?? []) as GoogleEvent[]));
				pageToken = result.body.nextPageToken as string | undefined;
				if (!pageToken) {
					return {
						// A pull with no syncToken already listed everything in the window,
						// so its groups are whole and no re-read is needed.
						changes: await groupChanges(collected, !syncToken),
						cursor: (result.body.nextSyncToken as string) ?? cursor,
						reset: false
					};
				}
			}
		},

		async push(ops: PushOp[]): Promise<PushResult[]> {
			const results: PushResult[] = [];

			for (const op of ops) {
				try {
					if (op.kind === 'delete') {
						const result = await api(
							`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(op.remoteId)}`,
							{ method: 'DELETE' }
						);
						if (result.status === 412) {
							results.push({
								ok: false,
								remoteId: op.remoteId,
								conflict: true,
								message: 'Changed in Google since we last read it.'
							});
						} else if (result.status < 300 || result.status === 404 || result.status === 410) {
							// 404/410 both mean it is already gone, which is the outcome asked
							// for rather than a failure.
							results.push({ ok: true, remoteId: op.remoteId, etag: null });
						} else {
							// Anything else — 401, 403, 429, 500 — is a real failure. Calling
							// it success orphaned the event in Google, cleared the account's
							// error line, and made sure nothing ever tried again.
							results.push({
								ok: false,
								remoteId: op.remoteId,
								conflict: false,
								message: `Google answered ${result.status} deleting an event.`
							});
						}
						continue;
					}

					// The fan-out. The master goes first so an override never arrives
					// before the event it belongs to.
					const events = toGoogleEvents(op.series, op.remoteId);
					let etag: string | null = null;
					let conflicted = false;

					for (const event of events) {
						const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`;
						// PUT is an upsert when we supply the id, so a create and an update
						// are the same call and a re-push is idempotent.
						const result = await api(path, { method: 'PUT', body: event });

						if (result.status === 412) {
							conflicted = true;
							break;
						}
						if (result.status === 404) {
							const created = await api(`/calendars/${encodeURIComponent(calendarId)}/events`, {
								method: 'POST',
								body: event
							});
							if (created.status >= 400) {
								throw new Error(`Google answered ${created.status} creating an event.`);
							}
							etag = (created.body.etag as string) ?? etag;
							continue;
						}
						if (result.status >= 400) {
							throw new Error(`Google answered ${result.status} writing an event.`);
						}
						if (!event.recurringEventId) etag = (result.body.etag as string) ?? etag;
					}

					results.push(
						conflicted
							? {
									ok: false,
									remoteId: op.remoteId,
									conflict: true,
									message: 'Changed in Google since we last read it.'
								}
							: { ok: true, remoteId: op.remoteId, etag }
					);
				} catch (error) {
					results.push({
						ok: false,
						remoteId: op.remoteId,
						conflict: false,
						message: error instanceof Error ? error.message : 'Request failed.'
					});
				}
			}
			return results;
		}
	};

	/**
	 * Everything in the window, for when the syncToken is no good.
	 *
	 * THROWS on a bad page rather than returning what it had collected. Its result
	 * is handed to the engine with `reset` set, and under reset an absent event is
	 * a deleted one — so answering a 500 on page two with "here are the first 250,
	 * and by the way the rest are gone" deletes everything after page one.
	 */
	async function fullList(): Promise<GoogleEvent[]> {
		if (fullListCache) return fullListCache;

		const collected: GoogleEvent[] = [];
		let pageToken: string | undefined;
		for (;;) {
			const result = await api(`/calendars/${encodeURIComponent(calendarId)}/events`, {
				query: {
					timeMin: resetWindowStart(),
					showDeleted: 'true',
					singleEvents: 'false',
					maxResults: '250',
					...(pageToken ? { pageToken } : {})
				}
			});
			if (result.status >= 400) {
				throw new Error(`Google answered ${result.status} reconciling the calendar.`);
			}
			collected.push(...((result.body.items ?? []) as GoogleEvent[]));
			pageToken = result.body.nextPageToken as string | undefined;
			if (!pageToken) break;
		}

		fullListCache = collected;
		return collected;
	}

	/**
	 * Every resource belonging to one series: the master and all its overrides.
	 *
	 * Read out of a single full listing, cached for the pass. Google's events.list
	 * is the only view that shows overrides as their own resources alongside the
	 * master — events.instances expands the rule instead, and cannot tell a
	 * modified occurrence from an ordinary one — so this is what makes a series
	 * whole again after an incremental page delivered a piece of it.
	 */
	async function seriesResources(masterId: string): Promise<GoogleEvent[]> {
		const all = await fullList();
		return all.filter((event) => (event.recurringEventId ?? event.id) === masterId);
	}
}

registerCalendarProvider(
	'google',
	'Google Calendar',
	makeGoogleProvider,
	// No refresh-token field: it comes from the redirect flow and is never pasted.
	// Asking for one would mean fetching it from somewhere else first, which is
	// exactly the step the authorisation exists to remove.
	[
		{ key: 'clientId', label: 'OAuth client ID', required: true },
		{
			key: 'clientSecret',
			label: 'OAuth client secret',
			required: true,
			secret: true,
			kind: 'password'
		}
	],
	'Set the OAuth consent screen to "In production" before connecting — left in Testing, Google expires the refresh token after 7 days and sync stops every week. Publishing does not require verification. The API itself is free. See docs/google-calendar-setup.md.',
	true
);
