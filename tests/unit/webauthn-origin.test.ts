import { describe, expect, it } from 'vitest';
import { isSecureOrigin, relyingPartyId } from '$lib/server/auth/webauthn/origin';

describe('isSecureOrigin', () => {
	it('accepts https', () => {
		expect(isSecureOrigin('https://continuum.tail1234.ts.net')).toBe(true);
	});

	it('accepts http on localhost, so dev and E2E can exercise passkeys', () => {
		expect(isSecureOrigin('http://localhost')).toBe(true);
		expect(isSecureOrigin('http://localhost:5173')).toBe(true);
		expect(isSecureOrigin('http://127.0.0.1:4173')).toBe(true);
	});

	it('rejects http on a LAN name — the browser would refuse WebAuthn there', () => {
		expect(isSecureOrigin('http://continuum.local')).toBe(false);
	});

	it('rejects nonsense rather than throwing', () => {
		expect(isSecureOrigin('')).toBe(false);
		expect(isSecureOrigin('not a url')).toBe(false);
	});
});

describe('relyingPartyId', () => {
	it('is the hostname, without scheme or port', () => {
		expect(relyingPartyId('https://continuum.tail1234.ts.net')).toBe('continuum.tail1234.ts.net');
		expect(relyingPartyId('http://localhost:5173')).toBe('localhost');
	});
});
