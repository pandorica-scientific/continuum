import { fail } from '@sveltejs/kit';
import {
	CALENDAR_RULES,
	generateEvents,
	getCalendarRules,
	icsToken,
	type CalendarRuleKey
} from '$lib/server/calendar';
import { setSetting } from '$lib/server/settings';
import { formatMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

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

	const [events, rules, token] = await Promise.all([
		generateEvents(start, end),
		getCalendarRules(),
		icsToken()
	]);

	// Monday-first grid with leading blanks.
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
				events: events.filter((e) => e.date === date).length
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
		agenda: events.map((e) => ({
			date: e.date,
			day: e.date.slice(8),
			label:
				e.amountMinor !== undefined && e.currency
					? `${e.label} · ${formatMinor(e.amountMinor, e.currency, { signed: true })}`
					: e.label,
			ruleKey: e.ruleKey
		})),
		rules: CALENDAR_RULES.map((r) => ({ ...r, on: rules[r.key] })),
		icsPath: `/ics/${token}`
	};
};

export const actions: Actions = {
	toggleRule: async ({ request }) => {
		const form = await request.formData();
		const key = String(form.get('key') ?? '') as CalendarRuleKey;
		if (!CALENDAR_RULES.some((r) => r.key === key)) return fail(400, { message: 'Unknown rule.' });
		const rules = await getCalendarRules();
		rules[key] = !rules[key];
		await setSetting('calendarRules', rules);
		return { ok: true };
	}
};
