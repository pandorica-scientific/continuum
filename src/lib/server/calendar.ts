import { db } from '$lib/server/db';
import { document, loan, loanFixationPeriod, property, tenancy } from '$lib/server/db/schema';
import { periodForMonth } from '$lib/server/loans/amortise';
import { getSetting, setSetting } from '$lib/server/settings';
import { formatMinor } from '$lib/money';
import { randomBytes } from 'node:crypto';

// The ledger writes its own events, generated from what it already knows —
// nothing is authored by hand. Each class of event is individually switchable.

export const CALENDAR_RULES = [
	{
		key: 'importReminder',
		label: 'Statement import reminder',
		detail: 'first working day of the month'
	},
	{ key: 'loanPayments', label: 'Loan and card payment dates', detail: 'from the loans module' },
	{
		key: 'propertyDates',
		label: 'Property inspections and lease dates',
		detail: 'tenancies and renewal notices'
	},
	{ key: 'investmentReport', label: 'Investment report update', detail: 'quarterly' },
	{
		key: 'expiry',
		label: 'Contract and document expiry',
		detail: 'leases, fixations, passports, policies'
	}
] as const;

export type CalendarRuleKey = (typeof CALENDAR_RULES)[number]['key'];
export type CalendarRuleToggles = Record<CalendarRuleKey, boolean>;

const DEFAULT_RULES: CalendarRuleToggles = {
	importReminder: true,
	loanPayments: true,
	propertyDates: true,
	investmentReport: true,
	expiry: true
};

export async function getCalendarRules(): Promise<CalendarRuleToggles> {
	const stored = await getSetting<Partial<CalendarRuleToggles>>('calendarRules', {});
	return { ...DEFAULT_RULES, ...stored };
}

export interface LedgerEvent {
	date: string; // ISO
	label: string;
	ruleKey: CalendarRuleKey;
	/** amount in minor units of `currency`, when the event is a payment */
	amountMinor?: bigint;
	currency?: string;
}

function firstWorkingDay(year: number, monthIndex: number): string {
	const date = new Date(Date.UTC(year, monthIndex, 1));
	while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
		date.setUTCDate(date.getUTCDate() + 1);
	}
	return date.toISOString().slice(0, 10);
}

function* monthsIn(startIso: string, endIso: string): Generator<[number, number]> {
	let [y, m] = [Number(startIso.slice(0, 4)), Number(startIso.slice(5, 7)) - 1];
	const [endY, endM] = [Number(endIso.slice(0, 4)), Number(endIso.slice(5, 7)) - 1];
	while (y < endY || (y === endY && m <= endM)) {
		yield [y, m];
		m++;
		if (m > 11) {
			m = 0;
			y++;
		}
	}
}

/** All ledger-generated events in [start, end], honouring the rule toggles. */
export async function generateEvents(startIso: string, endIso: string): Promise<LedgerEvent[]> {
	const rules = await getCalendarRules();
	const [loans, periods, tenancies, properties, docs] = await Promise.all([
		db.select().from(loan),
		db.select().from(loanFixationPeriod),
		db.select().from(tenancy),
		db.select().from(property),
		db.select().from(document)
	]);

	const events: LedgerEvent[] = [];
	const inRange = (d: string) => d >= startIso && d <= endIso;

	for (const [y, m] of monthsIn(startIso, endIso)) {
		if (rules.importReminder) {
			const day = firstWorkingDay(y, m);
			if (inRange(day)) {
				events.push({
					date: day,
					label: "Import last month's statements",
					ruleKey: 'importReminder'
				});
			}
		}
		if (rules.investmentReport && [0, 3, 6, 9].includes(m)) {
			const day = firstWorkingDay(y, m);
			if (inRange(day)) {
				events.push({
					date: day,
					label: 'Upload the quarterly XTB report',
					ruleKey: 'investmentReport'
				});
			}
		}
		if (rules.loanPayments) {
			for (const l of loans) {
				if (l.owedMinor <= 0n || !l.paymentDay) continue;
				const month = `${y}-${String(m + 1).padStart(2, '0')}`;
				const period = periodForMonth(
					periods
						.filter((p) => p.loanId === l.id)
						.map((p) => ({
							startDate: p.startDate,
							endDate: p.endDate,
							annualRatePct: Number(p.annualRatePct),
							paymentMinor: p.paymentMinor
						})),
					month
				);
				if (!period) continue;
				const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
				const day = `${month}-${String(Math.min(l.paymentDay, last)).padStart(2, '0')}`;
				if (inRange(day)) {
					events.push({
						date: day,
						label: `${l.name} payment`,
						ruleKey: 'loanPayments',
						amountMinor: -period.paymentMinor,
						currency: l.currency
					});
				}
			}
		}
	}

	if (rules.propertyDates) {
		for (const t of tenancies) {
			const propertyName = properties.find((p) => p.id === t.propertyId)?.name ?? 'the flat';
			if (t.endDate && inRange(t.endDate)) {
				events.push({
					date: t.endDate,
					label: `Lease ends · ${propertyName}`,
					ruleKey: 'propertyDates',
					amountMinor: t.rentMinor > 0n ? undefined : undefined
				});
			}
			if (t.renewalNoticeDate && inRange(t.renewalNoticeDate)) {
				events.push({
					date: t.renewalNoticeDate,
					label: `Renewal notice due · ${propertyName}`,
					ruleKey: 'propertyDates'
				});
			}
		}
	}

	if (rules.expiry) {
		for (const d of docs) {
			if (d.expiresOn && inRange(d.expiresOn)) {
				events.push({ date: d.expiresOn, label: `${d.name} ${d.expiryVerb}`, ruleKey: 'expiry' });
			}
		}
		for (const p of periods) {
			if (p.endDate && inRange(p.endDate)) {
				const l = loans.find((x) => x.id === p.loanId);
				if (l && l.owedMinor > 0n) {
					events.push({ date: p.endDate, label: `${l.name} fixation ends`, ruleKey: 'expiry' });
				}
			}
		}
	}

	return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Upcoming money events for the Overview "Next 30 days" card. */
export async function next30Days(): Promise<
	{ date: string; label: string; amount: string | null; negative: boolean }[]
> {
	const start = new Date().toISOString().slice(0, 10);
	const end = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
	const events = await generateEvents(start, end);
	return events.slice(0, 8).map((e) => ({
		date: e.date.slice(5),
		label: e.label,
		amount:
			e.amountMinor !== undefined && e.currency
				? formatMinor(e.amountMinor, e.currency, { signed: true })
				: null,
		negative: (e.amountMinor ?? 0n) < 0n
	}));
}

/** Stable secret token for the published ics feed URL. */
export async function icsToken(): Promise<string> {
	let token = await getSetting<string>('icsToken', '');
	if (!token) {
		token = randomBytes(16).toString('hex');
		await setSetting('icsToken', token);
	}
	return token;
}

/** The published feed: a year back, a year ahead, all-day events. */
export async function buildIcs(): Promise<string> {
	const start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
	const end = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
	const events = await generateEvents(start, end);
	const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Continuum//ledger//EN',
		'X-WR-CALNAME:Continuum ledger'
	];
	events.forEach((e, i) => {
		const day = e.date.replace(/-/g, '');
		lines.push(
			'BEGIN:VEVENT',
			`UID:${day}-${i}@continuum-ledger`,
			`DTSTAMP:${stamp}`,
			`DTSTART;VALUE=DATE:${day}`,
			`SUMMARY:${e.label.replace(/[,;\\]/g, ' ')}`,
			'END:VEVENT'
		);
	});
	lines.push('END:VCALENDAR');
	return lines.join('\r\n');
}
