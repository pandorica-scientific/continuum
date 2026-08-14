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
 * Returns null when the body is not JSON, is not an object, or carries no
 * credential id. The rest of the payload is left to the WebAuthn library, which
 * validates it thoroughly and throws — callers must catch that.
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
	if (typeof id !== 'string' || id.length === 0) return null;

	return { response: response as T, label: (body as { label?: unknown }).label };
}
