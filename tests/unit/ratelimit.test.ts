import { describe, expect, it } from 'vitest';
import {
	RateLimiter,
	blockedForSeconds,
	loginLimitSubject,
	recordFailure,
	recordSuccess,
	reserveChallengeIssuance
} from '$lib/server/auth/ratelimit';

const MAX_FAILURES = 8;
const MAX_CHALLENGE_ISSUES = 60;

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

	// Rotating account names is already answered by collapsing every unknown one
	// to a single subject, so they share one budget without a coarser
	// address-wide tier — which behind a proxy would be the whole household.
	it('rotating unknown account IDs spends one shared unknown-account budget', () => {
		const address = '198.51.100.17';
		for (let i = 0; i < MAX_FAILURES; i++) {
			recordFailure('login', address, loginLimitSubject(`made-up-${i}`, false));
		}

		expect(
			blockedForSeconds('login', address, loginLimitSubject('made-up-next', false))
		).toBeGreaterThan(0);
		// A named member signing in from the same address is untouched by it.
		expect(blockedForSeconds('login', address, loginLimitSubject('person-robert', true))).toBe(0);
	});

	// One wrong password, or a few expired passkey challenges, must not refuse
	// every other member: behind Tailscale the household is one address.
	it('does not let one account or door lock out the rest of the household', () => {
		const address = '198.51.100.23';
		for (let i = 0; i < MAX_FAILURES * 2; i++) {
			recordFailure('login', address, 'person-robert');
			recordFailure('login', address);
		}

		expect(blockedForSeconds('login', address, 'person-robert')).toBeGreaterThan(0);
		expect(blockedForSeconds('login', address, 'person-tereza')).toBe(0);
	});

	it('collapses attacker-controlled unknown account IDs to one subject', () => {
		expect(loginLimitSubject('made-up-one', false)).toBe(loginLimitSubject('made-up-two', false));
		expect(loginLimitSubject('known-person', true)).toBe('known-person');
	});

	it('bounds attacker-created state and stale cleanup work', () => {
		let now = 0;
		const limiter = new RateLimiter({
			now: () => now,
			maxEntries: 12,
			pruneBatchSize: 3
		});

		for (let i = 0; i < 100; i++) limiter.recordFailure('login', `address-${i}`, 'unknown');
		expect(limiter.size).toBeLessThanOrEqual(12);

		now = 16 * 60 * 1000;
		limiter.blockedForSeconds('login', 'fresh-address', 'unknown');
		expect(limiter.size).toBe(9);
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

	// A flood guard, not a credential budget. Every one of these ceremonies
	// succeeds; capping them at the failure allowance meant four clicks each
	// from two members refused the ninth ordinary sign-in of the window.
	it('lets an ordinary household issue passkey challenges freely', () => {
		const address = '203.0.113.44';
		for (let i = 0; i < MAX_FAILURES * 4; i++) {
			expect(reserveChallengeIssuance(address)).toBe(0);
		}
	});

	it('still stops a script flooding challenge issuance', () => {
		const address = '203.0.113.45';
		for (let i = 0; i < MAX_CHALLENGE_ISSUES; i++) {
			expect(reserveChallengeIssuance(address)).toBe(0);
		}
		expect(reserveChallengeIssuance(address)).toBeGreaterThan(0);
	});
});
