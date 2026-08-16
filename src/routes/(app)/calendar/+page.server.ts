import { fail } from '@sveltejs/kit';
import { asc, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { calendarEvent, calendarEventException } from '$lib/server/db/schema';
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
import { listCalendarAccounts } from '$lib/server/calendar/sync';
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

	const [events, rules, token, eventRows, exceptionRows, accounts] = await Promise.all([
		generateEvents(start, end),
		getCalendarRules(),
		icsToken(),
		db
			.select()
			.from(calendarEvent)
			.where(isNull(calendarEvent.deletedAt))
			.orderBy(asc(calendarEvent.startsAt)),
		db.select().from(calendarEventException),
		listCalendarAccounts()
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
			notes: row.notes
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

	const occurrences = allOccurrences(series, exceptionsByEvent, start, end).map((o) => ({
		...o,
		date: o.startsAt.slice(0, 10),
		time: o.allDay
			? null
			: new Date(o.startsAt).toLocaleTimeString('en-GB', {
					hour: '2-digit',
					minute: '2-digit',
					timeZone: HOUSEHOLD_TZ
				}),
		marker: markerForCategory(o.category),
		rrule: series.find((s) => s.id === o.eventId)?.rrule ?? null
	}));

	// Monday-first grid with leading blanks. Both kinds of event count towards a
	// day's dot, because the grid answers "is anything happening", not "did the
	// ledger write anything".
	const lead = (first.getUTCDay() + 6) % 7;
	const today = now.toISOString().slice(0, 10);
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
		rules: CALENDAR_RULES.map((r) => ({ ...r, on: rules[r.key] })),
		icsPath: `/ics/${token}`
	};
};

/** Read the event form into the shape the mutations take. */
function readEvent(form: FormData) {
	const text = (key: string) => String(form.get(key) ?? '').trim();
	const allDay = form.get('allDay') === 'on';
	const date = text('date');
	// An all-day event still needs an instant: midnight through end of day, in the
	// household's zone, so it lands on the right day in every client.
	const startTime = allDay ? '00:00' : text('startTime') || '09:00';
	const endTime = allDay ? '23:59' : text('endTime') || startTime;

	return {
		title: text('title'),
		notes: text('notes') || null,
		category: text('category') || null,
		allDay,
		startsAt: new Date(`${date}T${startTime}:00`),
		endsAt: new Date(`${date}T${endTime}:00`),
		tz: HOUSEHOLD_TZ,
		rrule: text('rrule') || null
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
		const id = String(form.get('id') ?? '');
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

	deleteEvent: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Which event?' });
		const recurrenceId = String(form.get('recurrenceId') ?? '') || null;

		const result = await deleteEvent(id, readScope(form), recurrenceId);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { deleted: true };
	}
};
