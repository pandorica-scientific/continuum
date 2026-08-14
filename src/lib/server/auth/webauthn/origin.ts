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
 * `env.ORIGIN` is `string | undefined`, and every WebAuthn call needs a definite
 * string. Narrowing here once keeps the null handling out of four endpoints.
 */
export function currentOrigin(): string {
	return env.ORIGIN ?? '';
}

/** False on a plain-HTTP LAN deployment, where the passkey UI must be absent. */
export function passkeysAvailable(): boolean {
	return isSecureOrigin(currentOrigin());
}
