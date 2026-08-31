// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { passwordLengthError, passwordsMatchError } from '$lib/password-policy';

describe('passwordsMatchError', () => {
	it('accepts two identical passwords', () => {
		expect(passwordsMatchError('correct-horse', 'correct-horse')).toBeNull();
	});

	it('reports a mismatch', () => {
		expect(passwordsMatchError('correct-horse', 'correct-hose')).toBe(
			'The two passwords do not match.'
		);
	});

	it('takes a label, so one message shape serves every screen', () => {
		expect(passwordsMatchError('a', 'b', 'The two new passwords')).toBe(
			'The two new passwords do not match.'
		);
	});

	it('treats an empty confirmation as a mismatch rather than a match', () => {
		// Otherwise a form that never rendered the second field would pass this
		// check by accident, which is the failure it exists to catch.
		expect(passwordsMatchError('correct-horse', '')).not.toBeNull();
	});

	it('does not care about length — that is the other rule', () => {
		expect(passwordsMatchError('ab', 'ab')).toBeNull();
		expect(passwordLengthError('ab', 8)).not.toBeNull();
	});
});
