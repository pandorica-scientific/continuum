// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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

export type PasskeyAvailability =
	| { usable: true }
	| {
			usable: false;
			/** Why not, so the screen can say something better than nothing. */
			reason: 'unconfigured' | 'insecure' | 'other-address';
			/** The address that would work, when there is one. */
			worksAt: string | null;
	  };

/**
 * Whether passkeys can work at the address actually being browsed.
 *
 * `passkeysAvailable()` below answers a different question — whether the
 * CONFIGURED origin supports them — and that is what put the button on
 * `continuum.local` and on an iPad, where it could never verify. A credential
 * is bound to one relying-party ID, so exactly one address works, and the only
 * address the browser will report is the one in its bar.
 *
 * Comparing normalised origins rather than raw strings: WebAuthn compares
 * `clientDataJSON.origin` by exact equality, so an ORIGIN written with a
 * trailing slash or a capital letter parses fine, reports itself secure, and
 * then fails every ceremony naming nothing useful.
 */
export function passkeysUsableFrom(
	requestOrigin: string,
	configuredOrigin: string
): PasskeyAvailability {
	const configured = normalise(configuredOrigin);
	if (!configured) return { usable: false, reason: 'unconfigured', worksAt: null };

	const here = normalise(requestOrigin);
	if (here !== configured) return { usable: false, reason: 'other-address', worksAt: configured };
	if (!isSecureOrigin(configured)) {
		return { usable: false, reason: 'insecure', worksAt: configured };
	}
	return { usable: true };
}

/** An origin in the form a browser reports, or '' when it cannot be read. */
function normalise(origin: string): string {
	try {
		return new URL(origin).origin;
	} catch {
		return '';
	}
}
