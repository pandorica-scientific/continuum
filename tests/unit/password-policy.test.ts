import { describe, expect, it } from 'vitest';
import {
	DEFAULT_ENROLLMENT_LINK_DAYS,
	DEFAULT_PASSWORD_MIN_LENGTH,
	daysPhrase,
	passwordLengthError,
	passwordHint
} from '$lib/password-policy';

describe('passwordHint', () => {
	// The placeholder and the server guard are fed by the same number, so raising
	// the minimum cannot leave an input advertising the old one.
	it('states the configured minimum', () => {
		expect(passwordHint(DEFAULT_PASSWORD_MIN_LENGTH)).toBe('8+ characters');
		expect(passwordHint(12)).toBe('12+ characters');
	});
});

describe('passwordLengthError', () => {
	it('centralizes the configurable minimum and caller-specific label', () => {
		expect(passwordLengthError('short', 8, 'New password')).toBe(
			'New password needs at least 8 characters.'
		);
		expect(passwordLengthError('long enough', 8, 'Password')).toBeNull();
	});
});

describe('daysPhrase', () => {
	it('spells small numbers, as the original prose did', () => {
		expect(daysPhrase(DEFAULT_ENROLLMENT_LINK_DAYS)).toBe('seven days');
		expect(daysPhrase(1)).toBe('one day');
	});

	it('falls back to digits past ten rather than inventing words', () => {
		expect(daysPhrase(14)).toBe('14 days');
		expect(daysPhrase(30)).toBe('30 days');
	});
});
