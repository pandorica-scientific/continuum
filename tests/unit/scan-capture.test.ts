// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import ScanPermission from '$lib/scan/client/ScanPermission.svelte';

const props = { onallow: () => {}, onchoosefile: () => {} };
const STATES = ['asking', 'denied', 'absent', 'insecure'] as const;

describe('the permission screens', () => {
	it('asks before the OS does, and says where the image goes', () => {
		// A raw system dialog with no context gets denied, and the OS will not
		// re-ask. For a self-hosted product the sentence that earns the tap is
		// where the image goes.
		const { body } = render(ScanPermission, { props: { ...props, state: 'asking' } });
		expect(body).toContain('Use the camera to photograph this page?');
		expect(body).toMatch(/never leaves it/);
		expect(body).toContain('Allow the camera');
	});

	it('names the padlock when permission was refused, because that is what to tap', () => {
		const { body } = render(ScanPermission, { props: { ...props, state: 'denied' } });
		expect(body).toContain('Continuum cannot reach the camera');
		expect(body).toMatch(/padlock/i);
	});

	it('offers another device when there is no camera', () => {
		const { body } = render(ScanPermission, { props: { ...props, state: 'absent' } });
		expect(body).toContain('No camera on this device');
		expect(body).toContain('Open on my phone');
	});

	it('has a fourth state for an insecure origin, whose recovery is different', () => {
		// The camera EXISTS; the address is not https. "Open on my phone" would
		// send a self-hoster to the same plain-http address.
		const { body } = render(ScanPermission, { props: { ...props, state: 'insecure' } });
		expect(body).toMatch(/secure connection/i);
		expect(body).toMatch(/https/);
		expect(body).not.toContain('Open on my phone');
	});

	it('never blocks the task — every state keeps "Choose a file instead"', () => {
		for (const state of STATES) {
			const { body } = render(ScanPermission, { props: { ...props, state } });
			expect(body).toContain('Choose a file instead');
		}
	});

	it('renders all four without reading a value that does not exist', () => {
		// These screens draw no outline and carry no weight or dash value.
		// Reading a property off a missing entry threw out of the render
		// function and took the ENTIRE component down — all four screens
		// rendered nothing rather than one degrading.
		for (const state of STATES) {
			expect(() => render(ScanPermission, { props: { ...props, state } })).not.toThrow();
		}
	});

	it('meets the touch floor on every control', () => {
		const source = readFileSync('src/lib/scan/client/ScanPermission.svelte', 'utf8');
		expect(source).toContain('min-height: var(--touch-min)');
	});
});

describe('the stability ring', () => {
	const source = readFileSync('src/lib/scan/client/ScanCapture.svelte', 'utf8');

	it('sits on the shutter rather than around it', () => {
		// The disc occupies a radius of 28 in the 72-unit viewBox. At the 33 this
		// started as, the ring stood five pixels clear all the way round and read
		// as a halo behind the button.
		const radius = Number(source.match(/<circle cx="36" cy="36" r="(\d+)"/)?.[1]);
		expect(radius).toBeGreaterThan(28);
		expect(radius).toBeLessThanOrEqual(31);
	});

	it('measures its fill in percent, not in user units', () => {
		// Otherwise the dash array is 2πr written out as a number: correct until
		// somebody adjusts the radius, and then the ring fills to the wrong
		// fraction — silently, because it still looks like a ring.
		expect(source).toContain('pathLength="100"');
		expect(source).toContain('stroke-dasharray: 100;');
		expect(source).toContain('stroke-dashoffset: 100;');
	});

	it('fills over the hold window, as a transition', () => {
		// A transition rather than an animation, which is exactly why the
		// reduced-motion block has to cover transitions too.
		expect(source).toMatch(/transition: stroke-dashoffset var\(--motion-hold\)/);
	});
});
