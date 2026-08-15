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

/**
 * Which door the attempt was made at. Each keeps its own budget.
 *
 * 'enroll' is separate from 'login' for the same reason 'api' is: an
 * enrollment link is an unauthenticated URL anyone can probe, so counting its
 * failures against the sign-in budget let a bot guessing links shut the
 * household out of their own app.
 */
export type LimitScope = 'login' | 'api' | 'enroll';

const failures = new Map<string, { count: number; firstAt: number }>();

// NUL cannot appear in any part, so the parts can never collide.
const keyFor = (scope: LimitScope, address: string, subject: string) =>
	`${scope}\u0000${address}\u0000${subject}`;

function prune(now: number): void {
	for (const [key, entry] of failures) {
		if (now - entry.firstAt > WINDOW_MS) failures.delete(key);
	}
}

/**
 * Seconds the caller still has to wait, or 0 when the attempt may proceed.
 *
 * `subject` narrows the budget to what is being attacked — the account id on
 * the sign-in form. Without it, eight bogus attempts against one person's
 * account refused every other member's sign-in too, and behind a reverse proxy
 * or Tailscale, where the whole household arrives from one address, that is
 * every member. The API and enrollment doors have no subject: the token in the
 * request is the whole of the secret, so per-address is the only key there is.
 */
export function blockedForSeconds(scope: LimitScope, address: string, subject = ''): number {
	const now = Date.now();
	prune(now);
	const entry = failures.get(keyFor(scope, address, subject));
	if (!entry || entry.count < MAX_FAILURES) return 0;
	return Math.ceil((entry.firstAt + WINDOW_MS - now) / 1000);
}

export function recordFailure(scope: LimitScope, address: string, subject = ''): void {
	const now = Date.now();
	prune(now);
	const key = keyFor(scope, address, subject);
	const entry = failures.get(key);
	if (entry) entry.count++;
	else failures.set(key, { count: 1, firstAt: now });
}

export function recordSuccess(scope: LimitScope, address: string, subject = ''): void {
	failures.delete(keyFor(scope, address, subject));
}
