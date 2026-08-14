import { describe, expect, it } from 'vitest';
import { problemMessage } from '$lib/http';

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('problemMessage', () => {
	// The point of the helper: the rate limiter's "try again in 3 minutes" has to
	// reach the person, not be replaced by the caller's generic sentence.
	it('prefers the server wording', async () => {
		const response = json({ message: 'Too many failed attempts — try again in 3 minutes.' }, 429);
		expect(await problemMessage(response, 'fallback')).toContain('3 minutes');
	});

	it('explains an expired session when the body says nothing', async () => {
		expect(await problemMessage(new Response('', { status: 401 }), 'fallback')).toContain(
			'expired'
		);
	});

	it('falls back when the body is not JSON', async () => {
		const html = new Response('<!doctype html><html></html>', { status: 500 });
		expect(await problemMessage(html, 'fallback')).toBe('fallback');
	});

	it('falls back when the message is absent or not a string', async () => {
		expect(await problemMessage(json({}, 400), 'fallback')).toBe('fallback');
		expect(await problemMessage(json({ message: 42 }, 400), 'fallback')).toBe('fallback');
		expect(await problemMessage(json({ message: '' }, 400), 'fallback')).toBe('fallback');
	});
});
