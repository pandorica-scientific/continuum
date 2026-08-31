// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { passkeysUsableFrom } from '$lib/server/auth/webauthn/origin';

describe('passkeysUsableFrom', () => {
	const CONFIGURED = 'https://continuum.example.ts.net';

	it('offers passkeys when the address being browsed is the configured one', () => {
		expect(passkeysUsableFrom('https://continuum.example.ts.net', CONFIGURED)).toEqual({
			usable: true
		});
	});

	it('refuses a different address, naming the one that works', () => {
		// The reported bug: the button appeared on continuum.local and on the iPad
		// because availability was decided from the configured ORIGIN alone,
		// never from the address actually in the browser's bar. Only one address
		// can verify — a credential is bound to one relying-party ID.
		expect(passkeysUsableFrom('http://continuum.local', CONFIGURED)).toEqual({
			usable: false,
			reason: 'other-address',
			worksAt: CONFIGURED
		});
	});

	it('refuses a plain-HTTP address even when it is the configured one', () => {
		// Browsers refuse WebAuthn outside a secure context, so advertising it here
		// would be offering something that cannot work whatever the server thinks.
		expect(passkeysUsableFrom('http://continuum.local', 'http://continuum.local')).toEqual({
			usable: false,
			reason: 'insecure',
			worksAt: 'http://continuum.local'
		});
	});

	it('allows loopback over plain HTTP, which browsers treat as secure', () => {
		expect(passkeysUsableFrom('http://localhost', 'http://localhost')).toEqual({ usable: true });
		expect(passkeysUsableFrom('http://127.0.0.1:4173', 'http://127.0.0.1:4173')).toEqual({
			usable: true
		});
	});

	it('ignores case and a trailing slash, which a browser never sends anyway', () => {
		expect(passkeysUsableFrom('https://Continuum.Example.ts.net/', CONFIGURED)).toEqual({
			usable: true
		});
	});

	it('refuses when no origin is configured at all', () => {
		expect(passkeysUsableFrom('https://continuum.example.ts.net', '')).toEqual({
			usable: false,
			reason: 'unconfigured',
			worksAt: null
		});
	});

	it('refuses an unparseable request origin rather than throwing', () => {
		expect(passkeysUsableFrom('not a url', CONFIGURED).usable).toBe(false);
	});
});
