// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Cross-site request forgery, checked against the address the browser actually
 * used rather than against one configured address.
 *
 * SvelteKit ships this check and it is turned off in `vite.config.ts`, because
 * its comparison is `Origin` against `url.origin` — and adapter-node takes
 * `url.origin` from the `ORIGIN` environment variable. That names ONE address,
 * so a household that reaches its ledger at `http://continuum.local` on a
 * laptop and `http://192.168.1.40` on a phone had every form post from the
 * phone refused, sign-in first. The refusal was `text/plain`, which Safari
 * offers to save, so the reported symptom was "it tried to download login.txt".
 *
 * The check itself is not weakened. A page on `evil.com` still cannot post
 * here: its `Origin` says `evil.com` while the `Host` says yours, and they
 * still have to match. What is dropped is the assumption that the server knows
 * its own name in advance.
 *
 * SCHEME IS NOT COMPARED, deliberately. The app always speaks HTTP and learns
 * about TLS only from a proxy header a plain LAN deployment does not have, so
 * comparing schemes would mean guessing — and guessing `https`, which is
 * adapter-node's own default, is exactly what breaks a LAN address. The
 * residual gap is an attacker who can already forge `Host` or terminate TLS
 * inside the network, who is past this fence either way.
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
	// Behind a proxy — the Tailscale sidecar, or somebody's own — `Host` is
	// whatever the proxy dialled, and the address the person actually typed is
	// in `X-Forwarded-Host`. That is the one to compare against `Origin`.
	return request.headers.get('x-forwarded-host') ?? request.headers.get('host');
}

/** Whether this request may proceed. False means refuse it. */
export function sameSiteFormPost(request: Request): boolean {
	if (!UNSAFE.has(request.method)) return true;

	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!FORM_TYPES.has(type)) return true;

	const origin = request.headers.get('origin');
	const host = browsedHost(request);
	// No origin is a refusal, matching the behaviour this replaces. Every browser
	// sends one on these methods; something that does not is not a browser, and
	// the API boundary authenticates itself with a bearer token instead.
	if (!origin || !host) return false;

	try {
		return new URL(origin).host === host;
	} catch {
		// An origin that will not parse is not one to trust.
		return false;
	}
}

/**
 * The refusal, as a page rather than as a body the browser saves to disk.
 *
 * The old one was `text/plain`, and Safari's response to a plain-text body
 * arriving from a form submission is to offer it as a download — so a person
 * whose sign-in was refused got a file called `login.txt` and no idea why.
 *
 * It names both addresses, because the mismatch between them IS the problem
 * and neither is a secret: the browser sent one and this server saw the other.
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
