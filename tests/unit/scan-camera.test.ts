// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { isSecureForCamera } from '$lib/scan/client/camera.svelte';

describe('isSecureForCamera', () => {
	it('is true over https', () => {
		expect(isSecureForCamera({ protocol: 'https:', hostname: 'ledger.example' })).toBe(true);
	});

	it('is true on localhost, which browsers treat as secure', () => {
		expect(isSecureForCamera({ protocol: 'http:', hostname: 'localhost' })).toBe(true);
		expect(isSecureForCamera({ protocol: 'http:', hostname: '127.0.0.1' })).toBe(true);
		expect(isSecureForCamera({ protocol: 'http:', hostname: '[::1]' })).toBe(true);
	});

	it('is FALSE on a plain-http LAN address — the self-hosting case that matters', () => {
		// Getting it wrong tells a self-hoster their device has no camera.
		expect(isSecureForCamera({ protocol: 'http:', hostname: '192.168.68.51' })).toBe(false);
		expect(isSecureForCamera({ protocol: 'http:', hostname: 'continuum.lan' })).toBe(false);
	});
});

/*
 * `createStability`, `guidanceFor` and the live-outline loop timings used to be
 * tested here. That code was removed: OpenCV in the browser could exhaust an
 * iPhone's WASM heap, so detection now runs after the shutter, server-side.
 */
