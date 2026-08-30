// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import {
	addMonths,
	parsePeriodParams,
	periodQuery,
	previousRange,
	registerHref
} from '$lib/cashflow/period';
import { parseFilter, UNCATEGORISED } from '$lib/transactions/filter';

const params = (search: string) => new URLSearchParams(search);

describe('parsePeriodParams', () => {
	it('reads the window the URL asked for', () => {
		expect(parsePeriodParams(params('period=12m&anchor=2026-03'))).toEqual({
			period: '12m',
			anchor: '2026-03'
		});
	});

	// A stale bookmark and a hand-typed URL land here, and a screen that refuses
	// to render is a worse answer than the default window.
	it('falls back rather than failing on a window that does not exist', () => {
		expect(parsePeriodParams(params(''))).toEqual({ period: 'ytd', anchor: null });
		expect(parsePeriodParams(params('period=quarter')).period).toBe('ytd');
		expect(parsePeriodParams(params('period=')).period).toBe('ytd');
	});

	// The anchor reaches SQL as the bounds of a date range, so a month that does
	// not exist has to be a month nobody named.
	it('keeps only a well-formed anchor month', () => {
		expect(parsePeriodParams(params('anchor=2026-13')).anchor).toBeNull();
		expect(parsePeriodParams(params('anchor=2026-00')).anchor).toBeNull();
		expect(parsePeriodParams(params('anchor=2026-3')).anchor).toBeNull();
		expect(parsePeriodParams(params('anchor=2026-03-01')).anchor).toBeNull();
		expect(parsePeriodParams(params('anchor=')).anchor).toBeNull();
		expect(parsePeriodParams(params('anchor=2026-12')).anchor).toBe('2026-12');
	});
});

describe('addMonths', () => {
	it('steps within a year', () => {
		expect(addMonths('2026-03', 1)).toBe('2026-04');
		expect(addMonths('2026-03', -1)).toBe('2026-02');
	});

	it('rolls the year at either end of December', () => {
		expect(addMonths('2026-12', 1)).toBe('2027-01');
		expect(addMonths('2026-01', -1)).toBe('2025-12');
		expect(addMonths('2026-07', -12)).toBe('2025-07');
	});
});

/**
 * The window a window is compared against.
 *
 * Every case here asserts the same thing in a different shape: the previous
 * window is the SAME window, moved. A trailing year compared against the eleven
 * months before it, or a year-to-date compared against a full previous year,
 * would report the difference in how much time each covered as a change in what
 * the household did.
 */
describe('previousRange', () => {
	it('compares a month with the month before it, across a year boundary too', () => {
		expect(previousRange('month', '2026-03')).toEqual({
			start: '2026-02-01',
			end: '2026-02-28',
			caption: 'February 2026'
		});
		expect(previousRange('month', '2026-01')).toEqual({
			start: '2025-12-01',
			end: '2025-12-31',
			caption: 'December 2025'
		});
	});

	it('compares the year to date with the same months a year earlier', () => {
		expect(previousRange('ytd', '2026-07')).toEqual({
			start: '2025-01-01',
			end: '2025-07-31',
			caption: 'January – July 2025'
		});
	});

	it('compares a trailing year with the twelve months before it', () => {
		expect(previousRange('12m', '2026-07')).toEqual({
			start: '2024-08-01',
			end: '2025-07-31',
			caption: 'August 2024 – July 2025'
		});
	});
});

describe('periodQuery', () => {
	it('names the window, and the month it ends on when one was chosen', () => {
		expect(periodQuery('month', '2026-03')).toBe('?period=month&anchor=2026-03');
		expect(periodQuery('12m', '2026-03')).toBe('?period=12m&anchor=2026-03');
	});

	// Absent is not the same as empty: no anchor means "the newest month with
	// data", which is a window the screen has to be able to ask for again.
	it('leaves the anchor out when there is none', () => {
		expect(periodQuery('ytd', null)).toBe('?period=ytd');
	});
});

/**
 * The link a figure on the waterfall carries, and the filter the register reads
 * back out of it.
 *
 * Both halves are asserted here rather than only the string, because the string
 * is not the point: what matters is that the register answers the question the
 * chart asked. A param renamed on one side and not the other would still
 * produce a perfectly well-formed URL.
 */
const query = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));

describe('registerHref', () => {
	it('scopes a category to the period, with the anchor month open', () => {
		expect(
			registerHref({ category: 'rent', from: '2026-03-01', to: '2026-03-31', month: '2026-03' })
		).toBe('/transactions?category=rent&from=2026-03-01&to=2026-03-31&month=2026-03');
	});

	it('writes the params in one order, so two identical links read identically', () => {
		expect(
			registerHref({
				group: 'housing',
				dir: 'out',
				from: '2026-01-01',
				to: '2026-03-31',
				month: '2026-03'
			})
		).toBe('/transactions?group=housing&dir=out&from=2026-01-01&to=2026-03-31&month=2026-03');
	});

	it('leaves out what it was not given, rather than writing empty params', () => {
		expect(registerHref({ group: 'housing' })).toBe('/transactions?group=housing');
		expect(registerHref({ category: null, group: null, month: null })).toBe('/transactions');
		expect(registerHref({})).toBe('/transactions');
	});

	// An id or a group key is not guaranteed to be URL-safe, and a household
	// names its own groups now.
	it('escapes what it is given', () => {
		const href = registerHref({ group: 'food & drink' });
		expect(href).toBe('/transactions?group=food+%26+drink');
		expect(query(href).get('group')).toBe('food & drink');
	});

	describe('the register reads back what the chart asked for', () => {
		it('a category, its period and its open month', () => {
			const filter = parseFilter(
				query(
					registerHref({ category: 'rent', from: '2026-03-01', to: '2026-03-31', month: '2026-03' })
				),
				'CZK'
			);
			expect(filter.categoryId).toBe('rent');
			expect(filter.groupKey).toBeNull();
			expect(filter.from).toBe('2026-03-01');
			expect(filter.to).toBe('2026-03-31');
			expect(filter.month).toBe('2026-03');
			expect(filter.direction).toBe('any');
		});

		it('a whole group, in one direction', () => {
			const filter = parseFilter(query(registerHref({ group: 'housing', dir: 'in' })), 'CZK');
			expect(filter.groupKey).toBe('housing');
			expect(filter.categoryId).toBeNull();
			expect(filter.direction).toBe('in');
		});

		// The sentinel is the register's own, so the chart must not spell it a
		// second time: an unfiled bucket links through the same constant.
		it('the unfiled bucket', () => {
			const filter = parseFilter(
				query(registerHref({ category: UNCATEGORISED, dir: 'out' })),
				'CZK'
			);
			expect(filter.categoryId).toBe(UNCATEGORISED);
			expect(filter.direction).toBe('out');
		});
	});
});
