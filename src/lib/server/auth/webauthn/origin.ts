// WebAuthn refuses to run outside a secure context, and the relying-party ID
// must match the origin exactly. Deriving the ID from ORIGIN rather than
// configuring it separately makes the classic mismatch impossible.

import { env } from '$env/dynamic/private';

export function isSecureOrigin(origin: string): boolean {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	if (url.protocol === 'https:') return true;
	// Browsers treat loopback as a secure context, which is what keeps
	// `npm run dev` and the E2E suite able to exercise passkeys over plain HTTP.
	return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

export function relyingPartyId(origin: string): string {
	return new URL(origin).hostname;
}

/**
 * `env.ORIGIN` normalised into the form a browser reports: lowercase scheme and
 * host, no port when it is the default, no trailing slash, no path.
 *
 * WebAuthn verification compares `clientDataJSON.origin` to this by exact
 * string equality. Passing `env.ORIGIN` through verbatim meant that an ORIGIN
 * written as `https://Continuum.example.ts.net/` parsed fine, reported itself
 * secure, rendered both passkey buttons — and then failed every registration
 * and every sign-in with "could not be verified", naming nothing useful. The
 * relying-party ID is derived from this too, so the same normalisation covers
 * the hostname the credential is bound to.
 *
 * Empty when ORIGIN is unset or unparseable, which `passkeysAvailable()` then
 * reads as "no passkeys here".
 */
export function currentOrigin(): string {
	try {
		return new URL(env.ORIGIN ?? '').origin;
	} catch {
		return '';
	}
}

/** False on a plain-HTTP LAN deployment, where the passkey UI must be absent. */
export function passkeysAvailable(): boolean {
	return isSecureOrigin(currentOrigin());
}
