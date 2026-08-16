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

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 20_000;

export interface GoogleTime {
	date?: string;
	dateTime?: string;
	timeZone?: string;
}

export interface GoogleEvent {
	id: string;
	iCalUID?: string;
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
		// iCalUID carries OUR uid, which is what the engine keys on. Google's `id`
		// is the resource address; the two are deliberately different things.
		iCalUID: series.uid,
		summary: series.title,
		description: series.notes ?? undefined,
		start: time(series.startsAt, series.allDay, series.tz),
		end: time(series.endsAt, series.allDay, series.tz),
		recurrence: series.rrule ? [`RRULE:${series.rrule}`] : undefined,
		status: 'confirmed'
	};

	const overrides = series.exceptions.map((exception, index): GoogleEvent => {
		const startsAt = exception.startsAt ?? exception.recurrenceId;
		const endsAt = exception.endsAt ?? startsAt;
		return {
			// Google assigns override ids itself on the server, but a deterministic
			// one keeps a re-push idempotent rather than piling up duplicates.
			id: `${remoteId}_${index}`,
			iCalUID: series.uid,
			recurringEventId: remoteId,
			originalStartTime: time(exception.recurrenceId, series.allDay, series.tz),
			summary: exception.title ?? series.title,
			description: exception.notes ?? series.notes ?? undefined,
			start: time(startsAt, series.allDay, series.tz),
			end: time(endsAt, series.allDay, series.tz),
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
			endsAt: readTime(event.end),
			notes: event.description ?? null
		}))
		.filter((exception) => exception.recurrenceId);

	return {
		uid: master.iCalUID ?? master.id,
		title: master.summary ?? '',
		notes: master.description ?? null,
		category: null,
		allDay,
		startsAt: start,
		endsAt: readTime(master.end) ?? start,
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

	/** Group a flat list of resources by the series each belongs to. */
	function groupChanges(items: GoogleEvent[]): RemoteChange[] {
		const bySeries = new Map<string, GoogleEvent[]>();
		for (const item of items) {
			const key = item.recurringEventId ?? item.id;
			bySeries.set(key, [...(bySeries.get(key) ?? []), item]);
		}

		const changes: RemoteChange[] = [];
		for (const group of bySeries.values()) {
			const master = group.find((event) => !event.recurringEventId);
			// A cancelled MASTER is a deleted event. A cancelled override is only a
			// removed occurrence, and belongs inside the series rather than as a
			// deletion of the whole thing.
			if (master && master.status === 'cancelled') {
				changes.push({ uid: master.iCalUID ?? master.id, series: null, etag: null });
				continue;
			}
			const series = fromGoogleEvents(group);
			if (series) changes.push({ uid: series.uid, series, etag: master?.etag ?? null });
		}
		return changes;
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
			const result = await api('/users/me/calendarList');
			const items = (result.body.items ?? []) as Array<{ id: string; summary?: string }>;
			return items.map((item) => ({ id: item.id, name: item.summary ?? item.id }));
		},

		async pull(cursor: string | null): Promise<PullResult> {
			const collected: GoogleEvent[] = [];
			let pageToken: string | undefined;
			const syncToken = cursor ?? undefined;

			for (;;) {
				const result = await api(`/calendars/${encodeURIComponent(calendarId)}/events`, {
					query: {
						...(syncToken
							? { syncToken }
							: { timeMin: new Date(Date.now() - 90 * 86_400_000).toISOString() }),
						...(pageToken ? { pageToken } : {}),
						showDeleted: 'true',
						singleEvents: 'false',
						maxResults: '250'
					}
				});

				// 410 Gone: the syncToken is too old. Not an error — it means start
				// over, and treating it as a failure stalls sync permanently.
				if (result.status === 410) {
					return { changes: await fullList(), cursor: null, reset: true };
				}
				if (result.status >= 400) {
					throw new Error(`Google answered ${result.status} listing events.`);
				}

				collected.push(...((result.body.items ?? []) as GoogleEvent[]));
				pageToken = result.body.nextPageToken as string | undefined;
				if (!pageToken) {
					return {
						changes: groupChanges(collected),
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
						// 404/410 both mean it is already gone, which is the outcome asked
						// for rather than a failure.
						if (result.status === 412) {
							results.push({
								ok: false,
								remoteId: op.remoteId,
								conflict: true,
								message: 'Changed in Google since we last read it.'
							});
						} else {
							results.push({ ok: true, remoteId: op.remoteId, etag: null });
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

	/** Everything in the window, for when the syncToken is no good. */
	async function fullList(): Promise<RemoteChange[]> {
		const collected: GoogleEvent[] = [];
		let pageToken: string | undefined;
		for (;;) {
			const result = await api(`/calendars/${encodeURIComponent(calendarId)}/events`, {
				query: {
					timeMin: new Date(Date.now() - 90 * 86_400_000).toISOString(),
					singleEvents: 'false',
					maxResults: '250',
					...(pageToken ? { pageToken } : {})
				}
			});
			if (result.status >= 400) break;
			collected.push(...((result.body.items ?? []) as GoogleEvent[]));
			pageToken = result.body.nextPageToken as string | undefined;
			if (!pageToken) break;
		}
		return groupChanges(collected);
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
