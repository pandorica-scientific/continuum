import { describe, expect, it, vi } from 'vitest';
import {
	applyActionResponse,
	messageFromActionResult,
	sendActionForPageExit,
	shouldCloseAfterAction
} from '$lib/actions/result';

describe('applyActionResponse', () => {
	it('applies an action failure without invalidating the page', async () => {
		const apply = vi.fn(async () => {});
		const invalidate = vi.fn(async () => {});

		const outcome = await applyActionResponse(new Response('failure', { status: 400 }), {
			deserialize: () => ({ type: 'failure', status: 400, data: { message: 'Choose a file' } }),
			applyAction: apply,
			invalidateAll: invalidate
		});

		expect(outcome).toEqual({ type: 'failure', message: 'Choose a file' });
		expect(apply).toHaveBeenCalledOnce();
		expect(invalidate).not.toHaveBeenCalled();
	});

	it('applies and invalidates after a successful action', async () => {
		const order: string[] = [];
		const apply = vi.fn(async () => {});
		apply.mockImplementation(async () => {
			order.push('apply');
		});
		const invalidate = vi.fn(async () => {
			order.push('invalidate');
		});

		const outcome = await applyActionResponse(new Response('success'), {
			deserialize: () => ({ type: 'success', status: 200, data: {} }),
			applyAction: apply,
			invalidateAll: invalidate
		});

		expect(outcome).toEqual({ type: 'success', message: null });
		expect(apply).toHaveBeenCalledOnce();
		expect(invalidate).toHaveBeenCalledOnce();
		// Match SvelteKit's enhanced-form fallback: refresh loader data first,
		// then install the action payload so the refresh cannot erase it.
		expect(order).toEqual(['invalidate', 'apply']);
	});

	it('can decode an autosave response without invalidating or replacing page form state', async () => {
		const apply = vi.fn(async () => {});
		const invalidate = vi.fn(async () => {});

		const outcome = await applyActionResponse(
			new Response('success'),
			{
				deserialize: () => ({ type: 'success', status: 200, data: {} }),
				applyAction: apply,
				invalidateAll: invalidate
			},
			{ updatePage: false }
		);

		expect(outcome).toEqual({ type: 'success', message: null });
		expect(apply).not.toHaveBeenCalled();
		expect(invalidate).not.toHaveBeenCalled();
	});

	it('returns a local autosave rejection for the owning component to display', async () => {
		const apply = vi.fn(async () => {});
		const invalidate = vi.fn(async () => {});

		const outcome = await applyActionResponse(
			new Response('failure', { status: 409 }),
			{
				deserialize: () => ({
					type: 'failure',
					status: 409,
					data: { message: 'Reload before editing again.' }
				}),
				applyAction: apply,
				invalidateAll: invalidate
			},
			{ updatePage: false }
		);

		expect(outcome).toEqual({ type: 'failure', message: 'Reload before editing again.' });
		expect(apply).not.toHaveBeenCalled();
		expect(invalidate).not.toHaveBeenCalled();
	});

	it('turns an unparseable response into a local error', async () => {
		const apply = vi.fn(async () => {});

		const outcome = await applyActionResponse(new Response('proxy failure', { status: 502 }), {
			deserialize: () => {
				throw new Error('not an action result');
			},
			applyAction: apply,
			invalidateAll: vi.fn(async () => {})
		});

		expect(outcome).toEqual({ type: 'error', message: 'Request failed (502).' });
		expect(apply).not.toHaveBeenCalled();
	});

	it('gives every non-success action shape a visible fallback message', async () => {
		const outcome = await applyActionResponse(new Response('redirect'), {
			deserialize: () => ({ type: 'redirect', status: 303, location: '/elsewhere' }),
			applyAction: vi.fn(async () => {}),
			invalidateAll: vi.fn(async () => {})
		});

		expect(outcome).toEqual({
			type: 'redirect',
			message: 'The request could not be completed. Please try again.'
		});
	});

	it('sends a small unload-safe action request with keepalive enabled', async () => {
		const fetch = vi.fn(() => Promise.resolve(new Response()));
		vi.stubGlobal('fetch', fetch);

		sendActionForPageExit('/retirement?/save', new FormData());

		expect(fetch).toHaveBeenCalledWith(
			'/retirement?/save',
			expect.objectContaining({
				method: 'POST',
				keepalive: true,
				headers: { 'x-sveltekit-action': 'true' }
			})
		);
		vi.unstubAllGlobals();
	});
});

describe('shouldCloseAfterAction', () => {
	it('closes only after success, retaining a failed dialog draft', () => {
		expect(shouldCloseAfterAction('success')).toBe(true);
		expect(shouldCloseAfterAction('failure')).toBe(false);
		expect(shouldCloseAfterAction('error')).toBe(false);
	});
});

describe('messageFromActionResult', () => {
	it('keeps a server validation message available inside an open dialog', () => {
		expect(
			messageFromActionResult({
				type: 'failure',
				status: 400,
				data: { message: 'The lines no longer balance.' }
			})
		).toBe('The lines no longer balance.');
	});

	it('returns no message after success and a safe fallback for other failures', () => {
		expect(messageFromActionResult({ type: 'success', status: 200, data: {} })).toBeNull();
		expect(
			messageFromActionResult({ type: 'error', status: 500, error: new Error('private') })
		).toBe('The request could not be completed. Please try again.');
	});
});
