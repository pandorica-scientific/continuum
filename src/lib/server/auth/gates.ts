// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Extension point for request refusals beyond the core session/CSRF ladder in
 * hooks.server.ts (e.g. subscription, quota, suspension checks). Gates run
 * after the session is resolved and the /api bearer boundary, before the
 * login-redirect ladder. CSRF is deliberately not a gate — it runs earlier
 * and nothing should be able to unregister it.
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
 * /ics/<token>, /api and /enroll/<token> each authenticate via a secret in the
 * URL or a bearer token rather than a session cookie. This list only exempts
 * them from the /login redirect, not from authentication — the hook applies
 * bearer authentication to the whole /api boundary regardless.
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
