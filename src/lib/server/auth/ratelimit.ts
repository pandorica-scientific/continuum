// SPDX-License-Identifier: AGPL-3.0-or-later
// Failed-credential rate limiting. In-memory by design: this is a single-home
// server, and restarting it may reset a short-lived budget without weakening
// the database-backed credentials themselves.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
// Issuing a challenge is not a failed credential. An ordinary sign-in issues
// one per click, every one of them succeeding, and the whole household arrives
// from one address behind Tailscale or a reverse proxy. This is a flood guard
// on a cheap public endpoint, so it gets its own far larger allowance than a
// wrong credential does — counting issues as failures capped the household at
// eight passkey ceremonies per window with nothing that ever cleared it.
const MAX_CHALLENGE_ISSUES = 60;
const DEFAULT_MAX_ENTRIES = 4096;
const DEFAULT_PRUNE_BATCH_SIZE = 64;

const UNKNOWN_LOGIN_SUBJECT = 'unknown-account';

export function loginLimitSubject(personId: string, known: boolean): string {
	return known ? personId : UNKNOWN_LOGIN_SUBJECT;
}

type LimitScope = 'login' | 'api' | 'enroll' | 'passkey-challenge';

interface Entry {
	count: number;
	firstAt: number;
}

interface RateLimiterOptions {
	now?: () => number;
	maxEntries?: number;
	pruneBatchSize?: number;
}

// NUL cannot appear in any part, so the parts can never collide.
const keyFor = (scope: LimitScope, address: string, subject: string) =>
	`${scope}\u0000${address}\u0000${subject}`;

function maximumFor(scope: LimitScope): number {
	return scope === 'passkey-challenge' ? MAX_CHALLENGE_ISSUES : MAX_FAILURES;
}

/** A bounded limiter with constant-bounded lifecycle work per operation. */
export class RateLimiter {
	readonly #entries = new Map<string, Entry>();
	readonly #now: () => number;
	readonly #maxEntries: number;
	readonly #pruneBatchSize: number;

	constructor(options: RateLimiterOptions = {}) {
		this.#now = options.now ?? Date.now;
		this.#maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
		this.#pruneBatchSize = Math.max(1, options.pruneBatchSize ?? DEFAULT_PRUNE_BATCH_SIZE);
	}

	get size(): number {
		return this.#entries.size;
	}

	/**
	 * One budget per (scope, address, subject) and no coarser tier above it.
	 * `subject` narrows the budget to what is actually under attack — the
	 * account id on the sign-in form. An address-wide tier on top of it looks
	 * like defence in depth and is not: behind Tailscale or a reverse proxy the
	 * whole household is one address, so a handful of failures against any
	 * account, or a few expired passkey challenges, refused every member's
	 * sign-in. Doors with no subject (api, enroll, passkey verify) key on the
	 * address alone, because the token in the request is the whole secret.
	 */
	blockedForSeconds(scope: LimitScope, address: string, subject = ''): number {
		const now = this.#now();
		this.#prune(now);
		return this.#waitFor(keyFor(scope, address, subject), now, maximumFor(scope));
	}

	recordFailure(scope: LimitScope, address: string, subject = ''): void {
		const now = this.#now();
		this.#prune(now);
		this.#increment(keyFor(scope, address, subject), now);
	}

	recordSuccess(scope: LimitScope, address: string, subject = ''): void {
		// Clears exactly the budget the attempt was counted against, which is now
		// the only budget there is. Single-tier callers omit subject.
		this.#entries.delete(keyFor(scope, address, subject));
	}

	#waitFor(key: string, now: number, maximum: number): number {
		const entry = this.#entries.get(key);
		if (!entry || entry.count < maximum) return 0;
		return Math.max(0, Math.ceil((entry.firstAt + WINDOW_MS - now) / 1000));
	}

	#increment(key: string, now: number): void {
		const entry = this.#entries.get(key);
		if (entry) {
			entry.count++;
			return;
		}

		while (this.#entries.size >= this.#maxEntries) {
			const oldest = this.#entries.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			this.#entries.delete(oldest);
		}
		this.#entries.set(key, { count: 1, firstAt: now });
	}

	#prune(now: number): void {
		let visited = 0;
		for (const [key, entry] of this.#entries) {
			if (visited++ >= this.#pruneBatchSize) break;
			// Entries are insertion ordered and the fixed window never extends.
			if (now - entry.firstAt < WINDOW_MS) break;
			this.#entries.delete(key);
		}
	}
}

const limiter = new RateLimiter();

export function blockedForSeconds(scope: LimitScope, address: string, subject = ''): number {
	return limiter.blockedForSeconds(scope, address, subject);
}

export function recordFailure(scope: LimitScope, address: string, subject = ''): void {
	limiter.recordFailure(scope, address, subject);
}

export function recordSuccess(scope: LimitScope, address: string, subject = ''): void {
	limiter.recordSuccess(scope, address, subject);
}

/**
 * Reserve one public challenge issue, returning its retry delay when refused.
 * The count here is issues, not failures: it exists so a script cannot flood
 * webauthn_challenge, and it runs on the MAX_CHALLENGE_ISSUES allowance rather
 * than the credential-guessing one.
 */
export function reserveChallengeIssuance(address: string): number {
	const wait = limiter.blockedForSeconds('passkey-challenge', address);
	if (wait === 0) limiter.recordFailure('passkey-challenge', address);
	return wait;
}
