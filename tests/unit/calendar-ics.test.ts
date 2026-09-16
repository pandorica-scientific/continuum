import { describe, expect, it } from 'vitest';
import { icsUid } from '$lib/server/calendar';

/**
 * The published feed's event identity.
 *
 * Must be derived from the event's key, never its position: a UID keyed on
 * array index renumbers on every insert, causing churn in a read-only feed
 * and duplication or data loss under two-way sync.
 */
describe('ics uid', () => {
	it('is derived from the event key, not its position', () => {
		expect(icsUid('gen:loanPayments:loan:abc:2026-09')).toBe(
			'gen:loanPayments:loan:abc:2026-09@continuum-ledger'
		);
	});

	it('does not change when an unrelated event is added on the same day', () => {
		const before = ['gen:loanPayments:loan:abc:2026-09', 'gen:expiry:document:d1'];
		const after = ['gen:loanPayments:loan:zzz:2026-09', ...before];
		const uid = (key: string) => icsUid(key);
		for (const key of before) expect(after.map(uid)).toContain(uid(key));
	});

	it('never produces the old index-based shape', () => {
		expect(icsUid('gen:expiry:tenancy:t1')).not.toMatch(/^\d{8}-\d+@/);
	});

	// A UID goes into the feed verbatim on its own line. A newline in it would end
	// the property early and let the rest of the value be read as iCalendar.
	it('strips characters that would break the iCalendar line', () => {
		expect(icsUid('gen:x\r\nSUMMARY:injected')).not.toMatch(/[\r\n]/);
	});
});
