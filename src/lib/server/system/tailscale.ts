// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The instance's own https address, learned from the Tailscale sidecar rather
 * than typed into a file.
 *
 * Passkeys and secure cookies are bound to one https origin, and until now that
 * origin was `ORIGIN` in `.env` — a value nobody knows before Tailscale has
 * issued the machine its name, which meant a first start, a look at the logs,
 * an edit and a restart. The sidecar already knows the name: its local API
 * reports it, and compose shares that API's unix socket into this container.
 * So the app asks, and keeps asking until the answer arrives, and `ORIGIN`
 * becomes an override for people who terminate TLS some other way.
 *
 * Reading the socket rather than a forwarded header is what makes this safe to
 * trust: a header can be written by anyone who can reach the port, the socket
 * only by tailscaled.
 */

import { request } from 'node:http';
import { access } from 'node:fs/promises';
import { env } from '$env/dynamic/private';

/** Where the tailscale/tailscale image puts its socket; compose mounts the directory. */
const DEFAULT_SOCKET = '/var/run/tailscale/tailscaled.sock';

/** The slice of `tailscale status --json` this cares about. */
interface LocalStatus {
	BackendState?: string;
	/** Names the node can obtain a certificate for; null until HTTPS is enabled on the tailnet. */
	CertDomains?: string[] | null;
	Self?: { DNSName?: string };
}

/**
 * `https://<node name>` once the sidecar is on the tailnet with HTTPS enabled,
 * null in every other state — no socket (development, a plain-LAN install),
 * not signed in yet, HTTPS certificates not switched on in the admin console.
 * Never throws: the caller is a boot-time poll that must survive anything.
 */
export async function discoverTailscaleOrigin(
	socketPath: string = env.TS_SOCKET || DEFAULT_SOCKET
): Promise<string | null> {
	try {
		await access(socketPath);
	} catch {
		waiting = null; // no sidecar at all: nothing to wait for, nothing to say
		return null;
	}
	let status: LocalStatus;
	try {
		status = await localApi(socketPath, '/localapi/v0/status');
	} catch {
		waiting = 'the sidecar is starting';
		return null;
	}
	if (status.BackendState !== 'Running') {
		waiting =
			status.BackendState === 'NeedsLogin'
				? 'the sidecar is not signed in to a tailnet — set TS_AUTHKEY, or open the login URL in `docker compose logs tailscale`'
				: `the sidecar reports ${status.BackendState ?? 'no state'}`;
		return null;
	}
	const name = status.Self?.DNSName?.replace(/\.$/, '');
	if (!name) {
		waiting =
			'the tailnet has not issued the machine a name — enable MagicDNS in the admin console';
		return null;
	}
	// The certificate is what makes the address https; without one the browser
	// would refuse the connection rather than the passkey.
	if (!status.CertDomains?.some((d) => d.toLowerCase() === name.toLowerCase())) {
		waiting = `${name} has no certificate — enable HTTPS certificates under DNS in the admin console`;
		return null;
	}
	waiting = null;
	return `https://${name.toLowerCase()}`;
}

/** Why the last discovery came back empty, in words for the log; null when it did not. */
let waiting: string | null = null;

function localApi<T>(socketPath: string, path: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const req = request(
			// tailscaled refuses a LocalAPI request whose Host is anything else.
			{ socketPath, path, method: 'GET', headers: { host: 'local-tailscaled.sock' } },
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c: Buffer) => chunks.push(c));
				res.on('end', () => {
					if (res.statusCode !== 200) return reject(new Error(`LocalAPI ${res.statusCode}`));
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
					} catch (err) {
						reject(err);
					}
				});
			}
		);
		req.setTimeout(3000, () => req.destroy(new Error('LocalAPI timeout')));
		req.on('error', reject);
		req.end();
	});
}

let discovered = '';

/** The origin learned from the sidecar so far; '' until it has answered. */
export function discoveredOrigin(): string {
	return discovered;
}

/**
 * Ask the sidecar now, and keep asking on an interval until it answers — it
 * comes up beside the app and may still be waiting for its key, or for the
 * person to click the login link in its log. Stops once found: the name a node
 * has is the name it keeps for as long as the state volume lives.
 */
export function watchTailscaleOrigin(intervalMs = 15_000): void {
	if (env.ORIGIN) return; // configured by hand: nothing to discover
	let said: string | null = null;
	const poll = async () => {
		const origin = await discoverTailscaleOrigin();
		if (!origin) {
			// Say what it is waiting for, once per reason, so the log answers
			// "why is there no https address yet" without a restart.
			if (waiting && waiting !== said) console.log(`Tailscale: waiting — ${waiting}`);
			said = waiting;
			return;
		}
		discovered = origin;
		console.log(`Tailscale: reachable at ${origin}`);
		clearInterval(timer);
	};
	const timer = setInterval(() => void poll(), intervalMs);
	void poll();
}

/**
 * Where a plain-http request that came through the sidecar should go instead,
 * or null when it should be served as it is.
 *
 * The sidecar listens on plain port 80 as well as 443 so that `continuum/` —
 * the bare MagicDNS name, typed into any browser on the tailnet — reaches the
 * app at all. Nothing can be done at that address (no secure context, so no
 * passkeys and no camera), so it is a doorway: the app answers with its full
 * https name. Only a request the sidecar forwarded qualifies, and only for
 * this instance's own name or its first label; a LAN request arrives with no
 * forwarded headers and is left alone, because a device without Tailscale
 * could not follow the redirect.
 */
export function shortNameRedirect(req: Request, origin: string): string | null {
	if (!origin.startsWith('https://')) return null;
	if (req.headers.get('x-forwarded-proto') !== 'http') return null;
	const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '')
		.toLowerCase()
		.replace(/:\d+$/, '');
	if (!host) return null;
	const full = new URL(origin).hostname;
	if (host !== full && !full.startsWith(host + '.')) return null;
	const url = new URL(req.url);
	return `${origin}${url.pathname}${url.search}`;
}
