import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashToken } from '$lib/server/auth/token-hash';

// Sessions, API tokens and enrollment links share this one function rather than
// each keeping a private copy that claimed in a comment to match the others.
describe('hashToken', () => {
	it('is a 64-character hex sha256', () => {
		expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is stable for the same input', () => {
		expect(hashToken('abc')).toBe(hashToken('abc'));
	});

	it('differs for different input', () => {
		expect(hashToken('abc')).not.toBe(hashToken('abd'));
	});

	it('matches what the session code produces, so one hashing story exists', () => {
		expect(hashToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
	});
});
