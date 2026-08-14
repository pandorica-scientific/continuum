import { describe, expect, it } from 'vitest';
import { readWebAuthnBody } from '$lib/server/auth/webauthn/payload';

function post(body: string): Request {
	return new Request('http://localhost/auth/passkey/login/verify', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body
	});
}

describe('readWebAuthnBody', () => {
	it('returns the response and label for a well-formed body', async () => {
		const parsed = await readWebAuthnBody<{ id: string }>(
			post(JSON.stringify({ response: { id: 'abc' }, label: 'Laptop' }))
		);
		expect(parsed?.response.id).toBe('abc');
		expect(parsed?.label).toBe('Laptop');
	});

	// Each of these used to reach `body.response.id` unguarded on a public
	// endpoint and throw a TypeError, which surfaced as a 500 — and on the
	// sign-in path it happened before the rate limiter had counted anything.
	it('rejects a body that is not JSON', async () => {
		expect(await readWebAuthnBody(post('not json'))).toBeNull();
	});

	it('rejects an empty object', async () => {
		expect(await readWebAuthnBody(post('{}'))).toBeNull();
	});

	it('rejects a null or primitive body', async () => {
		expect(await readWebAuthnBody(post('null'))).toBeNull();
		expect(await readWebAuthnBody(post('42'))).toBeNull();
	});

	it('rejects a response that is not an object', async () => {
		expect(await readWebAuthnBody(post(JSON.stringify({ response: 'abc' })))).toBeNull();
	});

	it('rejects a credential id that is not a non-empty string', async () => {
		expect(await readWebAuthnBody(post(JSON.stringify({ response: { id: {} } })))).toBeNull();
		expect(await readWebAuthnBody(post(JSON.stringify({ response: { id: 7 } })))).toBeNull();
		expect(await readWebAuthnBody(post(JSON.stringify({ response: { id: '' } })))).toBeNull();
		expect(await readWebAuthnBody(post(JSON.stringify({ response: {} })))).toBeNull();
	});
});
