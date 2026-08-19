import { describe, expect, it } from 'vitest';
import { merge, type MergeInput } from '$lib/calendar/merge';
import type { OriginBinding } from '$lib/calendar/keys';

const LOAN: OriginBinding = { table: 'loan', rowId: 'l1', field: 'paymentDay' };

const input = (over: Partial<MergeInput> = {}): MergeInput => ({
	baseHash: 'h',
	localHash: 'h',
	remoteHash: 'h',
	localUpdatedAt: '2026-09-02T00:00:00.000Z',
	remoteUpdatedAt: '2026-09-01T00:00:00.000Z',
	generated: false,
	dateOnlyChange: false,
	newDate: null,
	binding: null,
	...over
});

const kind = (over: Partial<MergeInput>) => merge(input(over)).kind;

// base = what we last successfully sent. null on either side means deleted.
describe('the three-way table', () => {
	it('does nothing when neither side moved', () => {
		expect(kind({})).toBe('noop');
	});

	it('pushes when only local moved', () => {
		expect(kind({ localHash: 'x' })).toBe('push');
	});

	it('applies when only remote moved', () => {
		expect(kind({ remoteHash: 'y' })).toBe('apply');
	});

	it('conflicts when both moved', () => {
		expect(kind({ localHash: 'x', remoteHash: 'y' })).toBe('conflict');
	});

	it('applies a remote deletion', () => {
		expect(kind({ remoteHash: null })).toBe('apply-delete');
	});

	// Not a silent win for either side: someone deleted an event another person
	// was editing, and both actions were deliberate.
	it('conflicts on a local edit against a remote delete', () => {
		expect(kind({ localHash: 'x', remoteHash: null })).toBe('conflict');
	});

	it('pushes a local deletion', () => {
		expect(kind({ localHash: null })).toBe('push-delete');
	});

	it('drops the link when both sides deleted', () => {
		expect(kind({ localHash: null, remoteHash: null })).toBe('drop-link');
	});
});

describe('first sight of an event', () => {
	// No base means we have never sent this. It is not a conflict — it is new.
	it('pushes a local event the remote has never seen', () => {
		expect(kind({ baseHash: null, remoteHash: null, localHash: 'x' })).toBe('push');
	});

	it('applies a remote event we have never seen', () => {
		expect(kind({ baseHash: null, localHash: null, remoteHash: 'y' })).toBe('apply');
	});

	// Both sides created something under the same key without either having seen
	// the other. Genuinely ambiguous, so it goes through the conflict rule.
	it('conflicts when both sides invented the same event independently', () => {
		expect(kind({ baseHash: null, localHash: 'x', remoteHash: 'y' })).toBe('conflict');
	});

	it('does nothing when there is nothing anywhere', () => {
		expect(kind({ baseHash: null, localHash: null, remoteHash: null })).toBe('noop');
	});
});

describe('the conflict rule', () => {
	it('gives it to the side edited more recently', () => {
		expect(
			merge(
				input({
					localHash: 'x',
					remoteHash: 'y',
					localUpdatedAt: '2026-09-02T00:00:00.000Z',
					remoteUpdatedAt: '2026-09-01T00:00:00.000Z'
				})
			)
		).toEqual({ kind: 'conflict', winner: 'local' });

		expect(
			merge(
				input({
					localHash: 'x',
					remoteHash: 'y',
					localUpdatedAt: '2026-09-01T00:00:00.000Z',
					remoteUpdatedAt: '2026-09-02T00:00:00.000Z'
				})
			)
		).toEqual({ kind: 'conflict', winner: 'remote' });
	});

	// Two clocks, two machines. A dead heat has to resolve the same way every
	// time or the two sides ping-pong the event between them forever.
	it('breaks an exact tie deterministically, in favour of local', () => {
		const at = '2026-09-01T00:00:00.000Z';
		const result = merge(
			input({ localHash: 'x', remoteHash: 'y', localUpdatedAt: at, remoteUpdatedAt: at })
		);
		expect(result).toEqual({ kind: 'conflict', winner: 'local' });
	});
});

describe('generated events', () => {
	// The ledger owns these. A remote edit to the title is not a fact about the
	// amortisation schedule, so it is re-asserted rather than accepted.
	it('re-asserts a non-date remote edit', () => {
		expect(kind({ generated: true, remoteHash: 'y', binding: LOAN })).toBe('push');
	});

	it('writes back a pure date move on a bound event', () => {
		expect(
			merge(
				input({
					generated: true,
					remoteHash: 'y',
					dateOnlyChange: true,
					newDate: '2026-09-20',
					binding: LOAN
				})
			)
		).toEqual({ kind: 'write-back', field: 'paymentDay', value: '2026-09-20' });
	});

	// Nothing to write to: the import reminder and the quarterly report are
	// schedule rules with no row behind them.
	it('re-asserts a date move on an unbound event', () => {
		expect(
			kind({ generated: true, remoteHash: 'y', dateOnlyChange: true, newDate: '2026-09-20' })
		).toBe('push');
	});

	// A fixation end has a row, but moving it re-cuts the interest schedule —
	// which is not what dragging a calendar event should mean.
	it('re-asserts a date move on a fixation period', () => {
		expect(
			kind({
				generated: true,
				remoteHash: 'y',
				dateOnlyChange: true,
				newDate: '2026-09-20',
				binding: { table: 'loanFixationPeriod', rowId: 'p1', field: 'endsOn' }
			})
		).toBe('push');
	});

	// Deleting a ledger event on your phone is a deliberate act. Re-creating it
	// next pass would be the app arguing with its user.
	it('suppresses rather than re-creating a remotely deleted generated event', () => {
		expect(kind({ generated: true, remoteHash: null, binding: LOAN })).toBe('suppress');
	});

	it('still pushes a generated event the remote has never seen', () => {
		expect(kind({ generated: true, baseHash: null, remoteHash: null, localHash: 'x' })).toBe(
			'push'
		);
	});

	// The ledger cannot delete its own generated event — it either exists or it
	// does not — so a local null here means it fell out of the horizon.
	it('drops the link when a generated event leaves the window and the remote is gone', () => {
		expect(kind({ generated: true, localHash: null, remoteHash: null })).toBe('drop-link');
	});
});
