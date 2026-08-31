// SPDX-License-Identifier: AGPL-3.0-or-later
// The cash-flow period: which window a screen is looking at, how a URL says so,
// and the way back from a figure in the window to the rows it came from.
//
// Pure and client-safe on purpose: the waterfall is drawn in the browser and
// its controls navigate from there, so nothing here may reach for the database.
// Every screen that turns a figure into "show me the transactions behind it"
// goes through this one helper, so a param the register renames is a change in
// two files rather than in nine — and the period arithmetic sits beside it for
// the same reason, since the loader and the control have to agree on which
// months a window covers or the caption stops matching the figures.

import type { Direction } from '$lib/transactions/filter';

/** Where the register lives. */
const REGISTER = '/transactions';

/** The windows a cash-flow screen can be looking at. */
export const PERIODS = ['ytd', 'month', '12m'] as const;

export type Period = (typeof PERIODS)[number];

/** What a screen falls back to when the URL names no window, or an unknown one. */
const DEFAULT_PERIOD: Period = 'ytd';

/** How many months the trailing window covers, its anchor month included. */
const TRAILING_MONTHS = 12;

/**
 * A month a URL may anchor a window on, as `YYYY-MM`.
 *
 * Matched strictly rather than loosely, because the month it names becomes the
 * bounds of a date range in SQL, and "2026-13" is a window nobody can be shown.
 */
const ANCHOR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The months an instance holds data for, both ends inclusive, as `YYYY-MM`. */
export interface MonthSpan {
	earliest: string;
	latest: string;
}

/**
 * What the URL says about the window, in the two params every cash-flow screen
 * reads: which period, and which month it ends on.
 *
 * Neither is trusted, and neither throws. An unknown period and a malformed
 * anchor are the same kind of thing — a stale bookmark, a hand-typed URL — and
 * a screen that refuses to render is a worse answer than the default window.
 * The API is the one caller that checks the period itself first, because a
 * client asking over the wire can fix its call once it is told.
 */
export function parsePeriodParams(params: URLSearchParams): {
	period: Period;
	anchor: string | null;
} {
	const asked = params.get('period') as Period | null;
	const anchor = params.get('anchor');
	return {
		period: asked !== null && PERIODS.includes(asked) ? asked : DEFAULT_PERIOD,
		anchor: anchor !== null && ANCHOR_MONTH.test(anchor) ? anchor : null
	};
}

/**
 * A `YYYY-MM` month moved by whole months, in either direction.
 *
 * Date.UTC normalises a month index outside 0–11 by rolling the year, so
 * stepping off either end of December needs no arithmetic of its own.
 */
export function addMonths(month: string, delta: number): string {
	const shifted = new Date(
		Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1)
	);
	return shifted.toISOString().slice(0, 7);
}

/**
 * `YYYY-MM` as "July 2026".
 *
 * Read in UTC, because the first of the month parsed as an instant and printed
 * in a timezone behind it is the last day of the month before — which would
 * name the wrong month for half the world for one day in thirty.
 */
export function monthLabel(month: string): string {
	return new Date(`${month}-01T00:00:00Z`).toLocaleString('en', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

/**
 * The query that puts a window in the URL, so the back button and a pasted link
 * both mean something.
 *
 * The anchor is left out when there is none rather than written empty: no
 * anchor means "the newest month with data", which is a different window from
 * any month somebody named, and the screen has to be able to ask for it again.
 */
export function periodQuery(period: Period, anchor: string | null): string {
	const search = new URLSearchParams({ period });
	if (anchor) search.set('anchor', anchor);
	return `?${search}`;
}

/**
 * The window a period covers, anchored on a month rather than on the calendar.
 *
 * Statements arrive after a month ends, so "this month" is routinely empty and
 * both the Money screen and the Overview panel rendered nothing at all.
 * Anchoring on the data means a household mid-way through importing sees July
 * and is told, in the caption, that it is looking at July.
 *
 * `anchorMonth` is null only on an instance with no transactions, where falling
 * back to today keeps the empty state exactly as it was.
 */
export function periodRange(
	period: Period,
	anchorMonth: string | null,
	today = new Date()
): { start: string; end: string; caption: string } {
	const anchor = anchorMonth
		? new Date(Date.UTC(Number(anchorMonth.slice(0, 4)), Number(anchorMonth.slice(5, 7)) - 1, 1))
		: today;
	// UTC throughout. The previous version read the year and month in local time
	// and then built the boundaries with Date.UTC, which lands on the wrong month
	// for anyone west of UTC during the first hours of one.
	const y = anchor.getUTCFullYear();
	const m = anchor.getUTCMonth();
	const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
	const monthName = (index: number) =>
		new Date(Date.UTC(2000, index, 1)).toLocaleString('en', { month: 'long' });

	if (period === 'month') {
		return {
			start: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
			end,
			caption: `${monthName(m)} ${y}`
		};
	}
	if (period === '12m') {
		// Twelve months counting the anchor, not twelve months before it: a window
		// running from July to July a year later holds one month twice and reports
		// the repeat as a trend.
		const first = new Date(Date.UTC(y, m - (TRAILING_MONTHS - 1), 1));
		return {
			start: first.toISOString().slice(0, 10),
			end,
			// Both ends carry their year. A trailing year almost always crosses one,
			// and spelling it out on the December anchor that does not costs a word
			// where leaving it off costs the reader a guess.
			caption: `${monthName(first.getUTCMonth())} ${first.getUTCFullYear()} – ${monthName(m)} ${y}`
		};
	}
	return { start: `${y}-01-01`, end, caption: `January – ${monthName(m)} ${y}` };
}

/**
 * The window this window is compared against: the same one, moved back.
 *
 * Built by re-anchoring `periodRange` rather than by subtracting dates, so the
 * comparison window is the same SHAPE as the one on screen by construction. A
 * year-to-date that ran to July compared against a full previous year, or a
 * trailing year against the eleven months before it, would report the
 * difference in how much time each covered as a change in what the household
 * did.
 *
 * A month steps back one month; the two longer windows step back a year, which
 * puts the trailing year on the twelve months before it and the year to date on
 * the same months of the previous year. The anchor is required: a window with
 * no anchor is an instance with nothing in it, and there is no earlier window
 * to compare an empty one with.
 */
export function previousRange(
	period: Period,
	anchor: string
): { start: string; end: string; caption: string } {
	return periodRange(period, addMonths(anchor, period === 'month' ? -1 : -TRAILING_MONTHS));
}

/**
 * What a link into the register may narrow by.
 *
 * A subset of the register's own filter — the part a figure on a chart can
 * actually say. Everything else the register offers is a question somebody asks
 * once they are there.
 */
export interface RegisterHrefParams {
	/** A category id, or the register's uncategorised sentinel. */
	category?: string | null;
	/** A category group key: every category filed under it, at once. */
	group?: string | null;
	/** One side of the ledger, in the register's own vocabulary. */
	dir?: Direction | null;
	/** Inclusive ISO bounds, as the period the figure was drawn for. */
	from?: string | null;
	to?: string | null;
	/** Which month the register opens, as `YYYY-MM`. */
	month?: string | null;
}

/**
 * The register, narrowed to what a figure on the chart stands for.
 *
 * Built with URLSearchParams rather than by pasting strings together, because a
 * household names its own groups and a name with an ampersand in it would
 * otherwise silently become two params. The order is fixed — what narrows
 * first, then the period — so two links to the same rows are the same string
 * and the browser can tell you have been there.
 */
export function registerHref(params: RegisterHrefParams): string {
	const search = new URLSearchParams();
	// Absent and empty are the same thing to the register, which reads a blank
	// param as "no opinion", so neither is written at all.
	const narrow = (key: string, value: string | null | undefined) => {
		if (value) search.set(key, value);
	};

	narrow('category', params.category);
	narrow('group', params.group);
	narrow('dir', params.dir);
	narrow('from', params.from);
	narrow('to', params.to);
	narrow('month', params.month);

	const query = search.toString();
	return query ? `${REGISTER}?${query}` : REGISTER;
}
