// SPDX-License-Identifier: AGPL-3.0-or-later
// One place decides whether an auth cookie locks itself to HTTPS. Home servers
// commonly run plain HTTP on the LAN; when the instance is served over HTTPS
// (the Tailscale sidecar, or somebody's own reverse proxy) every auth cookie
// follows automatically.
//
// This exists because the session cookie and the WebAuthn challenge cookie were
// each parsing ORIGIN by hand. Two copies of a security flag is one copy too
// many: fixing a trailing slash or an uppercase scheme in one of them would
// silently leave the other unprotected.

import { currentOrigin } from '$lib/server/auth/webauthn/origin';

export function cookieSecure(): boolean {
	// No origin known yet — development, a plain-LAN install, or a sidecar
	// still waiting to be signed in — means plain HTTP, because a `secure`
	// cookie on an HTTP origin is silently dropped and locks the user out.
	return currentOrigin().startsWith('https://');
}
