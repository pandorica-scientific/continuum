// RFC 5545 recurrence, expanded over a window.
//
// Pure and client-safe: no database, no clock, no network. The calendar screen
// and the sync engine both expand the same way, because two expansions that
// disagree would show one thing and sync another.
//
// THE CENTRAL FACT: a recurrence rule is written in LOCAL WALL-CLOCK time.
// "Every Tuesday at 09:00" means 09:00 on the wall, whatever the offset happens
// to be that week. So expansion walks local calendar dates and converts each one
// to an instant against ITS OWN offset — never by adding 7×24h to the previous
// instant, which would drift by an hour across a DST boundary and keep drifting.

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Rrule {
	freq: Freq;
	interval: number;
	/** RFC two-letter weekday codes, e.g. ['TU'] or ['MO','WE']. */
	byDay: string[];
	byMonthDay: number[];
	/** Which of the matching days in the period; negative counts from the end. */
	bySetPos: number[];
	count: number | null;
	/** Inclusive end, as an ISO instant. */
	until: string | null;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// A backstop, not a business rule. The walk is already bounded by the window, so
// this catches a caller asking for something absurd — or a bug in the stepping
// that fails to advance.
//
// 50k candidate steps is ~137 years of daily recurrence. Every real caller is far
// below it: the calendar screen expands one month, and the sync horizon is 455
// days. A limit high enough never to fire legitimately, low enough that a
// runaway surfaces as an error instead of a request that merely feels slow.
const MAX_ITERATIONS = 50_000;

export function parseRrule(rule: string): Rrule | null {
	const trimmed = rule.trim().replace(/^RRULE:/i, '');
	if (!trimmed) return null;

	const parts = new Map<string, string>();
	for (const chunk of trimmed.split(';')) {
		const [key, value] = chunk.split('=');
		if (key && value) parts.set(key.trim().toUpperCase(), value.trim());
	}

	const freq = (parts.get('FREQ') ?? '').toUpperCase();
	if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;

	const numbers = (key: string): number[] =>
		(parts.get(key) ?? '')
			.split(',')
			.map((n) => Number(n))
			.filter((n) => Number.isInteger(n) && n !== 0);

	return {
		freq,
		interval: Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1),
		byDay: (parts.get('BYDAY') ?? '')
			.split(',')
			.map((d) => d.trim().toUpperCase())
			.filter((d) => WEEKDAYS.includes(d)),
		byMonthDay: numbers('BYMONTHDAY'),
		bySetPos: numbers('BYSETPOS'),
		count: parts.has('COUNT') ? Math.max(0, Number(parts.get('COUNT'))) : null,
		until: parts.has('UNTIL') ? parseUntil(parts.get('UNTIL')!) : null
	};
}

export function formatRrule(rule: Rrule): string {
	const parts = [`FREQ=${rule.freq}`];
	if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
	if (rule.byDay.length) parts.push(`BYDAY=${rule.byDay.join(',')}`);
	if (rule.byMonthDay.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
	if (rule.bySetPos.length) parts.push(`BYSETPOS=${rule.bySetPos.join(',')}`);
	if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
	if (rule.until) parts.push(`UNTIL=${toBasicUtc(rule.until)}`);
	return parts.join(';');
}

/** RFC 5545 basic format, always UTC: 20260903T090000Z. */
export function toBasicUtc(iso: string): string {
	return new Date(iso)
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

function parseUntil(value: string): string | null {
	const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
	if (!m) return null;
	const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
	return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
}

// ---- timezone helpers -------------------------------------------------------

const offsetCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
	let formatter = offsetCache.get(tz);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			hour12: false,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		offsetCache.set(tz, formatter);
	}
	return formatter;
}

export interface Wall {
	year: number;
	month: number; // 1-12
	day: number;
	hour: number;
	minute: number;
	second: number;
}

/** The wall-clock reading an instant shows in a zone. */
function wallOf(instant: Date, tz: string): Wall {
	const parts = formatterFor(tz).formatToParts(instant);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	// Intl renders midnight as hour 24 in some engines; normalise it to 0.
	const hour = get('hour') % 24;
	return {
		year: get('year'),
		month: get('month'),
		day: get('day'),
		hour,
		minute: get('minute'),
		second: get('second')
	};
}

/**
 * The instant at which a zone's wall clock reads this local time.
 *
 * Two passes, because the offset depends on the answer: guess by treating the
 * wall time as UTC, read the offset that guess lands in, correct, then re-check.
 * The second pass is what handles a guess that fell on the wrong side of a
 * transition. Where a local time is skipped (the spring-forward gap) this lands
 * on the instant just after the jump, which is what calendar clients do.
 */
export function instantOfWall(wall: Wall, tz: string): Date {
	const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
	let instant = new Date(asUtc);
	for (let pass = 0; pass < 2; pass++) {
		const seen = wallOf(instant, tz);
		const seenUtc = Date.UTC(
			seen.year,
			seen.month - 1,
			seen.day,
			seen.hour,
			seen.minute,
			seen.second
		);
		const drift = asUtc - seenUtc;
		if (drift === 0) break;
		instant = new Date(instant.getTime() + drift);
	}
	return instant;
}

// ---- expansion --------------------------------------------------------------

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Weekday code of a local calendar date, without going through any timezone. */
function weekdayCode(year: number, month: number, day: number): string {
	return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/**
 * Candidate local dates for one period of the rule, in ascending order.
 *
 * Returns day-of-month numbers within the given year/month for MONTHLY and
 * YEARLY; for DAILY and WEEKLY the caller walks days directly.
 */
function monthlyCandidates(rule: Rrule, year: number, month: number, anchorDay: number): number[] {
	const last = daysInMonth(year, month);

	let days: number[];
	if (rule.byDay.length > 0) {
		days = [];
		for (let day = 1; day <= last; day++) {
			if (rule.byDay.includes(weekdayCode(year, month, day))) days.push(day);
		}
	} else if (rule.byMonthDay.length > 0) {
		// A day the month does not have is SKIPPED, per RFC 5545 — never rolled
		// into the next month. 31 February simply does not occur.
		days = rule.byMonthDay
			.map((d) => (d < 0 ? last + d + 1 : d))
			.filter((d) => d >= 1 && d <= last)
			.sort((a, b) => a - b);
	} else {
		days = anchorDay <= last ? [anchorDay] : [];
	}

	if (rule.bySetPos.length === 0) return days;
	const picked = rule.bySetPos
		.map((pos) => (pos < 0 ? days[days.length + pos] : days[pos - 1]))
		.filter((d): d is number => typeof d === 'number');
	return [...new Set(picked)].sort((a, b) => a - b);
}

/**
 * Occurrence start instants of a series within [from, to], as ISO strings.
 *
 * @param rule    RFC 5545 rule body, or '' for a single occurrence
 * @param dtStart the series start, as an ISO instant
 * @param tz      IANA zone the event was authored in
 * @param from    inclusive window start, YYYY-MM-DD
 * @param to      inclusive window end, YYYY-MM-DD
 */
export function expand(
	rule: string,
	dtStart: string,
	tz: string,
	from: string,
	to: string
): string[] {
	const start = new Date(dtStart);
	// BOTH ends read on the same clock — the event's own zone, never UTC for one
	// and the zone for the other. Mixing them opens a hole the width of the
	// offset at the start of every window: in a zone ahead of UTC an event at
	// 00:30 local on the 1st is before this month's UTC midnight and after last
	// month's zone-local end of day, so it appears in neither; in a zone behind
	// UTC the same event appears in both.
	const windowStart = instantOfWall(
		{
			year: Number(from.slice(0, 4)),
			month: Number(from.slice(5, 7)),
			day: Number(from.slice(8, 10)),
			hour: 0,
			minute: 0,
			second: 0
		},
		tz
	).getTime();
	// Inclusive of the whole final day, in the event's own zone rather than UTC.
	const windowEnd = instantOfWall(
		{
			year: Number(to.slice(0, 4)),
			month: Number(to.slice(5, 7)),
			day: Number(to.slice(8, 10)),
			hour: 23,
			minute: 59,
			second: 59
		},
		tz
	).getTime();

	const parsed = parseRrule(rule);
	if (!parsed) {
		const at = start.getTime();
		return at >= windowStart && at <= windowEnd ? [start.toISOString()] : [];
	}

	const anchor = wallOf(start, tz);
	const time = { hour: anchor.hour, minute: anchor.minute, second: anchor.second };
	const untilAt = parsed.until ? new Date(parsed.until).getTime() : null;

	const out: string[] = [];
	let emitted = 0; // counts from DTSTART, not from the window — COUNT is a
	// property of the series, so a rule must not return a different number of
	// occurrences depending on which month is being looked at.
	let iterations = 0;

	const consider = (year: number, month: number, day: number): boolean => {
		const instant = instantOfWall({ year, month, day, ...time }, tz);
		const at = instant.getTime();
		if (at < start.getTime()) return true;
		if (untilAt !== null && at > untilAt) return false;
		if (parsed.count !== null && emitted >= parsed.count) return false;
		emitted++;
		if (at >= windowStart && at <= windowEnd) out.push(instant.toISOString());
		return at <= windowEnd;
	};

	if (parsed.freq === 'DAILY' || parsed.freq === 'WEEKLY') {
		const step = parsed.freq === 'DAILY' ? parsed.interval : 1;
		const cursor = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day));
		// WEEKLY with BYDAY walks days and filters; the INTERVAL applies to weeks,
		// measured from the week the series started in.
		const startWeek = Math.floor(cursor.getTime() / 604800000);
		for (;;) {
			if (++iterations > MAX_ITERATIONS) {
				throw new Error(
					'Recurrence produced too many occurrences; narrow the window or add an end.'
				);
			}
			const year = cursor.getUTCFullYear();
			const month = cursor.getUTCMonth() + 1;
			const day = cursor.getUTCDate();

			let matches = true;
			if (parsed.freq === 'WEEKLY') {
				const week = Math.floor(cursor.getTime() / 604800000);
				matches =
					(week - startWeek) % parsed.interval === 0 &&
					// WEEKLY with no BYDAY recurs on the WEEKDAY the series started on,
					// per RFC 5545 — never on its day of the month. Comparing days of the
					// month made the rule fire roughly monthly, so a weekly event pulled
					// from a calendar that omits BYDAY (Apple's does) lost three of every
					// four occurrences, on screen and in the published feed alike.
					(parsed.byDay.length === 0
						? weekdayCode(year, month, day) === weekdayCode(anchor.year, anchor.month, anchor.day)
						: parsed.byDay.includes(weekdayCode(year, month, day)));
			}

			if (matches && !consider(year, month, day)) break;
			if (
				instantOfWall({ year, month, day, ...time }, tz).getTime() > windowEnd &&
				out.length > 0
			) {
				break;
			}
			cursor.setUTCDate(cursor.getUTCDate() + (parsed.freq === 'DAILY' ? step : 1));
			if (cursor.getTime() > windowEnd + 86400000 * 2) break;
		}
		return out;
	}

	// MONTHLY and YEARLY step whole periods and pick candidate days inside each.
	const stepMonths = parsed.freq === 'MONTHLY' ? parsed.interval : parsed.interval * 12;
	let year = anchor.year;
	let month = anchor.month;
	for (;;) {
		if (++iterations > MAX_ITERATIONS) {
			throw new Error('Recurrence produced too many occurrences; narrow the window or add an end.');
		}
		const candidates =
			parsed.freq === 'YEARLY' && parsed.byDay.length === 0 && parsed.byMonthDay.length === 0
				? month === anchor.month
					? [anchor.day]
					: []
				: monthlyCandidates(parsed, year, month, anchor.day);

		let exhausted = false;
		for (const day of candidates) {
			if (!consider(year, month, day)) {
				exhausted = true;
				break;
			}
		}
		if (exhausted) break;

		const first = instantOfWall({ year, month, day: 1, ...time }, tz).getTime();
		if (first > windowEnd) break;

		month += stepMonths;
		while (month > 12) {
			month -= 12;
			year++;
		}
	}
	return out;
}
