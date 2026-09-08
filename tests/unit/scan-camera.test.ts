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
		// This is the whole reason the insecure-origin screen and the native
		// camera fallback exist. Getting it wrong means a self-hoster is told
		// their device has no camera.
		expect(isSecureForCamera({ protocol: 'http:', hostname: '192.168.68.51' })).toBe(false);
		expect(isSecureForCamera({ protocol: 'http:', hostname: 'continuum.lan' })).toBe(false);
	});
});

/*
 * `createStability`, `guidanceFor` and the loop timings used to be tested here.
 *
 * They belonged to the viewfinder's live outline — OpenCV running about nine
 * times a second in the browser to trace the page while someone aimed, and the
 * coaching that went with it ("Hold steady", "Too dark — try more light").
 * v0.8.6 removed all of it: the detection that drew the outline is the same
 * WebAssembly heap an iPhone could not always allocate, and taking it out of
 * the browser is the point of the release.
 *
 * Nothing replaced those tests because nothing replaced that code. The
 * viewfinder is now a plain camera with a static frame guide, and everything
 * the detector has to say arrives after the shutter, from the server — where a
 * crop that came out wrong is dragged into place with the corner handles rather
 * than being aimed at more carefully.
 */
