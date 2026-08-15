// Both verify endpoints take a JSON body straight from the browser, and the
// sign-in one takes it without a session at all. Parsing defensively here is
// what keeps a malformed payload a 400 instead of an unhandled TypeError
// surfacing as a 500 — and, on the sign-in path, a 500 that fires before the
// rate limiter has counted anything.

export interface WebAuthnBody<T> {
	response: T;
	label: unknown;
}

/**
 * A credential id is base64url by specification, and both endpoints put this
 * string straight into a Postgres text lookup. Checking the shape rather than
 * merely "a non-empty string" is what keeps that lookup from throwing: a NUL
 * byte makes it fail with 22021 (`invalid byte sequence for encoding "UTF8"`)
 * from outside every catch in the handler, so a request anyone can make
 * unauthenticated became a 500 — and on the sign-in path it reached the
 * database without passing any branch that calls recordLoginFailure, so it was
 * never counted and could be repeated without limit. The upper bound is the
 * 1023-byte maximum the specification puts on a credential id, base64url
 * encoded.
 */
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,1364}$/;

/**
 * Returns null when the body is not JSON, is not an object, or carries no
 * usable credential id. The rest of the payload is left to the WebAuthn
 * library, which validates it thoroughly and throws — callers must catch that.
 */
export async function readWebAuthnBody<T>(request: Request): Promise<WebAuthnBody<T> | null> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return null;
	}
	if (!body || typeof body !== 'object') return null;

	const response = (body as { response?: unknown }).response;
	if (!response || typeof response !== 'object') return null;

	const id = (response as { id?: unknown }).id;
	if (typeof id !== 'string' || !CREDENTIAL_ID.test(id)) return null;

	return { response: response as T, label: (body as { label?: unknown }).label };
}
