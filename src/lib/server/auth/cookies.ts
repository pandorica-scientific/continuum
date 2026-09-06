// SPDX-License-Identifier: AGPL-3.0-or-later
// One place decides whether an auth cookie locks itself to HTTPS.
//
// The answer belongs to the request, not to the instance. The same server can
// be reached over https through a proxy and over plain http on the LAN at
// once, and a `Secure` cookie set on an http response is silently dropped by
// the browser — so deciding from a configured https address alone would lock
// every LAN sign-in out the moment one was configured. The app
// itself only ever speaks http; whether the browser used https is what the
// proxy in front says in `X-Forwarded-Proto`, and a request without that
// header came straight to the container's port.
//
// One place, so a second cookie can never disagree with the first.

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
