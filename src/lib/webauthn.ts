// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The browser half of a WebAuthn ceremony, which is the same shape whether you
// are registering a passkey or signing in with one: ask the server for options,
// hand them to the authenticator, post what it returns back for verification.
//
// Shared because the fragile part is the cancel filter. Dismissing the system
// prompt is a deliberate act, not a failure, and it arrives as a DOMException
// whose `name` is the only thing distinguishing it from a real error. That list
// is the sort of thing that grows, and it should grow in one place.

import { problemMessage } from '$lib/http';

const CANCELLED = ['NotAllowedError', 'AbortError'];

interface CeremonyResult {
	ok: boolean;
	/** Empty when the person simply cancelled — nothing to report in that case. */
	error: string;
}

export async function runCeremony<Options, Response>(
	optionsUrl: string,
	verifyUrl: string,
	start: (args: { optionsJSON: Options }) => Promise<Response>,
	// A thunk, not a value: registration asks the person to name the device, and
	// that prompt belongs after the biometric rather than before it.
	extra: () => Record<string, unknown> = () => ({}),
	fallback = 'That passkey was not accepted.'
): Promise<CeremonyResult> {
	try {
		const optionsResponse = await fetch(optionsUrl, { method: 'POST' });
		if (!optionsResponse.ok) throw new Error(await problemMessage(optionsResponse, fallback));
		const optionsJSON = (await optionsResponse.json()) as Options;

		const response = await start({ optionsJSON });

		const verify = await fetch(verifyUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ response, ...extra() })
		});
		// Carries the server's own wording, so being rate limited reads as "try
		// again in 3 minutes" rather than as a rejected passkey.
		if (!verify.ok) throw new Error(await problemMessage(verify, fallback));

		return { ok: true, error: '' };
	} catch (err) {
		if (CANCELLED.includes(String((err as { name?: string }).name))) {
			return { ok: false, error: '' };
		}
		return { ok: false, error: err instanceof Error ? err.message : fallback };
	}
}
