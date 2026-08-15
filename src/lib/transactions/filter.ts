// The transaction register keeps all of its state in the URL, so a view is
// linkable and the back button behaves. This module is the only place that
// knows how those params map onto a filter — pure, so it is testable without
// a database, in keeping with the src/lib split.

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
	reviewState: string | null;
	/** Matches a transaction tagged directly or through any of its splits. */
	tagId: string | null;
	/** Own-account transfers are hidden unless asked for, as in cash flow. */
	includeTransfers: boolean;
	page: number;
}

/** The review states the schema allows; anything else in the URL is noise. */
export const REVIEW_STATES = ['auto', 'needs_review', 'confirmed'] as const;

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

// Far beyond any real ledger, and small enough that page × PAGE_SIZE stays an
// offset Postgres will accept. The server narrows this again once it knows the
// real page count.
const MAX_PAGE = 1_000_000;

export function parseFilter(params: URLSearchParams, baseCurrency: string): RegisterFilter {
	const direction = params.get('dir') as Direction | null;
	const review = text(params, 'review');
	const page = Number(params.get('page'));

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
		reviewState: review && REVIEW_STATES.includes(review as never) ? review : null,
		tagId: text(params, 'tag'),
		includeTransfers: params.get('transfers') === '1',
		// Clamped, not merely checked for integerness: Number.isInteger(1e21) is
		// true, so ?page=1e21 rendered as OFFSET 5e+22 and Postgres rejected the
		// statement — a 500 from a hand-edited URL.
		page: Number.isInteger(page) && page > 0 ? Math.min(page, MAX_PAGE) : 1
	};
}
