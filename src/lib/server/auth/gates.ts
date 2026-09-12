// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reasons to refuse a request that this product does not have.
 *
 * The ladder in hooks.server.ts answers one question — is there a session, and
 * does this path need one. A product hosting this for other people has to
 * answer several more: is the subscription paid, is the storage allowance
 * spent, is the instance suspended. Each of those as a new branch in that
 * ladder would be an edit to a function whose existing branches encode
 * carefully-reasoned behaviour, and whose comments are the only record of it.
 *
 * So they are a list instead. Gates run after the session is resolved and
 * after the /api bearer boundary, and before the login-redirect ladder.
 *
 * The CSRF refusal is deliberately NOT a gate. It runs before ensureReady(),
 * for the reason given where it sits, and nothing should be able to
 * unregister it.
 */
import type { RequestEvent } from '@sveltejs/kit';

export interface RequestGate {
	id: string;
	/**
	 * A Response to refuse the request, or null to pass.
	 *
	 * Passing is not approval — it means this gate has no opinion. To send the
	 * visitor somewhere instead, throw SvelteKit's redirect(), the same way the
	 * ladder below does; the loop does not catch.
	 */
	check(event: RequestEvent): Promise<Response | null>;
}

const gates: RequestGate[] = [];

export function registerRequestGate(gate: RequestGate): void {
	gates.push(gate);
}

export function unregisterRequestGate(id: string): void {
	const at = gates.findIndex((gate) => gate.id === id);
	if (at >= 0) gates.splice(at, 1);
}

export function requestGates(): RequestGate[] {
	return [...gates];
}

/**
 * /ics/<token> is public by design: calendar apps subscribe without a session,
 * authenticated by the secret token in the URL. /api authenticates itself the
 * same way, with a bearer token instead of a cookie. /enroll/<token> is the
 * same shape again — the visitor has no session yet, and the token in the URL
 * is what authorises them to set a password.
 *
 * This exempts them from the redirect to /login, NOT from authentication — the
 * hook applies bearer authentication to the whole /api boundary before any
 * endpoint runs, covering exactly what '/api' here exempts so a route added
 * beside the versioned ones cannot ship unauthenticated. The E2E journey
 * asserts an unauthenticated request gets a 401.
 */
const publicPrefixes = ['/login', '/setup', '/ics', '/api', '/enroll'];

/**
 * Add an unauthenticated route — a billing webhook, a health probe.
 *
 * There is no unregister on purpose: a route that must be reachable without a
 * session is not something to switch off halfway through a process's life.
 */
export function registerPublicPath(prefix: string): void {
	publicPrefixes.push(prefix);
}

export function publicPaths(): string[] {
	return [...publicPrefixes];
}

export function isPublicPath(pathname: string): boolean {
	return publicPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
