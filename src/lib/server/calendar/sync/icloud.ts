// CalDAV, as spoken by iCloud — and by Fastmail, Nextcloud and Radicale, which
// is a large part of why this provider comes first.
//
// Setup is one app-specific password pasted into a form: no OAuth consent
// screen, no Cloud project, no verification, no refresh token that quietly
// expires. That is not a small thing for self-hosting, and it is why the sync
// engine is proven against this adapter before Google's.
//
// The transport is deliberately thin. Everything fiddly about the format lives
// in ical.ts, where it is tested without a server.

import {
	registerCalendarProvider,
	type CalendarProvider,
	type PullResult,
	type PushOp,
	type PushResult,
	type RemoteCalendar,
	type RemoteChange
} from '$lib/server/calendar/sync/provider';
import { parseIcs, toIcs } from '$lib/server/calendar/sync/ical';
import { mapPool, PUSH_CONCURRENCY } from '$lib/server/calendar/sync/pool';

const DEFAULT_HOST = 'https://caldav.icloud.com';
const TIMEOUT_MS = 20_000;

interface CalDavConfig {
	/** Apple ID, or the username for another CalDAV server. */
	username: string;
	/** App-specific password. Never a real account password. */
	password: string;
	/** Override for a non-iCloud server. */
	host?: string;
	/** The calendar collection, once chosen. */
	calendarUrl?: string;
}

function authHeader(config: CalDavConfig): string {
	return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
}

async function request(
	config: CalDavConfig,
	url: string,
	init: { method: string; body?: string; headers?: Record<string, string> }
): Promise<{ status: number; text: string; headers: Headers }> {
	const response = await fetch(url, {
		method: init.method,
		headers: {
			Authorization: authHeader(config),
			'Content-Type': init.body?.startsWith('BEGIN:VCALENDAR')
				? 'text/calendar; charset=utf-8'
				: 'application/xml; charset=utf-8',
			...init.headers
		},
		body: init.body,
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	return { status: response.status, text: await response.text(), headers: response.headers };
}

/** Values of one XML element, without pulling in a parser for four tag names. */
function xmlValues(xml: string, tag: string): string[] {
	const pattern = new RegExp(`<[^>]*\\b${tag}\\b[^>]*>([\\s\\S]*?)</[^>]*\\b${tag}\\b>`, 'gi');
	return [...xml.matchAll(pattern)].map((m) => m[1].trim());
}

/** `<response>` blocks, each covering one resource. */
function xmlResponses(xml: string): string[] {
	return xmlValues(xml, 'response');
}

/**
 * The href INSIDE a named element, rather than the first href in the document.
 *
 * This distinction is the whole discovery flow. A PROPFIND response opens with
 * an `<href>` naming the resource that was asked about, and only then carries
 * the property that was requested — which contains its own `<href>`:
 *
 *   <response>
 *     <href>/123/principal/</href>              ← the resource asked about
 *     <propstat><prop><calendar-home-set>
 *       <href>/123/calendars/</href>            ← the answer
 *     </calendar-home-set></prop></propstat>
 *   </response>
 *
 * Taking the first href gets the question back instead of the answer, and the
 * next request then walks the wrong collection and finds no calendars at all.
 */
function hrefWithin(xml: string, element: string): string | null {
	const inner = xmlValues(xml, element)[0];
	if (inner === undefined) return null;
	return xmlValues(inner, 'href')[0] ?? null;
}

function decodeEntities(value: string): string {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

export function makeCalDavProvider(raw: Record<string, string>): CalendarProvider {
	const config: CalDavConfig = {
		username: raw.username ?? '',
		password: raw.password ?? '',
		host: raw.host || DEFAULT_HOST,
		calendarUrl: raw.calendarUrl || undefined
	};

	const base = (config.host ?? DEFAULT_HOST).replace(/\/$/, '');
	const absolute = (href: string) => (href.startsWith('http') ? href : `${base}${href}`);

	async function principalUrl(): Promise<string> {
		const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
		const result = await request(config, `${base}/`, {
			method: 'PROPFIND',
			body,
			headers: { Depth: '0' }
		});
		// From inside <current-user-principal>, not the first href in the document —
		// that one is the resource we asked about, which is where we already are.
		const href = hrefWithin(result.text, 'current-user-principal');
		if (!href) throw new Error('CalDAV: the server did not name a principal.');
		return absolute(decodeEntities(href));
	}

	async function calendarHome(): Promise<string> {
		const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
		const result = await request(config, await principalUrl(), {
			method: 'PROPFIND',
			body,
			headers: { Depth: '0' }
		});
		const href = hrefWithin(result.text, 'calendar-home-set');
		if (!href) throw new Error('CalDAV: the server did not name a calendar home.');
		return absolute(decodeEntities(href));
	}

	function requireCalendar(): string {
		if (!config.calendarUrl) throw new Error('CalDAV: no calendar has been chosen yet.');
		return absolute(config.calendarUrl);
	}

	return {
		id: 'icloud',
		label: 'iCloud / CalDAV',

		async probe() {
			try {
				const result = await request(config, `${base}/`, {
					method: 'PROPFIND',
					body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
					headers: { Depth: '0' }
				});
				if (result.status === 401) {
					return {
						ok: false,
						detail: 'Rejected. This needs an app-specific password, not the account password.'
					};
				}
				if (result.status >= 400) return { ok: false, detail: `Server answered ${result.status}.` };
				return { ok: true, detail: 'Connected.' };
			} catch (error) {
				return { ok: false, detail: error instanceof Error ? error.message : 'Could not connect.' };
			}
		},

		async listCalendars(): Promise<RemoteCalendar[]> {
			const home = await calendarHome();
			const body = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>`;
			const result = await request(config, home, {
				method: 'PROPFIND',
				body,
				headers: { Depth: '1' }
			});

			return (
				xmlResponses(result.text)
					// Only collections that hold events: a CalDAV home also contains
					// address books and task lists, and writing an event into one is a
					// confusing failure rather than a clean one.
					.filter((block) => /VEVENT/i.test(block) && /calendar/i.test(block))
					.map((block) => ({
						id: decodeEntities(xmlValues(block, 'href')[0] ?? ''),
						name: decodeEntities(xmlValues(block, 'displayname')[0] ?? 'Calendar')
					}))
					.filter((calendar) => calendar.id)
			);
		},

		async pull(cursor: string | null): Promise<PullResult> {
			const calendar = requireCalendar();

			// RFC 6578 incremental sync. A server that does not support it, or one
			// that has invalidated the token, answers with an error — and both mean
			// the same thing to the engine: the cursor is worthless, reconcile fully.
			const body = `<?xml version="1.0"?>
<d:sync-collection xmlns:d="DAV:">
	<d:sync-token>${cursor ?? ''}</d:sync-token>
	<d:sync-level>1</d:sync-level>
	<d:prop><d:getetag/></d:prop>
</d:sync-collection>`;
			const result = await request(config, calendar, {
				method: 'REPORT',
				body,
				headers: { Depth: '1' }
			});

			// 507 is "sync-token too old"; 400/403 cover a token this server no
			// longer recognises and a server with no sync-collection support at all.
			const invalid = result.status === 507 || result.status === 400 || result.status === 403;
			if (invalid || result.status >= 500) {
				// The reconcile covers the whole collection, so absence in it genuinely
				// does mean deleted — hence no resetFrom. It THROWS rather than
				// returning what it managed to read, which is the point: an empty list
				// with reset set is the engine being told the server holds nothing.
				return { changes: await fullReconcile(), cursor: null, reset: true, resetFrom: null };
			}

			const token = xmlValues(result.text, 'sync-token')[0] ?? cursor;
			const changes: RemoteChange[] = [];

			for (const block of xmlResponses(result.text)) {
				const href = decodeEntities(xmlValues(block, 'href')[0] ?? '');
				if (!href) continue;

				// A 404 inside a multistatus is how a deletion is reported. All that
				// survives is the path, so the RESOURCE NAME is reported and the uid is
				// left empty — reporting the resource name as though it were the uid is
				// what made every deletion made on a phone match nothing local and get
				// dropped while the cursor advanced past it.
				if (/HTTP\/1\.[01] 404/i.test(block)) {
					changes.push({ uid: '', remoteId: uidFromHref(href), series: null, etag: null });
					continue;
				}

				const fetched = await request(config, absolute(href), { method: 'GET' });

				// THROWS rather than skipping, matching fullReconcile. The status was
				// not read at all, so a 503 or a rate-limited GET produced an error
				// document, parseIcs returned null, the resource was quietly skipped —
				// and the pass then COMMITTED the new sync-token, so that change was
				// never listed again. One transient failure left the local copy
				// permanently divergent with nothing recorded anywhere.
				//
				// 404 and 410 are the exception: the resource went between the REPORT
				// and this GET, which is a deletion and is reported as one.
				if (fetched.status === 404 || fetched.status === 410) {
					changes.push({ uid: '', remoteId: uidFromHref(href), series: null, etag: null });
					continue;
				}
				if (fetched.status >= 400) {
					throw new Error(`Server answered ${fetched.status} reading ${href}.`);
				}

				const series = parseIcs(fetched.text);
				if (!series) continue;
				changes.push({
					uid: series.uid,
					remoteId: uidFromHref(href),
					series,
					etag: fetched.headers.get('etag') ?? xmlValues(block, 'getetag')[0] ?? null
				});
			}

			return { changes, cursor: token, reset: false };
		},

		async push(ops: PushOp[]): Promise<PushResult[]> {
			const calendar = requireCalendar();

			// A few at a time, in input order. The engine pairs each result with the
			// op at the same index, so the order is load-bearing — see pool.ts.
			return mapPool(ops, PUSH_CONCURRENCY, async (op): Promise<PushResult> => {
				const url = `${calendar.replace(/\/$/, '')}/${encodeURIComponent(op.remoteId)}.ics`;
				try {
					if (op.kind === 'delete') {
						const result = await request(config, url, {
							method: 'DELETE',
							headers: op.etag ? { 'If-Match': op.etag } : {}
						});
						if (result.status === 412) {
							return {
								ok: false,
								remoteId: op.remoteId,
								conflict: true,
								message: 'Changed on the server since we last read it.'
							};
						}
						if (result.status < 300 || result.status === 404 || result.status === 410) {
							// 404 and 410 mean it is already gone, which is the outcome that
							// was asked for rather than a failure.
							return { ok: true, remoteId: op.remoteId, etag: null };
						}
						// Everything else — 401, 403, 429, 500 — is a REAL failure, and
						// calling it success orphaned the remote event, cleared the
						// account's error line and never retried.
						return {
							ok: false,
							remoteId: op.remoteId,
							conflict: false,
							message: `Server answered ${result.status} deleting an event.`
						};
					}

					const result = await request(config, url, {
						method: 'PUT',
						body: toIcs(op.series),
						// If-Match guards an update; If-None-Match:* guards a create, so
						// two passes racing cannot both create the same resource.
						headers: op.etag ? { 'If-Match': op.etag } : { 'If-None-Match': '*' }
					});

					if (result.status === 412) {
						// On a create this means "already there", which is not an error —
						// the next pull will reconcile it. On an update it is a genuine
						// concurrent write.
						return {
							ok: false,
							remoteId: op.remoteId,
							conflict: true,
							message: op.etag ? 'Changed on the server since we last read it.' : 'Already exists.'
						};
					}
					if (result.status >= 400) {
						return {
							ok: false,
							remoteId: op.remoteId,
							conflict: false,
							message: `Server answered ${result.status}.`
						};
					}
					return {
						ok: true,
						remoteId: op.remoteId,
						etag: result.headers.get('etag')
					};
				} catch (error) {
					return {
						ok: false,
						remoteId: op.remoteId,
						conflict: false,
						message: error instanceof Error ? error.message : 'Request failed.'
					};
				}
			});
		}
	};

	/**
	 * Everything in the collection, for when the cursor is no good.
	 *
	 * THROWS on a bad answer rather than returning what it managed to read. Its
	 * result is handed to the engine with `reset` set, and under reset an absent
	 * event means a deleted one — so an empty list from a transient 503 is the
	 * engine being told, with authority, that the server holds nothing at all.
	 * That deleted every authored event and suppressed every generated one, and
	 * the household's ledger events stopped being published for good. The old
	 * code issued this REPORT and iterated the response without ever looking at
	 * its status.
	 */
	async function fullReconcile(): Promise<RemoteChange[]> {
		const calendar = requireCalendar();
		const body = `<?xml version="1.0"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:prop><d:getetag/><c:calendar-data/></d:prop>
	<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter>
</c:calendar-query>`;
		const result = await request(config, calendar, {
			method: 'REPORT',
			body,
			headers: { Depth: '1' }
		});

		if (result.status >= 400) {
			throw new Error(`CalDAV answered ${result.status} reconciling the calendar.`);
		}
		// A 207 carrying no <response> at all is not "the calendar is empty" — an
		// empty collection still answers with a multistatus naming itself. It is an
		// error document, or a body this parser did not understand.
		if (!/<[^>]*\bmultistatus\b/i.test(result.text)) {
			throw new Error('CalDAV answered the reconcile with something that was not a multistatus.');
		}

		const changes: RemoteChange[] = [];
		for (const block of xmlResponses(result.text)) {
			const data = xmlValues(block, 'calendar-data')[0];
			if (!data) continue;
			const series = parseIcs(decodeEntities(data));
			if (!series) continue;
			changes.push({
				uid: series.uid,
				remoteId: uidFromHref(decodeEntities(xmlValues(block, 'href')[0] ?? '')),
				series,
				etag: xmlValues(block, 'getetag')[0] ?? null
			});
		}
		return changes;
	}
}

/** The resource name, which is how we addressed it — see keys.ts. */
function uidFromHref(href: string): string {
	const last = href.split('/').filter(Boolean).pop() ?? '';
	return decodeURIComponent(last.replace(/\.ics$/i, ''));
}

registerCalendarProvider(
	'icloud',
	'iCloud / CalDAV',
	makeCalDavProvider,
	[
		{ key: 'username', label: 'Apple ID', placeholder: 'you@icloud.com', required: true },
		{
			key: 'password',
			label: 'App-specific password',
			required: true,
			secret: true,
			kind: 'password'
		},
		{ key: 'host', label: 'Server', placeholder: DEFAULT_HOST, kind: 'url' }
	],
	'Generate an app-specific password at appleid.apple.com — your normal password will not work. Leave the server blank for iCloud, or point it at Fastmail, Nextcloud or Radicale.'
);
