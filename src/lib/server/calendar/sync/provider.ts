// The calendar sync seam.
//
// Modelled on HomeProvider (src/lib/server/home/provider.ts), including the
// self-describing field list, so the Settings connect form renders itself and no
// screen learns anything about Google or CalDAV.
//
// THE UNIT OF TRANSFER IS A WHOLE SERIES — an event plus every one of its
// exceptions, moved atomically. That is the decision everything else rests on,
// because it is the single thing the two providers disagree about:
//
//   - CalDAV keeps a recurring event and all its overrides in ONE resource: a
//     single .ics holding the master VEVENT plus one VEVENT per RECURRENCE-ID.
//   - Google gives every override its own event resource, tied back to the
//     parent by recurringEventId and originalStartTime.
//
// Sync individual occurrences and the engine has to understand both models. Make
// the unit "the series", and CalDAV maps one-to-one while Google's fan-out to
// N+1 resources becomes the Google adapter's private problem.

import type { EventSeries } from '$lib/server/calendar/series';

export interface RemoteCalendar {
	id: string;
	name: string;
}

export interface RemoteChange {
	/** Our own uid, which we chose — see keys.ts. Empty when the provider could
	 *  not know it, which is what a CalDAV deletion looks like: the resource is
	 *  gone, so there is no body left to read a UID out of. */
	uid: string;
	/**
	 * How the provider addresses this resource.
	 *
	 * Recorded so a later deletion, which arrives as nothing but a path, can be
	 * matched back to a local key — and so pushes go to the resource we actually
	 * pulled rather than to the name we would have chosen. Null when the provider
	 * does not name resources separately from their uid.
	 */
	remoteId?: string | null;
	/** The series as it now stands remotely, or null if it was deleted there. */
	series: EventSeries | null;
	etag: string | null;
}

export interface PullResult {
	changes: RemoteChange[];
	/** Opaque; hand it back unchanged on the next pull. */
	cursor: string | null;
	/**
	 * The cursor was rejected and the caller must fully reconcile.
	 *
	 * Three different provider events collapse into this one flag: Google
	 * answering 410 Gone on an expired syncToken, an invalidated CalDAV RFC 6578
	 * sync-token, and a server with no sync-collection support at all. Putting it
	 * in the return type is what stops it surfacing as an unhandled exception in
	 * a background job at three in the morning.
	 */
	reset: boolean;
	/**
	 * The earliest instant a `reset` listing actually covers, as ISO. Null means
	 * "everything the server holds".
	 *
	 * LOAD-BEARING. Under reset, an event's absence from the listing means it was
	 * deleted — that is the whole point of a full reconcile. But a provider that
	 * lists only the last ninety days is not saying anything at all about what
	 * came before, and reading its silence as deletion is how a year of authored
	 * events gets destroyed the first time Google expires a syncToken. The engine
	 * only lets absence mean deletion inside this window.
	 */
	resetFrom?: string | null;
}

export type PushOp =
	| { kind: 'upsert'; remoteId: string; series: EventSeries; etag: string | null }
	| { kind: 'delete'; remoteId: string; etag: string | null };

export type PushResult =
	| { ok: true; remoteId: string; etag: string | null }
	/** `conflict` means the etag did not match — someone changed it underneath us,
	 *  so the next pass must re-read rather than retry the same write. */
	| { ok: false; remoteId: string; conflict: boolean; message: string };

export interface CalendarProvider {
	id: string;
	label: string;
	/** Cheap connectivity check with a human-readable outcome. */
	probe(): Promise<{ ok: boolean; detail: string }>;
	listCalendars(): Promise<RemoteCalendar[]>;
	/**
	 * Make sure there is at least one calendar this app may write to.
	 *
	 * Optional, because it is only meaningful where the provider's permission
	 * model says an app may use only what it created. CalDAV has no such notion —
	 * the household's existing calendars are all available — so it does not
	 * implement this.
	 */
	ensureCalendar?(): Promise<RemoteCalendar | null>;
	pull(cursor: string | null): Promise<PullResult>;
	push(ops: PushOp[]): Promise<PushResult[]>;
}

/**
 * What a provider needs in order to be configured. The connect form renders
 * itself from this, so adding a provider never edits the Settings screen.
 */
export interface ProviderField {
	key: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	/** Render and store as a secret. */
	secret?: boolean;
	kind?: 'text' | 'url' | 'password';
}

type CalendarProviderFactory = (config: Record<string, string>) => CalendarProvider;

interface RegistryEntry {
	label: string;
	make: CalendarProviderFactory;
	fields: ProviderField[];
	/** One line of help under the form — where to find an app password, say. */
	hint: string;
	/**
	 * Whether connecting needs a redirect to the provider rather than pasted
	 * credentials. CalDAV takes an app password and is done; Google has to send
	 * the browser away and come back with a code. The Settings screen reads this
	 * to decide which button to draw, so neither flow is hard-coded there.
	 */
	oauth: boolean;
}

const registry = new Map<string, RegistryEntry>();

export function registerCalendarProvider(
	id: string,
	label: string,
	make: CalendarProviderFactory,
	fields: ProviderField[] = [],
	hint = '',
	oauth = false
): void {
	registry.set(id, { label, make, fields, hint, oauth });
}

interface CalendarProviderKind {
	id: string;
	label: string;
	fields: ProviderField[];
	hint: string;
	oauth: boolean;
	/** Whether this provider makes its own calendar rather than offering the
	 *  account's existing ones. Drives the button's wording. */
	createsOwnCalendar: boolean;
}

export function calendarProviderKinds(): CalendarProviderKind[] {
	return [...registry.entries()].map(([id, entry]) => ({
		id,
		label: entry.label,
		fields: entry.fields,
		hint: entry.hint,
		oauth: entry.oauth,
		// Read from the factory rather than configured separately: whether a
		// provider creates its own calendar IS whether it implements this.
		createsOwnCalendar: typeof entry.make({}).ensureCalendar === 'function'
	}));
}

export function makeCalendarProvider(
	kind: string,
	config: Record<string, string>
): CalendarProvider | null {
	const entry = registry.get(kind);
	return entry ? entry.make(config) : null;
}
