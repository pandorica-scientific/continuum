// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverTailscaleOrigin, shortNameRedirect } from '$lib/server/system/tailscale';

/** A stand-in for tailscaled's LocalAPI, answering /localapi/v0/status on a unix socket. */
function fakeTailscaled(status: unknown): { socket: string; close: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'ts-'));
	const socket = join(dir, 'tailscaled.sock');
	const server: Server = createServer((req, res) => {
		if (req.url !== '/localapi/v0/status') {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(status));
	});
	server.listen(socket);
	return {
		socket,
		close: () => {
			server.close();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}

describe('discoverTailscaleOrigin', () => {
	const cleanups: (() => void)[] = [];
	afterEach(() => cleanups.splice(0).forEach((c) => c()));

	it('reads the node name off the sidecar and makes an https origin of it', async () => {
		const ts = fakeTailscaled({
			BackendState: 'Running',
			CertDomains: ['continuum.tail1234.ts.net'],
			Self: { DNSName: 'continuum.tail1234.ts.net.' }
		});
		cleanups.push(ts.close);
		expect(await discoverTailscaleOrigin(ts.socket)).toBe('https://continuum.tail1234.ts.net');
	});

	it('is nothing while the sidecar is still waiting to be signed in', async () => {
		const ts = fakeTailscaled({ BackendState: 'NeedsLogin', CertDomains: null, Self: {} });
		cleanups.push(ts.close);
		expect(await discoverTailscaleOrigin(ts.socket)).toBeNull();
	});

	it('is nothing when the tailnet has no HTTPS certificates enabled', async () => {
		// A node with a name but no certificate domain cannot serve HTTPS, so an
		// https:// origin built from it would be a promise the browser cannot keep.
		const ts = fakeTailscaled({
			BackendState: 'Running',
			CertDomains: null,
			Self: { DNSName: 'continuum.tail1234.ts.net.' }
		});
		cleanups.push(ts.close);
		expect(await discoverTailscaleOrigin(ts.socket)).toBeNull();
	});

	it('is nothing when there is no socket at all, as in development', async () => {
		expect(await discoverTailscaleOrigin('/nonexistent/tailscaled.sock')).toBeNull();
	});
});

describe('shortNameRedirect', () => {
	const ORIGIN = 'https://continuum.tail1234.ts.net';
	const req = (headers: Record<string, string>, path = '/overview?x=1') =>
		new Request(`http://placeholder${path}`, { headers });

	it('sends the MagicDNS short name to the full https address', () => {
		// Typing `continuum/` on a tailnet device lands on the sidecar's plain-http
		// listener with the bare machine name as the host.
		const r = req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'continuum' });
		expect(shortNameRedirect(r, ORIGIN)).toBe('https://continuum.tail1234.ts.net/overview?x=1');
	});

	it('sends the full name typed over http to https', () => {
		const r = req({
			'x-forwarded-proto': 'http',
			'x-forwarded-host': 'continuum.tail1234.ts.net'
		});
		expect(shortNameRedirect(r, ORIGIN)).toBe('https://continuum.tail1234.ts.net/overview?x=1');
	});

	it('leaves a direct LAN request alone', () => {
		// No forwarded headers: the browser reached the container's own port, and
		// a LAN device without Tailscale could not follow a .ts.net redirect.
		expect(shortNameRedirect(req({ host: '192.168.1.40' }), ORIGIN)).toBeNull();
		expect(shortNameRedirect(req({ host: 'continuum.local' }), ORIGIN)).toBeNull();
	});

	it('leaves a request that is already https alone', () => {
		const r = req({
			'x-forwarded-proto': 'https',
			'x-forwarded-host': 'continuum.tail1234.ts.net'
		});
		expect(shortNameRedirect(r, ORIGIN)).toBeNull();
	});

	it('does nothing while no https origin is known', () => {
		const r = req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'continuum' });
		expect(shortNameRedirect(r, '')).toBeNull();
		expect(shortNameRedirect(r, 'http://continuum.local')).toBeNull();
	});

	it('does not redirect a host that is not this instance', () => {
		// Somebody else's proxy forwarding plain http for a name that is not ours:
		// redirecting would bounce them to an address they did not ask for.
		const r = req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'ledger.example.com' });
		expect(shortNameRedirect(r, ORIGIN)).toBeNull();
	});
});
