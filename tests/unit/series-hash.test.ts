import { describe, expect, it } from 'vitest';
import { canonical, hashSeries, type EventSeries } from '$lib/server/calendar/series';

const base: EventSeries = {
	uid: 'a',
	title: 'Dentist',
	notes: null,
	category: null,
	allDay: false,
	startsAt: '2026-09-01T09:00:00.000Z',
	endsAt: '2026-09-01T10:00:00.000Z',
	tz: 'Europe/Prague',
	rrule: null,
	exceptions: [],
	updatedAt: '2026-09-01T00:00:00.000Z'
};

const hash = (over: Partial<EventSeries> = {}) => hashSeries({ ...base, ...over });

describe('what the hash ignores', () => {
	// The merge base is "what we last sent". A timestamp bump is not a change to
	// what the event says, and treating it as one would push on every pass.
	it('ignores updatedAt', () => {
		expect(hash({ updatedAt: '2027-01-01T00:00:00.000Z' })).toBe(hash());
	});

	// THE PUSH LOOP. We send "🏥 Dentist · Continuum"; the remote hands it back
	// decorated. If decoration reached the hash, every event would compare as
	// changed on every pass — push, echo, push — and it fails silently, as
	// rate-limit exhaustion rather than an error.
	it('ignores the marker and source tag we added on the way out', () => {
		expect(hashSeries({ ...base, title: '🏥 Dentist · Continuum' }, '🏥')).toBe(hash());
	});

	it('ignores line-ending differences in notes', () => {
		expect(hash({ notes: 'a\r\nb' })).toBe(hash({ notes: 'a\nb' }));
	});

	// Google returns exceptions in whatever order it likes.
	it('is order-independent across exceptions', () => {
		const x = { recurrenceId: '2026-09-08T09:00:00.000Z', cancelled: true };
		const y = { recurrenceId: '2026-09-15T09:00:00.000Z', cancelled: true };
		expect(hash({ exceptions: [x, y] })).toBe(hash({ exceptions: [y, x] }));
	});

	// Instants, not the strings they arrived as: one provider sends +00:00 and
	// another sends Z for the same moment.
	it('ignores how an instant was spelled', () => {
		expect(hash({ startsAt: '2026-09-01T11:00:00.000+02:00' })).toBe(
			hash({ startsAt: '2026-09-01T09:00:00.000Z' })
		);
	});

	it('ignores surrounding whitespace on a title', () => {
		expect(hash({ title: '  Dentist ' })).toBe(hash());
	});
});

describe('what the hash notices', () => {
	it('notices a changed title', () => {
		expect(hash({ title: 'Doctor' })).not.toBe(hash());
	});

	it('notices a moved start', () => {
		expect(hash({ startsAt: '2026-09-01T10:00:00.000Z' })).not.toBe(hash());
	});

	it('notices a changed recurrence rule', () => {
		expect(hash({ rrule: 'FREQ=WEEKLY' })).not.toBe(hash());
	});

	it('notices a changed timezone', () => {
		expect(hash({ tz: 'UTC' })).not.toBe(hash());
	});

	it('notices an exception being added', () => {
		expect(hash({ exceptions: [{ recurrenceId: base.startsAt, cancelled: true }] })).not.toBe(
			hash()
		);
	});

	it('notices an exception changing from cancelled to moved', () => {
		const cancelled = hash({ exceptions: [{ recurrenceId: base.startsAt, cancelled: true }] });
		const moved = hash({
			exceptions: [
				{ recurrenceId: base.startsAt, cancelled: false, startsAt: '2026-09-02T09:00:00.000Z' }
			]
		});
		expect(cancelled).not.toBe(moved);
	});

	// An emoji the author typed is content, not decoration. Blanket-stripping it
	// would make renaming "🎂 Birthday" to "🎈 Birthday" hash identically, and the
	// edit would never leave this machine.
	it('notices an author changing their own emoji', () => {
		expect(hashSeries({ ...base, title: '🎂 Birthday' })).not.toBe(
			hashSeries({ ...base, title: '🎈 Birthday' })
		);
	});

	it('notices all-day being switched on', () => {
		expect(hash({ allDay: true })).not.toBe(hash());
	});
});

describe('canonical form', () => {
	it('is a stable string, not an object', () => {
		expect(typeof canonical(base)).toBe('string');
	});

	// Key order in JSON is not guaranteed across engines or providers.
	it('does not depend on key order in the input', () => {
		const reordered = JSON.parse(JSON.stringify(base, Object.keys(base).sort())) as EventSeries;
		expect(canonical(reordered)).toBe(canonical(base));
	});

	it('produces a hex digest', () => {
		expect(hashSeries(base)).toMatch(/^[0-9a-f]{64}$/);
	});
});
