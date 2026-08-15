import { describe, expect, it } from 'vitest';
import { parseFilter } from '$lib/transactions/filter';

// The register's whole state lives in the URL, so parsing is the seam worth
// testing: every screen behaviour follows from what these params turn into.
function params(qs: string): URLSearchParams {
	return new URLSearchParams(qs);
}

describe('parseFilter', () => {
	it('returns the empty-state defaults when no params are set', () => {
		const filter = parseFilter(params(''), 'CZK');

		expect(filter).toEqual({
			search: null,
			from: null,
			to: null,
			accountId: null,
			categoryId: null,
			direction: 'any',
			minMinor: null,
			maxMinor: null,
			reviewState: null,
			tagId: null,
			baseFactor: '100',
			includeTransfers: false,
			page: 1
		});
	});

	it('reads the tag filter', () => {
		expect(parseFilter(params('tag=reno'), 'CZK').tagId).toBe('reno');
	});

	it('trims the search text and treats a blank search as absent', () => {
		expect(parseFilter(params('q=%20%20albert%20%20'), 'CZK').search).toBe('albert');
		expect(parseFilter(params('q=%20%20'), 'CZK').search).toBeNull();
	});

	it('keeps well-formed dates and drops malformed ones', () => {
		const good = parseFilter(params('from=2026-03-01&to=2026-03-31'), 'CZK');
		expect(good.from).toBe('2026-03-01');
		expect(good.to).toBe('2026-03-31');

		const bad = parseFilter(params('from=march&to=2026-13-45'), 'CZK');
		expect(bad.from).toBeNull();
		expect(bad.to).toBeNull();
	});

	it('reads amounts in the base currency as absolute minor-unit bounds', () => {
		const filter = parseFilter(params('min=45,50&max=1%20200'), 'CZK');
		expect(filter.minMinor).toBe(4550n);
		expect(filter.maxMinor).toBe(120000n);
	});

	it('ignores the sign on amount bounds, since direction carries it', () => {
		expect(parseFilter(params('min=-45.50'), 'CZK').minMinor).toBe(4550n);
	});

	it('drops an unparseable amount rather than throwing', () => {
		expect(() => parseFilter(params('min=lots'), 'CZK')).not.toThrow();
		expect(parseFilter(params('min=lots'), 'CZK').minMinor).toBeNull();
	});

	it('accepts only known directions and review states', () => {
		expect(parseFilter(params('dir=out'), 'CZK').direction).toBe('out');
		expect(parseFilter(params('dir=sideways'), 'CZK').direction).toBe('any');
		expect(parseFilter(params('review=needs_review'), 'CZK').reviewState).toBe('needs_review');
		expect(parseFilter(params('review=whatever'), 'CZK').reviewState).toBeNull();
	});

	it('shows own-account transfers only when asked', () => {
		expect(parseFilter(params('transfers=1'), 'CZK').includeTransfers).toBe(true);
		expect(parseFilter(params('transfers=0'), 'CZK').includeTransfers).toBe(false);
	});

	it('clamps the page to a positive whole number', () => {
		expect(parseFilter(params('page=3'), 'CZK').page).toBe(3);
		expect(parseFilter(params('page=0'), 'CZK').page).toBe(1);
		expect(parseFilter(params('page=-2'), 'CZK').page).toBe(1);
		expect(parseFilter(params('page=later'), 'CZK').page).toBe(1);
	});

	it('bounds the page above, so an absurd one cannot reach SQL as an offset', () => {
		// Number.isInteger(1e21) is true, so an integerness check alone let
		// ?page=1e21 render as OFFSET 5e+22 and Postgres rejected the statement:
		// a 500 from a hand-edited URL.
		const huge = parseFilter(params('page=1e21'), 'CZK').page;
		expect(Number.isSafeInteger(huge)).toBe(true);
		expect(huge).toBeLessThanOrEqual(1_000_000);
		expect(String((huge - 1) * 50)).not.toContain('e');
		expect(parseFilter(params('page=999999999999'), 'CZK').page).toBeLessThanOrEqual(1_000_000);
	});

	it('passes account through and reads the uncategorised sentinel', () => {
		expect(parseFilter(params('account=acc-1'), 'CZK').accountId).toBe('acc-1');
		expect(parseFilter(params('category=none'), 'CZK').categoryId).toBe('none');
	});
});
