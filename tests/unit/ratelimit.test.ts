import { describe, expect, it } from 'vitest';
import { blockedForSeconds, recordFailure, recordSuccess } from '$lib/server/auth/ratelimit';

const MAX_FAILURES = 8;

describe('rate limiter scopes', () => {
	it('a locked-out API caller does not lock the sign-in form', () => {
		// A dashboard polling with a revoked token used to spend the household's
		// login budget: behind a reverse proxy every client arrives from the same
		// address, so one stale script shut everyone out of the app.
		const address = '10.0.0.7';
		for (let i = 0; i < MAX_FAILURES; i++) recordFailure('api', address);

		expect(blockedForSeconds('api', address)).toBeGreaterThan(0);
		expect(blockedForSeconds('login', address)).toBe(0);
	});

	it('still blocks within its own scope after enough failures', () => {
		const address = '10.0.0.8';
		for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure('login', address);
		expect(blockedForSeconds('login', address)).toBe(0);
		recordFailure('login', address);
		expect(blockedForSeconds('login', address)).toBeGreaterThan(0);
	});

	it('a successful sign-in clears only its own scope', () => {
		const address = '10.0.0.9';
		for (let i = 0; i < MAX_FAILURES; i++) {
			recordFailure('login', address);
			recordFailure('api', address);
		}
		recordSuccess('login', address);
		expect(blockedForSeconds('login', address)).toBe(0);
		// The API budget is deliberately not cleared by a successful sign-in,
		// so token guessing cannot be reset by logging in.
		expect(blockedForSeconds('api', address)).toBeGreaterThan(0);
	});

	it('keeps addresses apart', () => {
		for (let i = 0; i < MAX_FAILURES; i++) recordFailure('login', '10.0.0.10');
		expect(blockedForSeconds('login', '10.0.0.10')).toBeGreaterThan(0);
		expect(blockedForSeconds('login', '10.0.0.11')).toBe(0);
	});

	it('attempts against one account do not lock the rest of the household', () => {
		// Behind Tailscale or any reverse proxy the whole household shares one
		// address, so an address-only budget meant eight bogus attempts against
		// one person refused everyone's sign-in.
		const address = '100.64.0.1';
		for (let i = 0; i < MAX_FAILURES; i++) recordFailure('login', address, 'person-robert');
		expect(blockedForSeconds('login', address, 'person-robert')).toBeGreaterThan(0);
		expect(blockedForSeconds('login', address, 'person-tereza')).toBe(0);
	});

	it('enrollment has its own budget and never touches the sign-in one', () => {
		// An enrollment link is an unauthenticated URL anyone can probe.
		const address = '100.64.0.2';
		for (let i = 0; i < MAX_FAILURES; i++) recordFailure('enroll', address);
		expect(blockedForSeconds('enroll', address)).toBeGreaterThan(0);
		expect(blockedForSeconds('login', address)).toBe(0);
		expect(blockedForSeconds('login', address, 'person-robert')).toBe(0);
		expect(blockedForSeconds('api', address)).toBe(0);
	});
});
