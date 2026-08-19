// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Reading a failed fetch's message. SvelteKit's error() responses carry
// { message }, so the server's own wording — "try again in 3 minutes", "sign in
// again" — reaches the person instead of a generic sentence written at the call
// site. Shared because both passkey buttons need it and a second copy would
// drift.

export async function problemMessage(response: Response, fallback: string): Promise<string> {
	const body = await response.json().catch(() => null);
	const message = (body as { message?: unknown } | null)?.message;
	if (typeof message === 'string' && message) return message;
	if (response.status === 401) return 'Your session has expired — sign in again.';
	return fallback;
}
