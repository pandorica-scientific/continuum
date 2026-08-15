// One place decides whether an auth cookie locks itself to HTTPS. Home servers
// commonly run plain HTTP on the LAN; when the instance is served over HTTPS
// (reverse proxy, Tailscale cert) every auth cookie follows automatically.
//
// This exists because the session cookie and the WebAuthn challenge cookie were
// each parsing ORIGIN by hand. Two copies of a security flag is one copy too
// many: fixing a trailing slash or an uppercase scheme in one of them would
// silently leave the other unprotected.

import { env } from '$env/dynamic/private';

export function cookieSecure(): boolean {
	try {
		return new URL(env.ORIGIN ?? '').protocol === 'https:';
	} catch {
		// ORIGIN unset or unparseable: assume plain HTTP, because a `secure`
		// cookie on an HTTP origin is silently dropped and locks the user out.
		return false;
	}
}
