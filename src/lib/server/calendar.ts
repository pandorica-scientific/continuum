import { db, type Db } from '$lib/server/db';
import { document, loan, loanFixationPeriod, property, tenancy } from '$lib/server/db/schema';
import { periodForMonth } from '$lib/loans/amortise';
import { getSetting, setSetting } from '$lib/server/settings';
import { formatMinor } from '$lib/money';
import { generatedKey, type OriginBinding } from '$lib/calendar/keys';
import { decorate, markerForGenerated } from '$lib/calendar/markers';
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

export async function getCalendarRules(handle: Db = db): Promise<CalendarRuleToggles> {
	const stored = await getSetting<Partial<CalendarRuleToggles>>('calendarRules', {}, handle);
	return { ...DEFAULT_RULES, ...stored };
}

/**
 * Whether events carry their module emoji and the ` · Continuum` tag when they
 * leave here. On by default — in a shared calendar the marker is what tells a
 * ledger event apart from "dentist, 3pm" — but a household that does not want
 * emoji in their calendar should not have to want them.
 */
export async function getCalendarMarkers(handle: Db = db): Promise<boolean> {
	return getSetting<boolean>('calendarMarkers', true, handle);
}

export interface LedgerEvent {
	date: string; // ISO
	label: string;
	ruleKey: CalendarRuleKey;
	/** amount in minor units of `currency`, when the event is a payment */
	amountMinor?: bigint;
	currency?: string;
	/**
	 * Stable identity, derived from what produced this event. Generated events
	 * have no row, so nothing else can identify them across two requests — and
	 * both the published feed and the sync engine key on exactly this.
	 */
	key: string;
	/**
	 * The ledger row behind the event, when there is one. Null for pure schedule
	 * rules (the import reminder, the quarterly report) — they are derived from
	 * the calendar itself rather than from any row, so there is nothing a remote
	 * edit could be written back to.
	 */
	binding: OriginBinding | null;
}

/**
 * The UID this event carries in the published feed.
 *
 * Derived from the event's key rather than its index in the generated array.
 * The old form, `${day}-${i}@continuum-ledger`, changed for every later event on
 * a day as soon as one was inserted before it, so subscribers saw a delete and a
 * create. Harmless churn in a read-only feed; under two-way sync the remote side
 * keys on this value, and a shifting UID means duplicates and lost edits.
 */
export function icsUid(key: string): string {
	// The UID occupies its own folded line; a CR or LF inside it would terminate
	// the property early and let whatever follows be parsed as iCalendar.
	return `${key.replace(/[\r\n]/g, '')}@continuum-ledger`;
}

/** 'YYYY-MM' from a year and a zero-based month index. */
function monthKey(year: number, monthIndex: number): string {
	return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
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
export async function generateEvents(
	startIso: string,
	endIso: string,
	handle: Db = db
): Promise<LedgerEvent[]> {
	const rules = await getCalendarRules(handle);
	const [loans, periods, tenancies, properties, docs] = await Promise.all([
		handle.select().from(loan),
		handle.select().from(loanFixationPeriod),
		handle.select().from(tenancy),
		handle.select().from(property),
		handle.select().from(document)
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
					ruleKey: 'importReminder',
					key: generatedKey('importReminder', null, monthKey(y, m)),
					binding: null
				});
			}
		}
		if (rules.investmentReport && [0, 3, 6, 9].includes(m)) {
			const day = firstWorkingDay(y, m);
			if (inRange(day)) {
				events.push({
					date: day,
					label: 'Upload the quarterly XTB report',
					ruleKey: 'investmentReport',
					key: generatedKey('investmentReport', null, monthKey(y, m)),
					binding: null
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
					const binding = { table: 'loan', rowId: l.id, field: 'paymentDay' } as const;
					events.push({
						date: day,
						label: `${l.name} payment`,
						ruleKey: 'loanPayments',
						amountMinor: -period.paymentMinor,
						currency: l.currency,
						// The month belongs in the key: one loan emits twelve distinct
						// payment events a year and they must not share an identity.
						key: generatedKey('loanPayments', binding, month),
						binding
					});
				}
			}
		}
	}

	if (rules.propertyDates) {
		for (const t of tenancies) {
			const propertyName = properties.find((p) => p.id === t.propertyId)?.name ?? 'the flat';
			if (t.endDate && inRange(t.endDate)) {
				// No amountMinor: a lease ending is a date, not a movement of
				// money, and the renderer prints amountMinor as a signed figure.
				const binding = { table: 'tenancy', rowId: t.id, field: 'endDate' } as const;
				events.push({
					date: t.endDate,
					label: `Lease ends · ${propertyName}`,
					ruleKey: 'propertyDates',
					key: generatedKey('propertyDates', binding),
					binding
				});
			}
			if (t.renewalNoticeDate && inRange(t.renewalNoticeDate)) {
				const binding = { table: 'tenancy', rowId: t.id, field: 'renewalNoticeDate' } as const;
				events.push({
					date: t.renewalNoticeDate,
					label: `Renewal notice due · ${propertyName}`,
					ruleKey: 'propertyDates',
					key: generatedKey('propertyDates', binding),
					binding
				});
			}
		}
	}

	if (rules.expiry) {
		for (const d of docs) {
			if (d.expiresOn && inRange(d.expiresOn)) {
				const binding = { table: 'document', rowId: d.id, field: 'expiresOn' } as const;
				events.push({
					date: d.expiresOn,
					label: `${d.name} ${d.expiryVerb}`,
					ruleKey: 'expiry',
					key: generatedKey('expiry', binding),
					binding
				});
			}
		}
		for (const p of periods) {
			if (p.endDate && inRange(p.endDate)) {
				const l = loans.find((x) => x.id === p.loanId);
				if (l && l.owedMinor > 0n) {
					// The fixation PERIOD row, not the loan: p.id is a
					// loan_fixation_period id, and binding it to 'loan' would name a
					// loan row that does not exist.
					const binding = {
						table: 'loanFixationPeriod',
						rowId: p.id,
						field: 'endDate'
					} as const;
					events.push({
						date: p.endDate,
						label: `${l.name} fixation ends`,
						ruleKey: 'expiry',
						key: generatedKey('expiry', binding),
						binding
					});
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
	const [events, markers] = await Promise.all([generateEvents(start, end), getCalendarMarkers()]);
	const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Continuum//ledger//EN',
		'X-WR-CALNAME:Continuum ledger'
	];
	events.forEach((e) => {
		const day = e.date.replace(/-/g, '');
		// Composed here, at the edge, rather than stored on the event: decoration
		// must never reach the content hash the sync merge compares against.
		const summary = decorate(
			e.label,
			markers ? markerForGenerated(e.ruleKey, e.binding) : null,
			markers
		);
		lines.push(
			'BEGIN:VEVENT',
			`UID:${icsUid(e.key)}`,
			`DTSTAMP:${stamp}`,
			`DTSTART;VALUE=DATE:${day}`,
			`SUMMARY:${summary.replace(/[,;\\]/g, ' ')}`,
			'END:VEVENT'
		);
	});
	lines.push('END:VCALENDAR');
	return lines.join('\r\n');
}
