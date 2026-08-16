import { describe, expect, it } from 'vitest';
import { icsUid } from '$lib/server/calendar';

/**
 * The published feed's event identity.
 *
 * UIDs used to be `${day}-${index}@continuum-ledger` — the event's POSITION in
 * the generated array. Adding a loan renumbers everything after it on that day,
 * so a subscribed calendar sees the old events deleted and new ones created.
 * Churn in a read-only feed; under two-way sync it would be duplication and
 * data loss, because the remote side keys on exactly this value.
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
