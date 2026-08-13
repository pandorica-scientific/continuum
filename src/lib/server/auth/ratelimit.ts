// Login rate limiting: after too many failures from one address, sign-in
// waits. In-memory by design — a home server restart resetting the counters
// is fine, and it keeps the door shut against dictionary attacks either way.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

const failures = new Map<string, { count: number; firstAt: number }>();

function prune(now: number): void {
	for (const [key, entry] of failures) {
		if (now - entry.firstAt > WINDOW_MS) failures.delete(key);
	}
}

/** Seconds the caller still has to wait, or 0 when the attempt may proceed. */
export function loginBlockedForSeconds(address: string): number {
	const now = Date.now();
	prune(now);
	const entry = failures.get(address);
	if (!entry || entry.count < MAX_FAILURES) return 0;
	return Math.ceil((entry.firstAt + WINDOW_MS - now) / 1000);
}

export function recordLoginFailure(address: string): void {
	const now = Date.now();
	prune(now);
	const entry = failures.get(address);
	if (entry) entry.count++;
	else failures.set(address, { count: 1, firstAt: now });
}

export function recordLoginSuccess(address: string): void {
	failures.delete(address);
}
