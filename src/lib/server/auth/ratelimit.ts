// Failed-credential rate limiting: after too many failures from one address,
// that address waits. In-memory by design — a home server restart resetting the
// counters is fine, and it keeps the door shut against dictionary attacks
// either way.
//
// Counters are held per scope as well as per address. The sign-in form and the
// API's bearer tokens are separate doors: sharing one counter meant a dashboard
// still polling with a revoked token spent the household's whole sign-in budget
// on their behalf, locking the login form for roughly seven minutes in every
// fifteen — and behind a reverse proxy, where every client arrives from the
// same address, one misconfigured script locked out everyone.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

/** Which door the attempt was made at. Each keeps its own budget. */
export type LimitScope = 'login' | 'api';

const failures = new Map<string, { count: number; firstAt: number }>();

// NUL cannot appear in either part, so the two can never collide.
const keyFor = (scope: LimitScope, address: string) => `${scope}\u0000${address}`;

function prune(now: number): void {
	for (const [key, entry] of failures) {
		if (now - entry.firstAt > WINDOW_MS) failures.delete(key);
	}
}

/** Seconds the caller still has to wait, or 0 when the attempt may proceed. */
export function blockedForSeconds(scope: LimitScope, address: string): number {
	const now = Date.now();
	prune(now);
	const entry = failures.get(keyFor(scope, address));
	if (!entry || entry.count < MAX_FAILURES) return 0;
	return Math.ceil((entry.firstAt + WINDOW_MS - now) / 1000);
}

export function recordFailure(scope: LimitScope, address: string): void {
	const now = Date.now();
	prune(now);
	const entry = failures.get(keyFor(scope, address));
	if (entry) entry.count++;
	else failures.set(keyFor(scope, address), { count: 1, firstAt: now });
}

export function recordSuccess(scope: LimitScope, address: string): void {
	failures.delete(keyFor(scope, address));
}
