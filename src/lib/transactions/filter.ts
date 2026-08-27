// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The transaction register keeps all of its state in the URL, so a view is
// linkable and the back button behaves. This module is the only place that
// knows how those params map onto a filter — pure, so it is testable without
// a database, in keeping with the src/lib split.

import { ENUMS, isEnumValue, type EnumValue } from '$lib/enums';
import type { Hue } from '$lib/ui/hue';

import { parseAmountToMinor } from '$lib/money';

export type Direction = 'any' | 'in' | 'out';

export interface RegisterFilter {
	/** Free text matched against counterparty, description and the symbols. */
	search: string | null;
	/** Inclusive ISO dates (yyyy-mm-dd). */
	from: string | null;
	to: string | null;
	accountId: string | null;
	categoryId: string | null;
	direction: Direction;
	/** Absolute bounds in minor units of the base currency. */
	minMinor: bigint | null;
	maxMinor: bigint | null;
	/** Currency in which amount bounds were entered. */
	baseCurrency: string;
	reviewState: EnumValue<'transaction.review_state'> | null;
	/** Matches a transaction tagged directly or through any of its splits. */
	tagId: string | null;
	/** Own-account transfers are hidden unless asked for, as in cash flow. */
	includeTransfers: boolean;
	/**
	 * How the row was read — `adapter`, `standard`, `pdf-rhythm`, and so on.
	 *
	 * Worth filtering on because the readings are not equally strong: a row that
	 * came from pixels, or from a reading whose fields had to be rejoined, is
	 * worth a second look in a way that a row from a CAMT.053 export is not. The
	 * ledger records this per row precisely so the question can be asked.
	 */
	sourceMethod: string | null;
	/**
	 * Which month the register has expanded, as `YYYY-MM`, or null for none.
	 *
	 * Deliberately NOT a date filter, though it narrows on the same column. The
	 * register lists a month per row and pages that list on its own; `month` says
	 * which of those rows is open, and so narrows the transactions loaded and
	 * nothing else. The month summaries are always computed with it cleared —
	 * a register listing only the month it had expanded would have nothing left
	 * to expand into.
	 */
	month: string | null;
	page: number;
	/** How many rows one page holds. One of PAGE_SIZES. */
	pageSize: number;
}

/**
 * The page sizes the register offers.
 *
 * A closed set, not a free number: the value reaches SQL as a LIMIT, and it is
 * the URL — the one part of this filter anybody can hand-edit — that carries
 * it. `?per=1000000` would otherwise be a request to render the whole ledger.
 */
export const PAGE_SIZES = [10, 25, 50] as const;

/** Used when the URL says nothing. */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * The review states the schema allows; anything else in the URL is noise.
 *
 * Derived rather than listed. This was written out by hand and omitted `filed` —
 * a state the demo seed writes and `ingest.ts` treats as terminal beside
 * `confirmed` — so a filed transaction could not be selected by any filter on
 * the register, and the comment above claiming otherwise was simply false.
 */
export const REVIEW_STATES = ENUMS['transaction.review_state'];

type ReviewState = EnumValue<'transaction.review_state'>;

/**
 * What each review state is called on screen.
 *
 * A complete Record, so a state added to the enum stops the build here rather
 * than showing up as a blank pill and an empty option in the filter — which is
 * exactly what `filed` did while this map lived in the page and named three of
 * the four.
 */
export const REVIEW_LABELS: Record<ReviewState, string> = {
	auto: 'filed by rule',
	needs_review: 'needs a look',
	confirmed: 'confirmed',
	filed: 'filed'
};

/**
 * The hue each state is shown in.
 *
 * Green, amber and red mean state here as everywhere else, so only a verdict
 * takes one: settled is green, waiting on somebody is amber. Filed by rule is
 * the ordinary case — most of a register is in it, and a coloured pill on every
 * line is noise rather than information.
 */
export const REVIEW_HUES: Record<ReviewState, Hue> = {
	auto: 'grey',
	needs_review: 'yellow',
	confirmed: 'green',
	filed: 'green'
};

const DIRECTIONS: Direction[] = ['any', 'in', 'out'];

/** The category param value standing for "no category at all". */
export const UNCATEGORISED = 'none';

function text(params: URLSearchParams, key: string): string | null {
	const raw = params.get(key)?.trim();
	return raw ? raw : null;
}

/** An ISO date that is also a real calendar day — `2026-13-45` is neither. */
function isoDate(params: URLSearchParams, key: string): string | null {
	const raw = text(params, key);
	if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
	const parsed = new Date(`${raw}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

/** A `YYYY-MM` month, with a month number that exists. */
function isoMonth(params: URLSearchParams, key: string): string | null {
	const raw = text(params, key);
	return raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : null;
}

/**
 * The first day of the month AFTER the one given.
 *
 * A half-open upper bound, so the month's own length never has to be worked
 * out — no leap year, no 30-versus-31. Exported because the register's SQL and
 * its tests both need the same answer.
 */
export function monthAfter(month: string): string {
	const [year, index] = month.split('-').map(Number);
	return index === 12 ? `${year + 1}-01-01` : `${year}-${String(index + 1).padStart(2, '0')}-01`;
}

/** Bounds are magnitudes — the sign is the direction filter's job. */
function bound(params: URLSearchParams, key: string, baseCurrency: string): bigint | null {
	const raw = text(params, key);
	if (!raw) return null;
	try {
		const minor = parseAmountToMinor(raw, baseCurrency);
		return minor < 0n ? -minor : minor;
	} catch {
		// A hand-edited or stale URL must narrow nothing, never break the page.
		return null;
	}
}

// Far beyond any real ledger, and small enough that page × page size stays an
// offset Postgres will accept. The server narrows this again once it knows the
// real page count.
const MAX_PAGE = 1_000_000;

export function parseFilter(params: URLSearchParams, baseCurrency: string): RegisterFilter {
	const direction = params.get('dir') as Direction | null;
	const review = text(params, 'review');
	const page = Number(params.get('page'));
	const per = Number(params.get('per'));

	return {
		search: text(params, 'q'),
		from: isoDate(params, 'from'),
		to: isoDate(params, 'to'),
		accountId: text(params, 'account'),
		categoryId: text(params, 'category'),
		direction: direction && DIRECTIONS.includes(direction) ? direction : 'any',
		minMinor: bound(params, 'min', baseCurrency),
		maxMinor: bound(params, 'max', baseCurrency),
		baseCurrency,
		reviewState: isEnumValue('transaction.review_state', review) ? review : null,
		tagId: text(params, 'tag'),
		includeTransfers: params.get('transfers') === '1',
		sourceMethod: text(params, 'source'),
		month: isoMonth(params, 'month'),
		// Clamped, not merely checked for integerness: Number.isInteger(1e21) is
		// true, so ?page=1e21 rendered as OFFSET 5e+22 and Postgres rejected the
		// statement — a 500 from a hand-edited URL.
		page: Number.isInteger(page) && page > 0 ? Math.min(page, MAX_PAGE) : 1,
		// Membership, not a range check: anything else is a stale or hand-edited
		// URL, and falling back is the only sound reading of it.
		pageSize: (PAGE_SIZES as readonly number[]).includes(per) ? per : DEFAULT_PAGE_SIZE
	};
}
