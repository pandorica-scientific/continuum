import { asOptionalRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { asc, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { calendarConflict, calendarEvent, calendarEventException } from '$lib/server/db/schema';
import {
	CALENDAR_RULES,
	generateEvents,
	getCalendarRules,
	icsToken,
	type CalendarRuleKey
} from '$lib/server/calendar';
import { createEvent, deleteEvent, updateEvent } from '$lib/server/calendar/mutations';
import { allOccurrences, type ExceptionRow, type SeriesRow } from '$lib/calendar/occurrences';
import { markerForCategory, markerForGenerated } from '$lib/calendar/markers';
import { EVENT_CATEGORIES, EVENT_CATEGORY_KEYS } from '$lib/modules/registry';
import type { EditScope } from '$lib/calendar/scope';
import { instantOfWall, localDate } from '$lib/calendar/rrule';
import { listCalendarAccounts } from '$lib/server/calendar/sync';
import { acknowledgeConflicts } from '$lib/server/calendar/conflicts';
import { setSetting } from '$lib/server/settings';
import { formatMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

/** The zone events are authored in. Recurrence expands against wall-clock time,
 *  so this has to be a real zone rather than an offset. */
const HOUSEHOLD_TZ = 'Europe/Prague';

export const load: PageServerLoad = async ({ url }) => {
	const monthParam = url.searchParams.get('m');
	const now = new Date();
	const month = /^\d{4}-\d{2}$/.test(monthParam ?? '')
		? monthParam!
		: now.toISOString().slice(0, 7);

	const [y, m] = month.split('-').map(Number);
	const first = new Date(Date.UTC(y, m - 1, 1));
	const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
	const start = `${month}-01`;
	const end = `${month}-${String(daysInMonth).padStart(2, '0')}`;

	const [events, rules, token, eventRows, exceptionRows, accounts, conflicts] = await Promise.all([
		generateEvents(start, end),
		getCalendarRules(),
		icsToken(),
		db
			.select()
			.from(calendarEvent)
			.where(isNull(calendarEvent.deletedAt))
			.orderBy(asc(calendarEvent.startsAt)),
		db.select().from(calendarEventException),
		listCalendarAccounts(),
		db
			.select()
			.from(calendarConflict)
			.where(isNull(calendarConflict.acknowledgedAt))
			.orderBy(asc(calendarConflict.detectedAt))
	]);

	const exceptionsByEvent = new Map<string, ExceptionRow[]>();
	for (const row of exceptionRows) {
		const list = exceptionsByEvent.get(row.eventId) ?? [];
		list.push({
			recurrenceId: row.recurrenceId,
			cancelled: row.cancelled,
			title: row.title,
			startsAt: row.startsAt?.toISOString() ?? null,
			endsAt: row.endsAt?.toISOString() ?? null,
			notes: row.notes,
			category: row.category,
			allDay: row.allDay,
			tz: row.tz
		});
		exceptionsByEvent.set(row.eventId, list);
	}

	const series: SeriesRow[] = eventRows.map((row) => ({
		id: row.id,
		title: row.title,
		notes: row.notes,
		category: row.category,
		allDay: row.allDay,
		startsAt: row.startsAt.toISOString(),
		endsAt: row.endsAt.toISOString(),
		tz: row.tz,
		rrule: row.rrule
	}));

	// One lookup rather than a `find` per occurrence. The rule comes from here;
	// the zone comes off the occurrence itself, which may override the series'.
	const seriesById = new Map(series.map((s) => [s.id, s]));

	const occurrences = allOccurrences(series, exceptionsByEvent, start, end).map((o) => {
		// The OCCURRENCE's zone, which is the series' unless this one overrides it.
		// Reading the series' zone here ignored a "this event only" edit that moved
		// one occurrence to another zone, and printed it at the wrong hour.
		const tz = o.tz || HOUSEHOLD_TZ;
		return {
			...o,
			// Read on the event's OWN clock, not UTC. `slice(0, 10)` put anything
			// before the offset — an all-day event at local midnight, a 00:30
			// alarm — on the previous day, so the dot, the agenda row and the
			// per-cell count all disagreed with the time printed beside them.
			date: localDate(o.startsAt, tz),
			time: o.allDay
				? null
				: new Date(o.startsAt).toLocaleTimeString('en-GB', {
						hour: '2-digit',
						minute: '2-digit',
						timeZone: tz
					}),
			marker: markerForCategory(o.category),
			rrule: seriesById.get(o.eventId)?.rrule ?? null
		};
	});

	// Monday-first grid with leading blanks. Both kinds of event count towards a
	// day's dot, because the grid answers "is anything happening", not "did the
	// ledger write anything".
	const lead = (first.getUTCDay() + 6) % 7;
	// The household's today, not UTC's. Between local midnight and the offset the
	// two are different days, and this one both highlights a cell and pre-fills
	// the date on a new event — so a note made just after midnight was filed on
	// the day before.
	const today = localDate(now, HOUSEHOLD_TZ);
	const cells = [
		...Array.from({ length: lead }, () => null),
		...Array.from({ length: daysInMonth }, (_, i) => {
			const date = `${month}-${String(i + 1).padStart(2, '0')}`;
			return {
				num: i + 1,
				date,
				isToday: date === today,
				events:
					events.filter((e) => e.date === date).length +
					occurrences.filter((o) => o.date === date).length
			};
		})
	];

	const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
	const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);

	return {
		month,
		monthLabel: first.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
		prev,
		next,
		cells,
		today,
		tz: HOUSEHOLD_TZ,
		categories: EVENT_CATEGORY_KEYS.map((key) => ({ key, ...EVENT_CATEGORIES[key] })),
		agenda: events.map((e) => ({
			date: e.date,
			day: e.date.slice(8),
			label:
				e.amountMinor !== undefined && e.currency
					? `${e.label} · ${formatMinor(e.amountMinor, e.currency, { signed: true })}`
					: e.label,
			ruleKey: e.ruleKey,
			marker: markerForGenerated(e.ruleKey, e.binding)
		})),
		occurrences,
		// Enough to say whether sync is live, without the credential going anywhere
		// near a page payload.
		accounts: accounts.map((account) => ({
			id: account.id,
			label: account.label,
			connected: Boolean(account.remoteCalId),
			calendarName: account.remoteCalName ?? null,
			lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
			failing: Boolean(account.lastError)
		})),
		// Edits sync discarded, and dates a calendar edit wrote into the ledger.
		// Surfaced HERE and not only in the briefing, because the briefing raises
		// them and this is the screen it sends people to — with nothing on it to
		// clear them, the card stayed up forever and taught the household to ignore
		// the briefing.
		conflicts: conflicts.map((row) => ({
			id: row.id,
			detectedAt: row.detectedAt.toISOString(),
			resolution: row.resolution,
			title:
				(row.ours as { title?: string } | null)?.title ??
				(row.theirs as { title?: string } | null)?.title ??
				'An event'
		})),
		rules: CALENDAR_RULES.map((r) => ({ ...r, on: rules[r.key] })),
		icsPath: `/ics/${token}`
	};
};

/**
 * The instant at which the household's clock reads this date and time.
 *
 * `new Date('2026-08-17T09:00:00')` — no offset — is parsed in the SERVER's
 * zone, which in the shipped image is UTC. The row records tz: Europe/Prague and
 * every read path renders in Prague, so a 09:00 event was stored as 09:00Z and
 * read back as 11:00; saving it again stored 11:00Z and read back as 13:00, and
 * the event walked forward by the offset on every single edit.
 */
function householdInstant(date: string, time: string): Date {
	const [hour, minute] = time.split(':').map(Number);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
		return new Date(NaN);
	}
	return instantOfWall(
		{
			year: Number(date.slice(0, 4)),
			month: Number(date.slice(5, 7)),
			day: Number(date.slice(8, 10)),
			hour,
			minute,
			second: 0
		},
		HOUSEHOLD_TZ
	);
}

/** Read the event form into the shape the mutations take. */
function readEvent(form: FormData) {
	const text = (key: string) => String(form.get(key) ?? '').trim();
	const allDay = form.get('allDay') === 'on';
	const date = text('date');

	const common = {
		title: text('title'),
		notes: text('notes') || null,
		category: text('category') || null,
		allDay,
		rrule: text('rrule') || null
	};

	// AN ALL-DAY EVENT IS A DATE, NOT AN INSTANT, so it is anchored to UTC.
	//
	// Anchoring it to the household's wall clock stored "6 August, all day" as
	// 2026-08-05T22:00:00Z, and every consumer that reads a date back off the
	// instant then reported the fifth: the month grid (`startsAt.slice(0, 10)`),
	// Google's `{ date }`, and iCalendar's `VALUE=DATE`. The event showed up a
	// day early on screen before any calendar was even connected, and the first
	// sync round trip wrote that wrong day back into the row.
	//
	// UTC midnight through end of day is also exactly how the ledger's own
	// generated all-day events are held (see the sync engine's localItems), so
	// authored and generated events now round-trip through both providers the
	// same way instead of only one of them being right.
	if (allDay) {
		const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
		return {
			...common,
			startsAt: valid ? new Date(`${date}T00:00:00.000Z`) : new Date(NaN),
			endsAt: valid ? new Date(`${date}T23:59:59.000Z`) : new Date(NaN),
			tz: 'UTC'
		};
	}

	const startTime = text('startTime') || '09:00';
	const endTime = text('endTime') || startTime;

	return {
		...common,
		startsAt: householdInstant(date, startTime),
		endsAt: householdInstant(date, endTime),
		tz: HOUSEHOLD_TZ
	};
}

function readScope(form: FormData): EditScope {
	const scope = String(form.get('scope') ?? 'all');
	return scope === 'this' || scope === 'following' ? scope : 'all';
}

export const actions: Actions = {
	toggleRule: async ({ request }) => {
		const form = await request.formData();
		const key = String(form.get('key') ?? '') as CalendarRuleKey;
		if (!CALENDAR_RULES.some((r) => r.key === key)) return fail(400, { message: 'Unknown rule.' });
		const rules = await getCalendarRules();
		rules[key] = !rules[key];
		await setSetting('calendarRules', rules);
		return { ok: true };
	},

	saveEvent: async ({ request, locals }) => {
		const form = await request.formData();
		const input = readEvent(form);
		const id = asOptionalRowId(form.get('id'));
		const recurrenceId = String(form.get('recurrenceId') ?? '') || null;

		// Echo the submitted values back on failure so a rejected form does not
		// discard what was typed.
		const values = Object.fromEntries(form.entries());
		const result = id
			? await updateEvent(id, input, readScope(form), recurrenceId)
			: await createEvent(input, locals.person?.id ?? null);

		if (!result.ok) return fail(result.status, { values, message: result.message });
		return { saved: true };
	},

	acknowledgeConflicts: async () => {
		await acknowledgeConflicts();
		return { acknowledged: true };
	},

	deleteEvent: async ({ request }) => {
		const form = await request.formData();
		const id = asOptionalRowId(form.get('id'));
		if (!id) return fail(400, { message: 'Which event?' });
		const recurrenceId = String(form.get('recurrenceId') ?? '') || null;

		const result = await deleteEvent(id, readScope(form), recurrenceId);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { deleted: true };
	}
};
