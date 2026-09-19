// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { stillInQueue } from '$lib/import/queue-view';

describe('what the import queue still lists', () => {
	it('keeps a file that is waiting or being read', () => {
		expect(stillInQueue({ state: 'queued' })).toBe(true);
		expect(stillInQueue({ state: 'running' })).toBe(true);
	});

	it('drops a file the moment it reads cleanly', () => {
		// It is in Recent imports by now, with the checks that accepted it —
		// listing it here too left a wall of finished rows over the drop zone,
		// which read as a queue that never cleared.
		expect(
			stillInQueue({
				state: 'done',
				result: { error: null }
			})
		).toBe(false);
		expect(stillInQueue({ state: 'done', result: null, error: null })).toBe(false);
	});

	it('keeps a failure, which never reached Recent imports', () => {
		// This row is the only place it is reported, and the only place its
		// columns can be mapped by hand.
		expect(stillInQueue({ state: 'failed', error: 'could not read the file' })).toBe(true);
		expect(stillInQueue({ state: 'done', result: { error: 'no balance to check against' } })).toBe(
			true
		);
	});

	it('keeps a file still waiting to be told which account it belongs to', () => {
		// `needsAccount` always travels with an error, so it is caught by the
		// same rule rather than needing one of its own.
		expect(
			stillInQueue({
				state: 'done',
				result: { error: 'two accounts share this bank and currency' }
			})
		).toBe(true);
	});
});
