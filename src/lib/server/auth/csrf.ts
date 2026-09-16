// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Cross-site request forgery, checked against the address the browser actually
 * used rather than against one configured `ORIGIN` (SvelteKit's own check,
 * disabled in `vite.config.ts`) — a household reaching the app at more than
 * one LAN address needs `Origin` compared against the real `Host`, not a
 * single configured address.
 *
 * Scheme is deliberately not compared: the app only speaks HTTP and has no
 * reliable way to know if a LAN client used https.
 */

/** The methods a browser can use to change state from another site. */
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The three content types a browser will send cross-origin without asking
 * permission first. Anything else needs CORS, and the browser enforces that
 * before the request ever arrives here.
 */
const FORM_TYPES = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain'
]);

/** The address the browser put in its URL bar, as this server can see it. */
function browsedHost(request: Request): string | null {
	// Behind a reverse proxy, `X-Forwarded-Host` carries the address the person
	// actually typed; `Host` is whatever the proxy dialled.
	return request.headers.get('x-forwarded-host') ?? request.headers.get('host');
}

/** Whether this request may proceed. False means refuse it. */
export function sameSiteFormPost(request: Request): boolean {
	if (!UNSAFE.has(request.method)) return true;

	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!FORM_TYPES.has(type)) return true;

	const origin = request.headers.get('origin');
	const host = browsedHost(request);
	// Every browser sends Origin on these methods; the API boundary
	// authenticates itself with a bearer token instead.
	if (!origin || !host) return false;

	try {
		return new URL(origin).host === host;
	} catch {
		// An origin that will not parse is not one to trust.
		return false;
	}
}

/**
 * The refusal, as an HTML page rather than `text/plain` — Safari offers a
 * plain-text form response as a download instead of showing it.
 */
export function csrfRefusal(request: Request): Response {
	const origin = request.headers.get('origin') ?? 'none';
	const host = browsedHost(request) ?? 'unknown';
	const body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>That form was not accepted</title>
<style>
	body { margin: 0; padding: 48px 20px; font-family: system-ui, sans-serif; line-height: 1.55;
	       background: #0e1117; color: #e6e8eb; }
	main { max-width: 34rem; margin: 0 auto; }
	h1 { font-size: 1.4rem; margin: 0 0 0.75rem; }
	p { color: #a9b0b8; }
	dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 1.25rem 0; }
	dt { color: #a9b0b8; }
	dd { margin: 0; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
</style>
</head>
<body><main>
	<h1>That form was not accepted</h1>
	<p>The page it came from names a different address from the one this server
	answered on, so it was refused. That is the protection against another site
	posting here on your behalf.</p>
	<dl>
		<dt>The page said</dt><dd>${escapeHtml(origin)}</dd>
		<dt>This server saw</dt><dd>${escapeHtml(host)}</dd>
	</dl>
	<p>If both of those are yours, something between your browser and this server
	is rewriting the address — a proxy that does not pass on
	<code>X-Forwarded-Host</code> is the usual cause.</p>
</main></body>
</html>`;
	return new Response(body, {
		status: 403,
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});
}

/** Neither value is attacker-controlled in any useful way, but both are echoed
 *  into markup, and echoing a header into markup unescaped is how that stops
 *  being true. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
