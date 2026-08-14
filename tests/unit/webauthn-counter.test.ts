import { describe, expect, it } from 'vitest';
import { isCloneSignal } from '$lib/server/auth/webauthn/counter';

describe('isCloneSignal', () => {
	it('does not flag synced passkeys, which always report zero', () => {
		// iCloud Keychain and most platform authenticators never increment.
		// A naive `incoming > stored` check rejects every Apple passkey on its
		// second use — this is the regression this test exists to prevent.
		expect(isCloneSignal(0, 0)).toBe(false);
	});

	it('does not flag an authenticator that starts reporting', () => {
		expect(isCloneSignal(0, 5)).toBe(false);
	});

	it('does not flag an authenticator that stops reporting', () => {
		expect(isCloneSignal(5, 0)).toBe(false);
	});

	it('accepts a counter that advanced', () => {
		expect(isCloneSignal(5, 6)).toBe(false);
	});

	it('flags a counter that repeated', () => {
		expect(isCloneSignal(5, 5)).toBe(true);
	});

	it('flags a counter that went backwards', () => {
		expect(isCloneSignal(5, 4)).toBe(true);
	});
});
