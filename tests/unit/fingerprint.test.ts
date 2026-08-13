import { describe, expect, it } from 'vitest';
import { fingerprintAll } from '$lib/server/import/fingerprint';
import type { ParsedRow } from '$lib/server/import/types';

// The occurrence counter is the hardest-to-reason-about mechanism in dedup —
// these tests pin the properties a seven-year backfill relies on.

function row(partial: Partial<ParsedRow>): ParsedRow {
	return { bookedAt: '2026-07-14', amountMinor: -3000n, currency: 'CZK', ...partial };
}

describe('fingerprint occurrence counter', () => {
	it('identical weak-identity rows get distinct, deterministic fingerprints', () => {
		const rows = [row({}), row({}), row({})]; // three identical tram tickets
		const prints = fingerprintAll(rows);
		expect(new Set(prints).size).toBe(3);
		expect(fingerprintAll(rows)).toEqual(prints);
	});

	it('is permutation-invariant as a multiset: any ordering yields the same set', () => {
		const a = row({ counterparty: 'ATM PRAHA' });
		const b = row({ counterparty: 'ATM PRAHA' });
		const c = row({ counterparty: 'ALBERT' });
		const set1 = new Set(fingerprintAll([a, b, c]));
		const set2 = new Set(fingerprintAll([c, b, a]));
		expect(set1).toEqual(set2);
	});

	it('a partial statement then a fuller one dedups the overlap and adds the rest', () => {
		// First upload saw 2 of 3 identical rows; the re-upload has all 3.
		const partial = fingerprintAll([row({}), row({})]);
		const full = fingerprintAll([row({}), row({}), row({})]);
		expect(full.slice(0, 2)).toEqual(partial);
		expect(new Set(full).size).toBe(3);
	});

	it('rows on different days never share a counter partition', () => {
		const prints = fingerprintAll([row({}), row({ bookedAt: '2026-07-15' })]);
		expect(new Set(prints).size).toBe(2);
		// and each equals its own zero-occurrence fingerprint
		expect(fingerprintAll([row({})])[0]).toBe(prints[0]);
	});

	it('a bank reference dominates: differing refs separate, identical refs collapse', () => {
		const withRef = [row({ bankRef: 'A1' }), row({ bankRef: 'A2' })];
		expect(new Set(fingerprintAll(withRef)).size).toBe(2);
		// The same ref twice IS the same movement — a statement listing it
		// twice dedups to one row, by design.
		const dupRef = fingerprintAll([row({ bankRef: 'A1' }), row({ bankRef: 'A1' })]);
		expect(new Set(dupRef).size).toBe(1);
	});

	it('the running balance separates otherwise identical rows without a counter', () => {
		const prints = fingerprintAll([
			row({ balanceAfterMinor: 100000n }),
			row({ balanceAfterMinor: 97000n })
		]);
		expect(new Set(prints).size).toBe(2);
	});
});
