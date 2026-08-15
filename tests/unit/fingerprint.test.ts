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

	it('a bank reference dominates, but does not disable the counter', () => {
		const withRef = [row({ bankRef: 'A1' }), row({ bankRef: 'A2' })];
		expect(new Set(fingerprintAll(withRef)).size).toBe(2);
		// Two rows sharing a reference are still two rows. bankRef is only as
		// unique as the bank makes it — a split card authorisation, or one
		// instruction number printed on both legs of an order, repeats it.
		// Collapsing them here let the unique index drop the second row, so
		// real money left the ledger reported as a skipped duplicate.
		const dupRef = fingerprintAll([row({ bankRef: 'A1' }), row({ bankRef: 'A1' })]);
		expect(new Set(dupRef).size).toBe(2);
	});

	it('re-importing a file with a repeated reference still dedups', () => {
		// The counter is assigned in statement order, so the same file yields
		// the same pair of fingerprints every time.
		const first = fingerprintAll([row({ bankRef: 'A1' }), row({ bankRef: 'A1' })]);
		expect(fingerprintAll([row({ bankRef: 'A1' }), row({ bankRef: 'A1' })])).toEqual(first);
	});

	// Pinned literals, not self-comparisons: these are the exact digests rows
	// already carry at FINGERPRINT_VERSION 2. Adding the occurrence counter to
	// the reference branch must not disturb them, or every stored row would
	// need re-fingerprinting and re-imported statements would duplicate.
	it('fingerprints already stored at version 2 are unchanged', () => {
		expect(fingerprintAll([row({ bankRef: 'A1' })])[0]).toBe(
			'ce0b2825d26ad068c6f03be8b470dd513c11afdf0f02113750e0b517792556ca'
		);
		expect(fingerprintAll([row({})])[0]).toBe(
			'f134dbb8f87074b8046cd50a5fbb4462576a4ddf72bda51c2da5f2aad4b2a589'
		);
	});

	it('the running balance separates otherwise identical rows without a counter', () => {
		const prints = fingerprintAll([
			row({ balanceAfterMinor: 100000n }),
			row({ balanceAfterMinor: 97000n })
		]);
		expect(new Set(prints).size).toBe(2);
	});
});
