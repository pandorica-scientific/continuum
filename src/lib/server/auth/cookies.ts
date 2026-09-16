// SPDX-License-Identifier: AGPL-3.0-or-later
// One place decides whether an auth cookie locks itself to HTTPS, per request
// rather than per instance: the same server can be reached over https through
// a proxy and over plain http on the LAN at once, and a `Secure` cookie set on
// an http response is silently dropped by the browser. Https is detected from
// the proxy's `X-Forwarded-Proto`, since the app itself only ever speaks http.

import { AsyncLocalStorage } from 'node:async_hooks';

const current = new AsyncLocalStorage<boolean>();

/** Whether the browser reached this request over https, as the proxy reports it. */
export function requestIsSecure(request: Request): boolean {
	return request.headers.get('x-forwarded-proto')?.toLowerCase() === 'https';
}

/** Run `fn` with `cookieSecure()` answering for this request, awaits included. */
export function withRequest<T>(request: Request, fn: () => T): T {
	return current.run(requestIsSecure(request), fn);
}

export function cookieSecure(): boolean {
	// Outside a request — a test, a script — there is no browser to protect a
	// cookie from, and `false` is the value that cannot lock anyone out.
	return current.getStore() ?? false;
}
