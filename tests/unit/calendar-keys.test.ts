import { describe, expect, it } from 'vitest';
import { generatedKey, toRemoteId, type OriginBinding } from '$lib/calendar/keys';

const loanBinding: OriginBinding = { table: 'loan', rowId: 'abc', field: 'paymentDay' };

describe('generated event keys', () => {
	it('is stable for the same rule, row, field and month', () => {
		expect(generatedKey('loanPayments', loanBinding, '2026-09')).toBe(
			'gen:loanPayments:loan:abc:paymentDay:2026-09'
		);
		expect(generatedKey('loanPayments', loanBinding, '2026-09')).toBe(
			generatedKey('loanPayments', loanBinding, '2026-09')
		);
	});

	it('differs across months', () => {
		expect(generatedKey('loanPayments', loanBinding, '2026-09')).not.toBe(
			generatedKey('loanPayments', loanBinding, '2026-10')
		);
	});

	it('differs across rows', () => {
		const other: OriginBinding = { ...loanBinding, rowId: 'xyz' };
		expect(generatedKey('loanPayments', loanBinding, '2026-09')).not.toBe(
			generatedKey('loanPayments', other, '2026-09')
		);
	});

	// A tenancy end and a document expiry both come from the `expiry` rule. If the
	// key were built from the rule alone they would collide, and one would
	// overwrite the other on every sync.
	it('distinguishes two bindings under the same rule', () => {
		const tenancyEnd: OriginBinding = { table: 'tenancy', rowId: '1', field: 'endDate' };
		const docExpiry: OriginBinding = { table: 'document', rowId: '1', field: 'expiresOn' };
		expect(generatedKey('expiry', tenancyEnd)).not.toBe(generatedKey('expiry', docExpiry));
	});

	// Found in the live feed: 52 events, 51 distinct UIDs. One tenancy emits both a
	// lease-end and a renewal-notice event under the SAME rule and the SAME row,
	// so a key built from rule + table + row alone collides and the feed publishes
	// two events under one UID.
	it('distinguishes two fields of the same row under the same rule', () => {
		const end: OriginBinding = { table: 'tenancy', rowId: 't1', field: 'endDate' };
		const notice: OriginBinding = { table: 'tenancy', rowId: 't1', field: 'renewalNoticeDate' };
		expect(generatedKey('propertyDates', end)).not.toBe(generatedKey('propertyDates', notice));
	});

	it('handles a rule with no binding and no month', () => {
		expect(generatedKey('importReminder', null, '2026-09')).toBe('gen:importReminder:2026-09');
	});
});

describe('remote ids', () => {
	// Google accepts a client-supplied event id, but only in base32hex (RFC 4648
	// lowercase, characters a-v and 0-9) and at least 5 characters. Supplying our
	// own is what makes calendar_sync_link a cache rather than the source of
	// truth: lose it and a reconcile recomputes the same ids instead of
	// duplicating every event on someone's phone.
	it('produces only Google-legal characters', () => {
		for (const key of [
			'gen:loanPayments:loan:abc:2026-09',
			'gen:expiry:document:9f8e7d6c-1234-4567-89ab-cdef01234567',
			'550e8400-e29b-41d4-a716-446655440000'
		]) {
			expect(toRemoteId(key)).toMatch(/^[a-v0-9]{5,1024}$/);
		}
	});

	it('is deterministic', () => {
		expect(toRemoteId('gen:loanPayments:loan:abc:2026-09')).toBe(
			toRemoteId('gen:loanPayments:loan:abc:2026-09')
		);
	});

	it('is injective for keys that differ', () => {
		const keys = [
			'gen:loanPayments:loan:abc:2026-09',
			'gen:loanPayments:loan:abc:2026-10',
			'gen:loanPayments:loan:abd:2026-09',
			'gen:expiry:tenancy:1',
			'gen:expiry:document:1'
		];
		const ids = keys.map(toRemoteId);
		expect(new Set(ids).size).toBe(keys.length);
	});

	it('pads a very short key to the five-character minimum', () => {
		expect(toRemoteId('a').length).toBeGreaterThanOrEqual(5);
	});

	it('stays within the 1024-character maximum', () => {
		expect(toRemoteId('gen:expiry:document:' + 'x'.repeat(2000)).length).toBeLessThanOrEqual(1024);
	});
});
