import { describe, expect, it } from 'vitest';
import { decorate, markerForGenerated, SOURCE_TAG, strip } from '$lib/calendar/markers';
import { EVENT_CATEGORIES, MODULES } from '$lib/modules/registry';
import type { OriginBinding } from '$lib/calendar/keys';

describe('decorating a summary', () => {
	it('puts the emoji in front and the source tag behind', () => {
		expect(decorate('ČS mortgage payment', '💳', true)).toBe('💳 ČS mortgage payment · Continuum');
	});

	// The tag means exactly "the ledger wrote this". An authored event must not
	// claim it, or the signal stops being worth anything.
	it('omits the source tag for authored events', () => {
		expect(decorate('Dentist', '🏥', false)).toBe('🏥 Dentist');
	});

	it('handles an event with no marker', () => {
		expect(decorate('Dentist', null, false)).toBe('Dentist');
		expect(decorate('Something', null, true)).toBe('Something · Continuum');
	});
});

// strip() feeds the content hash the sync merge compares against. If decoration
// survived into the hash, every event would read as changed on every pass: the
// engine pushes, the remote echoes it back, and it pushes again — forever, and
// silently, showing up as rate-limit exhaustion rather than an error.
describe('stripping decoration back off', () => {
	it('round-trips whatever decorate produced', () => {
		for (const [label, marker, tag] of [
			['ČS mortgage payment', '💳', true],
			['Dentist', '🏥', false],
			['No marker at all', null, true],
			['Plain', null, false]
		] as const) {
			expect(strip(decorate(label, marker, tag), marker)).toBe(label);
		}
	});

	it('strips a multi-codepoint emoji with a variation selector', () => {
		// 🗂️ is U+1F5C2 plus U+FE0F. Matching one codepoint leaves the selector
		// behind, and the hash then never matches on either side.
		expect(strip('🗂️ Passport expires · Continuum', '🗂️')).toBe('Passport expires');
	});

	it('leaves an undecorated summary untouched', () => {
		expect(strip('Dentist', null)).toBe('Dentist');
		expect(strip('', null)).toBe('');
	});

	// Strip only what WE put there. Blanket-removing any leading emoji would mean
	// an author renaming "🎂 Birthday" to "🎈 Birthday" produces an identical
	// hash — so the merge sees no change and the edit never reaches the phone.
	it('keeps an emoji the author typed themselves', () => {
		expect(strip(decorate('🎂 Birthday', null, false), null)).toBe('🎂 Birthday');
		expect(strip('🎈 Birthday', null)).not.toBe(strip('🎂 Birthday', null));
	});

	it('does not remove a marker that is not the expected one', () => {
		expect(strip('🏥 Dentist', '💳')).toBe('🏥 Dentist');
	});

	it('is idempotent', () => {
		const once = strip('💳 ČS mortgage payment · Continuum', '💳');
		expect(strip(once, '💳')).toBe(once);
	});
});

describe('which marker a generated event gets', () => {
	const marker = (binding: OriginBinding | null, ruleKey: string) =>
		markerForGenerated(ruleKey, binding);

	it('takes the emoji from the module that owns the bound row', () => {
		expect(marker({ table: 'loan', rowId: 'l', field: 'paymentDay' }, 'loanPayments')).toBe(
			MODULES.loans.emoji
		);
		expect(marker({ table: 'tenancy', rowId: 't', field: 'endDate' }, 'propertyDates')).toBe(
			MODULES.property.emoji
		);
		expect(marker({ table: 'document', rowId: 'd', field: 'expiresOn' }, 'expiry')).toBe(
			MODULES.documents.emoji
		);
	});

	// THE REASON THE MARKER COMES FROM THE BINDING AND NOT THE RULE. `expiry`
	// covers leases, fixations, passports and policies at once, so keyed on the
	// rule every one of them would carry the same blurred marker.
	it('gives two events of the same rule different markers', () => {
		const passport = marker({ table: 'document', rowId: 'd', field: 'expiresOn' }, 'expiry');
		const fixation = marker(
			{ table: 'loanFixationPeriod', rowId: 'p', field: 'endDate' },
			'expiry'
		);
		expect(passport).toBe(MODULES.documents.emoji);
		expect(fixation).toBe(MODULES.loans.emoji);
		expect(passport).not.toBe(fixation);
	});

	it('falls back to the rule for events with no row behind them', () => {
		expect(marker(null, 'importReminder')).toBe(MODULES.import.emoji);
		expect(marker(null, 'investmentReport')).toBe(MODULES.investments.emoji);
	});
});

describe('authored event categories', () => {
	it('every category has a label and an emoji', () => {
		for (const [key, entry] of Object.entries(EVENT_CATEGORIES)) {
			expect(entry.label, key).toBeTruthy();
			expect(entry.emoji, key).toBeTruthy();
		}
	});

	// The registry exists so the marker keeps a reliable meaning and nothing
	// unvalidated reaches a SUMMARY line.
	it('uses distinct emoji so two categories are told apart', () => {
		const emoji = Object.values(EVENT_CATEGORIES).map((c) => c.emoji);
		expect(new Set(emoji).size).toBe(emoji.length);
	});

	it('exposes the source tag it strips', () => {
		expect(SOURCE_TAG.trim()).toContain('Continuum');
	});
});
