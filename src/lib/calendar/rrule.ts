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
	/**
	 * RFC BYDAY tokens, e.g. ['TU'], ['MO','WE'] or ['2TU'] / ['-1FR'].
	 *
	 * The ORDINAL PREFIX is kept rather than stripped. Google and Apple both
	 * write "monthly on the second Tuesday" as `BYDAY=2TU`, and dropping the
	 * prefix left the rule with no BYDAY and no BYMONTHDAY at all — which fell
	 * through to "the day of the month the series started on", so an imported
	 * second-Tuesday series silently recurred on the 13th instead.
	 */
	byDay: string[];
	byMonthDay: number[];
	/** Which of the matching days in the period; negative counts from the end. */
	bySetPos: number[];
	count: number | null;
	/** Inclusive end, as an ISO instant. */
	until: string | null;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** A BYDAY entry: an optional ordinal (`2`, `-1`) then the two-letter code. */
const BYDAY_TOKEN = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/;

/** The two-letter code of a BYDAY token, ordinal or not. */
function dayCode(token: string): string {
	return token.slice(-2);
}

/** The ordinal of a BYDAY token, or 0 when it names every such weekday. */
function dayOrdinal(token: string): number {
	const n = Number(token.slice(0, -2));
	return Number.isInteger(n) ? n : 0;
}

// Weeks run Monday→Sunday, not Thursday→Wednesday.
//
// The epoch (1970-01-01) is a THURSDAY, so `time / 604800000` buckets Monday and
// Friday of the same calendar week into different weeks. With INTERVAL=2 that
// made `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR` fire on the Monday of one week and
// the Friday of the NEXT — every second occurrence a week late, on screen and in
// what was pushed to the provider alike.
//
// RFC 5545 counts the interval from WKST, which defaults to MO. Shifting the
// origin back three days puts week boundaries on Mondays.
const MONDAY_EPOCH = -3 * 86_400_000;

function weekIndex(time: number): number {
	return Math.floor((time - MONDAY_EPOCH) / 604800000);
}

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
			.map((d) => d.trim().toUpperCase().replace(/^\+/, ''))
			.filter((d) => BYDAY_TOKEN.test(d)),
		byMonthDay: numbers('BYMONTHDAY'),
		bySetPos: numbers('BYSETPOS'),
		// A COUNT that is not a number is no COUNT at all. Math.max(0, NaN) is NaN,
		// and `emitted >= NaN` is false forever — so a malformed value silently
		// removed the limit instead of being ignored, and formatRrule then wrote
		// `COUNT=NaN` back out for a provider to reject.
		count: parts.has('COUNT') ? countOf(parts.get('COUNT')!) : null,
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

function countOf(value: string): number | null {
	const count = Number(value);
	return Number.isFinite(count) ? Math.max(0, count) : null;
}

function parseUntil(value: string): string | null {
	const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
	if (!m) return null;
	const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
	return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
}

// ---- timezone helpers -------------------------------------------------------

const offsetCache = new Map<string, Intl.DateTimeFormat>();

/**
 * The formatter for a zone, falling back to UTC for a name Intl refuses.
 *
 * A zone name arrives from a remote calendar, not only from this app: CalDAV
 * events written by Outlook carry Windows names like "W. Europe Standard Time",
 * and a TZID may legally be quoted. Either is stored verbatim in
 * `calendar_event.tz`, and `new Intl.DateTimeFormat` throws a RangeError on
 * both — which, since every read path expands recurrence through here, turned
 * one imported event into a 500 on the whole calendar screen with no way to
 * reach the event and fix it.
 */
function formatterFor(tz: string): Intl.DateTimeFormat {
	let formatter = offsetCache.get(tz);
	if (!formatter) {
		formatter = buildFormatter(tz) ?? buildFormatter('UTC')!;
		offsetCache.set(tz, formatter);
	}
	return formatter;
}

function buildFormatter(tz: string): Intl.DateTimeFormat | null {
	try {
		return new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			hour12: false,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	} catch {
		return null;
	}
}

/** Whether Intl recognises this zone name, for validating one off the wire. */
export function isKnownTimeZone(tz: string): boolean {
	return buildFormatter(tz) !== null;
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

/**
 * The calendar date an instant falls on in a zone, as YYYY-MM-DD.
 *
 * The exact inverse of the date half of `instantOfWall`, and the reason it is
 * here rather than spelled `iso.slice(0, 10)` at each call site: that slice
 * reads the UTC date, so in any zone ahead of UTC an all-day event stored at
 * local midnight — and any timed event before the offset — reports the day
 * BEFORE the one it was authored for.
 */
export function localDate(instant: string | Date, tz: string): string {
	const wall = wallOf(instant instanceof Date ? instant : new Date(instant), tz);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${String(wall.year).padStart(4, '0')}-${pad(wall.month)}-${pad(wall.day)}`;
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
		// An ordinal token names ONE day in the period — `2TU` is the second
		// Tuesday, `-1FR` the last Friday. A bare code names every such weekday.
		// Both spellings can appear in the same rule.
		const plain = new Set(rule.byDay.filter((d) => dayOrdinal(d) === 0).map(dayCode));
		const picked = new Set<number>();

		for (let day = 1; day <= last; day++) {
			if (plain.has(weekdayCode(year, month, day))) picked.add(day);
		}

		for (const token of rule.byDay) {
			const ordinal = dayOrdinal(token);
			if (ordinal === 0) continue;
			const code = dayCode(token);
			const matching: number[] = [];
			for (let day = 1; day <= last; day++) {
				if (weekdayCode(year, month, day) === code) matching.push(day);
			}
			const day = ordinal < 0 ? matching[matching.length + ordinal] : matching[ordinal - 1];
			if (day !== undefined) picked.add(day);
		}

		days = [...picked].sort((a, b) => a - b);
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
		const startWeek = weekIndex(cursor.getTime());
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
				const week = weekIndex(cursor.getTime());
				matches =
					(week - startWeek) % parsed.interval === 0 &&
					// WEEKLY with no BYDAY recurs on the WEEKDAY the series started on,
					// per RFC 5545 — never on its day of the month. Comparing days of the
					// month made the rule fire roughly monthly, so a weekly event pulled
					// from a calendar that omits BYDAY (Apple's does) lost three of every
					// four occurrences, on screen and in the published feed alike.
					(parsed.byDay.length === 0
						? weekdayCode(year, month, day) === weekdayCode(anchor.year, anchor.month, anchor.day)
						: parsed.byDay.some((token) => dayCode(token) === weekdayCode(year, month, day)));
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
