// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { isRevisionWriterId } from '$lib/server/settings';

// A writer id is an opaque per-tab identity. It has no reason to care which
// UUID version it is — and caring is what broke it: the pattern demanded
// version 1-5 while the page issued version 7, so every autosave was refused
// with "The save writer is invalid."
describe('isRevisionWriterId', () => {
	it('accepts the ids the application actually issues', () => {
		for (let i = 0; i < 20; i++) {
			const id = uuidv7();
			expect(isRevisionWriterId(id), `${id} should be a valid writer id`).toBe(true);
		}
	});

	it('accepts a v4 id, which earlier callers issued', () => {
		expect(isRevisionWriterId('99999999-9999-4999-8999-999999999999')).toBe(true);
	});

	it('rejects the nil uuid, which asRowId() returns for junk', () => {
		expect(isRevisionWriterId('00000000-0000-0000-0000-000000000000')).toBe(false);
	});

	it('rejects anything that is not a uuid', () => {
		expect(isRevisionWriterId('')).toBe(false);
		expect(isRevisionWriterId('not-a-uuid')).toBe(false);
		expect(isRevisionWriterId('99999999-9999-4999-8999-99999999999')).toBe(false);
		expect(isRevisionWriterId('99999999-9999-4999-8999-9999999999999')).toBe(false);
	});
});
