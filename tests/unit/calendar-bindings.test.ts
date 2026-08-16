import { describe, expect, it } from 'vitest';
import { bindingIsWritable, writeBackValue } from '$lib/server/calendar/bindings';
import type { OriginBinding } from '$lib/calendar/keys';

const loan: OriginBinding = { table: 'loan', rowId: 'l1', field: 'paymentDay' };
const leaseEnd: OriginBinding = { table: 'tenancy', rowId: 't1', field: 'endDate' };
const notice: OriginBinding = { table: 'tenancy', rowId: 't1', field: 'renewalNoticeDate' };
const docExpiry: OriginBinding = { table: 'document', rowId: 'd1', field: 'expiresOn' };
const fixation: OriginBinding = { table: 'loanFixationPeriod', rowId: 'p1', field: 'endDate' };

describe('which bindings accept a write-back', () => {
	it('accepts the three date fields that are genuinely a scheduling fact', () => {
		expect(bindingIsWritable(loan)).toBe(true);
		expect(bindingIsWritable(leaseEnd)).toBe(true);
		expect(bindingIsWritable(notice)).toBe(true);
		expect(bindingIsWritable(docExpiry)).toBe(true);
	});

	// A fixation period has a row, and moving its end re-cuts the interest
	// schedule. Dragging an event in a phone calendar is not a statement about
	// amortisation.
	it('refuses a fixation period even though it has a row', () => {
		expect(bindingIsWritable(fixation)).toBe(false);
	});

	it('refuses an unbound event', () => {
		expect(bindingIsWritable(null)).toBe(false);
	});

	// Nothing but the named field. A binding naming something else is either a
	// bug or an attempt to reach further than write-back is meant to.
	it('refuses a field that was never opened for write-back', () => {
		expect(bindingIsWritable({ table: 'loan', rowId: 'l1', field: 'owedMinor' })).toBe(false);
		expect(bindingIsWritable({ table: 'document', rowId: 'd1', field: 'name' })).toBe(false);
	});
});

describe('what gets written', () => {
	// paymentDay is a day-of-month integer, so the DATE has to become a number.
	it('extracts the day of month for a loan payment day', () => {
		expect(writeBackValue(loan, '2026-09-20')).toBe(20);
		expect(writeBackValue(loan, '2026-09-01')).toBe(1);
	});

	it('keeps the whole date for a single-date field', () => {
		expect(writeBackValue(leaseEnd, '2026-09-20')).toBe('2026-09-20');
		expect(writeBackValue(docExpiry, '2027-01-05')).toBe('2027-01-05');
	});

	it('gives nothing for a field that cannot be written', () => {
		expect(writeBackValue(fixation, '2026-09-20')).toBeNull();
		expect(writeBackValue(null, '2026-09-20')).toBeNull();
	});

	it('refuses a date it cannot read', () => {
		expect(writeBackValue(leaseEnd, 'not-a-date')).toBeNull();
		expect(writeBackValue(loan, '')).toBeNull();
	});
});
