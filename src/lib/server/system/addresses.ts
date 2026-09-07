// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The addresses this instance can be reached at, worked out rather than
 * configured, so the setup wizard and Settings can tell people what to type.
 *
 * The app container knows nothing about the machine it runs on: its own
 * hostname is a container ID and its addresses are Docker's. The announcer
 * service does know — it runs on the host's network and shares its name —
 * and writes what it sees to a file on a volume both containers mount. This
 * module reads that file and turns it into addresses, with an honest note on
 * each: the bare name works only where the router names devices, `.local`
 * works everywhere except Android, an IP works anywhere.
 */

import { readFile } from 'node:fs/promises';
import { env } from '$env/dynamic/private';

/** What the announcer writes: the host as it sees itself. */
export interface NetworkFacts {
	hostname: string;
	/** IPv4 addresses on the host's interfaces, loopback excluded. */
	addresses: string[];
}

export interface Reachable {
	url: string;
	/** When it works, in words a household reads on the setup screen. */
	note: string;
}

/** Where the announcer leaves its facts; compose mounts the same volume in both. */
const DEFAULT_FACTS_FILE = '/run/continuum/network.json';

/** Names that are a container's or a VM's, not the machine's, and say nothing. */
const MEANINGLESS_HOSTS = new Set([
	'localhost',
	'docker-desktop',
	'moby',
	'linuxkit',
	'buildkitsandbox'
]);

/**
 * Docker Desktop runs containers in a VM whose name and addresses are its
 * own, not the Mac's or the PC's; nothing it reports reaches a phone.
 */
function isVirtualHost(hostname: string | undefined | null): boolean {
	const first = (hostname ?? '').trim().toLowerCase().split('.')[0];
	return first === 'docker-desktop' || first === 'linuxkit';
}

/**
 * The bare machine name, or null when the name would mislead: empty, a
 * placeholder, or a container ID. A fully qualified name is cut to its first
 * label, which is what the router registers and what `.local` prepends.
 */
export function machineName(hostname: string | undefined | null): string | null {
	const first = (hostname ?? '').trim().toLowerCase().split('.')[0];
	if (!first || MEANINGLESS_HOSTS.has(first)) return null;
	// A bare container ID: twelve hex characters and nothing a person chose.
	if (/^[0-9a-f]{12}$/.test(first)) return null;
	return first;
}

/** Docker's own bridge ranges, which a phone can never reach. */
function isDockerInternal(address: string): boolean {
	const [a, b] = address.split('.').map(Number);
	// 172.16.0.0/12 is what Docker carves its networks from by default; a home
	// LAN is 192.168/16 or 10/8 essentially always.
	return a === 172 && b >= 16 && b <= 31;
}

/**
 * Every address worth showing, best first.
 *
 * `name` is the announced `.local` name (CONTINUUM_NAME) and `port` the host
 * port the app is published on; anything but 80 has to be typed, so it is
 * appended wherever it applies.
 */
export function reachableAddresses(
	facts: NetworkFacts | null,
	options: { name: string; port: number; browsing?: string }
): Reachable[] {
	const suffix = options.port === 80 ? '' : `:${options.port}`;
	const out: Reachable[] = [];
	// Docker Desktop: the announcer is inside a VM, so nothing it answers
	// reaches the network and `continuum.local` cannot work here. The Mac or
	// PC still publishes the port under its own name — which the browser used
	// to get here, so that is the address to show.
	if (isVirtualHost(facts?.hostname)) {
		const here = (options.browsing ?? '').toLowerCase().replace(/:\d+$/, '');
		if (here && here !== 'localhost' && here !== '127.0.0.1') {
			out.push({
				url: `http://${here}${suffix}`,
				note: 'this computer’s own name; every device except Android'
			});
		}
		out.push({ url: `http://localhost${suffix}`, note: 'on this computer' });
		return out;
	}
	const host = machineName(facts?.hostname);
	if (host && host !== options.name) {
		out.push({
			url: `http://${host}${suffix}/`,
			note: 'the shortest — works when your router names devices, which most do'
		});
		out.push({
			url: `http://${host}.local${suffix}`,
			note: 'the machine’s own name; every device except Android'
		});
	}
	out.push({
		url: `http://${options.name}.local${suffix}`,
		note: 'announced by Continuum itself; every device except Android'
	});
	for (const address of facts?.addresses ?? []) {
		if (isDockerInternal(address)) continue;
		out.push({
			url: `http://${address}${suffix}`,
			note: 'any device, as long as the address stays put'
		});
	}
	return out;
}

/** The announcer's facts, or null when it has not written any (yet, or ever). */
export async function readNetworkFacts(
	path: string = env.CONTINUUM_NETWORK_FILE || DEFAULT_FACTS_FILE
): Promise<NetworkFacts | null> {
	try {
		const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<NetworkFacts>;
		return {
			hostname: typeof parsed.hostname === 'string' ? parsed.hostname : '',
			addresses: Array.isArray(parsed.addresses)
				? parsed.addresses.filter((a): a is string => typeof a === 'string')
				: []
		};
	} catch {
		return null;
	}
}

/**
 * The addresses as the screens show them, from the environment and the
 * announcer. `browsing` is the host the current request came in on — what
 * somebody actually typed — which is the one true address on a machine the
 * announcer cannot describe.
 */
export async function currentAddresses(browsing?: string): Promise<Reachable[]> {
	const port = Number(env.CONTINUUM_PORT) || 80;
	const name = (env.CONTINUUM_NAME || 'continuum')
		.trim()
		.toLowerCase()
		.replace(/\.local$/, '');
	return reachableAddresses(await readNetworkFacts(), { name, port, browsing });
}
