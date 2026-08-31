// SPDX-License-Identifier: AGPL-3.0-or-later
import { applyAction, deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import type { ActionResult } from '@sveltejs/kit';

export type ActionOutcome =
	{ type: 'success'; message: null } | { type: 'failure' | 'error' | 'redirect'; message: string };

const GENERIC_ACTION_ERROR = 'The request could not be completed. Please try again.';

type ActionDependencies = {
	deserialize: (body: string) => ActionResult<Record<string, unknown>, Record<string, unknown>>;
	applyAction: (
		result: ActionResult<Record<string, unknown>, Record<string, unknown>>
	) => Promise<void>;
	invalidateAll: () => Promise<void>;
};

interface ActionResponseOptions {
	/** Autosaves own their local status and must not reload page data or replace
	 * the page's unrelated enhanced-form result. */
	updatePage?: boolean;
}

const browserDependencies: ActionDependencies = { deserialize, applyAction, invalidateAll };

function messageFor<
	Success extends Record<string, unknown> | undefined,
	Failure extends Record<string, unknown> | undefined
>(result: ActionResult<Success, Failure>): string {
	if ('data' in result && result.data && typeof result.data.message === 'string') {
		return result.data.message;
	}
	return GENERIC_ACTION_ERROR;
}

/** Keep an enhanced-form failure visible in the component that owns the form.
 * Page-level action data can sit behind a modal's inert backdrop, so dialogs
 * should render this message locally while retaining their draft. */
export function messageFromActionResult<
	Success extends Record<string, unknown> | undefined,
	Failure extends Record<string, unknown> | undefined
>(result: ActionResult<Success, Failure>): string | null {
	return result.type === 'success' ? null : messageFor(result);
}

/** Apply a SvelteKit action result from an explicit fetch request.
 *
 * Action failures are valid SvelteKit responses even when their HTTP status is
 * not in the 2xx range, so they must be deserialized and applied rather than
 * mistaken for a transport failure. */
export async function applyActionResponse(
	response: Response,
	dependencies: ActionDependencies = browserDependencies,
	options: ActionResponseOptions = {}
): Promise<ActionOutcome> {
	const body = await response.text();
	let result: ActionResult<Record<string, unknown>, Record<string, unknown>>;
	try {
		result = dependencies.deserialize(body);
	} catch {
		return { type: 'error', message: `Request failed (${response.status}).` };
	}

	if (result.type === 'success' && options.updatePage !== false) {
		await dependencies.invalidateAll();
		await dependencies.applyAction(result);
	}
	if (result.type !== 'success' && options.updatePage !== false) {
		await dependencies.applyAction(result);
	}
	if (result.type === 'success') return { type: 'success', message: null };
	return { type: result.type, message: messageFor(result) };
}

/** Submit an endpoint action without losing its SvelteKit form semantics. */
export async function submitAction(
	action: string | URL,
	body: FormData,
	options: ActionResponseOptions = {}
): Promise<ActionOutcome> {
	try {
		const response = await fetch(action, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		return await applyActionResponse(response, browserDependencies, options);
	} catch {
		return { type: 'error', message: 'Network error. Please try again.' };
	}
}

/** Best-effort durable send for a page exit. The request body is deliberately
 * small and needs no response handling because the document is leaving. */
export function sendActionForPageExit(action: string | URL, body: FormData): void {
	try {
		void fetch(action, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' },
			keepalive: true
		}).catch(() => undefined);
	} catch {
		// A browser may reject a keepalive body above its implementation limit.
		// There is no useful UI surface left while a page is exiting.
	}
}

export function shouldCloseAfterAction(
	type: ActionOutcome['type'] | ActionResult['type']
): boolean {
	return type === 'success';
}
