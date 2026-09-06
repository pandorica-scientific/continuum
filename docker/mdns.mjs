// SPDX-License-Identifier: AGPL-3.0-or-later
// Answers `continuum.local` on the local network, so the address is a name
// rather than an IP on every device that speaks mDNS — iPhones, iPads, Macs,
// Windows, Linux — with nothing installed and nothing typed into a router.
//
// Runs as its own service in compose.yaml, on the host's network, so the
// multicast reaches the LAN and the addresses it hands out are the host's
// own. It shares port 5353 with whatever mDNS daemon the host already runs;
// both answer, for different names.
//
// Android is the one platform whose browsers do not resolve `.local`; for it
// the router's own DNS name is the route, and docs/networking.md says so.
//
// Plain JavaScript, run by node in the image outside the build, typed with
// JSDoc so the checker still reads it. Its pure parts are covered by
// tests/unit/mdns.test.ts.

import { hostname, networkInterfaces } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import mdns from 'multicast-dns';

/**
 * @typedef {{ address: string; netmask: string; family: string | number; internal: boolean }} Nic
 * @typedef {Record<string, Nic[] | undefined>} Interfaces
 * @typedef {{ name?: string; type?: string }} Question
 * @typedef {{ name: string; type: 'A'; ttl: number; class: 'IN'; flush: boolean; data: string }} Answer
 */

/**
 * The name answered, from CONTINUUM_NAME, as a fully qualified `.local`.
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function localName(env = process.env) {
	const base = (env.CONTINUUM_NAME || 'continuum')
		.trim()
		.toLowerCase()
		.replace(/\.local$/, '');
	return `${base}.local`;
}

/**
 * The IPv4 addresses to answer with for a query that came from `from`.
 *
 * A host has one address per network — Ethernet, Wi-Fi, a Docker bridge — and
 * a phone can only use the one on its own subnet. So the address on the same
 * subnet as the asker is the answer; when no interface matches (a query
 * relayed, or an address the host cannot place) every address is offered and
 * the device picks.
 *
 * @param {Interfaces} interfaces `os.networkInterfaces()` or a stand-in shaped like it
 * @param {string | null | undefined} from the asker's address
 * @returns {string[]}
 */
export function chooseAddresses(interfaces, from) {
	/** @type {Nic[]} */
	const candidates = [];
	for (const list of Object.values(interfaces)) {
		for (const nic of list ?? []) {
			if (nic.family !== 'IPv4' && nic.family !== 4) continue;
			if (nic.internal) continue;
			candidates.push(nic);
		}
	}
	const asker = ipv4ToInt(from);
	const same =
		asker === null
			? []
			: candidates.filter((nic) => {
					const address = ipv4ToInt(nic.address);
					const mask = ipv4ToInt(nic.netmask);
					return address !== null && mask !== null && (address & mask) === (asker & mask);
				});
	return (same.length ? same : candidates).map((nic) => nic.address);
}

/**
 * @param {string | null | undefined} address
 * @returns {number | null}
 */
function ipv4ToInt(address) {
	const parts = String(address ?? '').split('.');
	if (parts.length !== 4) return null;
	let n = 0;
	for (const part of parts) {
		const octet = Number(part);
		if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
		n = (n << 8) | octet;
	}
	return n >>> 0;
}

/**
 * The answer section for one query, or null when the query is not for us.
 * Pure, so it can be tested without a socket.
 *
 * @param {{ questions?: Question[] }} query
 * @param {string} name
 * @param {Interfaces} interfaces
 * @param {string | null | undefined} from
 * @returns {Answer[] | null}
 */
export function answersFor(query, name, interfaces, from) {
	const asked = (query.questions ?? []).some(
		(q) => q.name?.toLowerCase() === name && (q.type === 'A' || q.type === 'ANY')
	);
	if (!asked) return null;
	return chooseAddresses(interfaces, from).map((address) => ({
		name,
		type: 'A',
		ttl: 120,
		class: 'IN',
		flush: true,
		data: address
	}));
}

/**
 * What the app cannot see from inside its own container: the machine's name
 * and LAN addresses. Written to a file on a volume the app also mounts, so
 * the setup wizard can say which addresses work. Rewritten on a timer
 * because a Wi-Fi address can change.
 * @param {string} file
 */
function writeFacts(file) {
	const facts = {
		hostname: hostname(),
		addresses: chooseAddresses(networkInterfaces(), null),
		writtenAt: new Date().toISOString()
	};
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(facts));
	} catch (error) {
		console.warn(
			'mDNS: could not write network facts:',
			error instanceof Error ? error.message : error
		);
	}
}

export function main() {
	const name = localName();
	const factsFile = process.env.CONTINUUM_NETWORK_FILE || '/run/continuum/network.json';
	writeFacts(factsFile);
	setInterval(() => writeFacts(factsFile), 60_000);
	const responder = mdns({ reuseAddr: true });
	responder.on('query', (query, rinfo) => {
		const answers = answersFor(
			/** @type {{ questions?: Question[] }} */ (query),
			name,
			networkInterfaces(),
			rinfo?.address
		);
		if (answers?.length) responder.respond({ answers });
	});
	responder.on('error', (error) => console.warn('mDNS:', error.message ?? error));
	// Say so once, and announce unasked so a device that cached a stale
	// address learns the new one without waiting for its next query.
	const addresses = chooseAddresses(networkInterfaces(), null);
	console.log(`mDNS: answering ${name} with ${addresses.join(', ') || 'no address yet'}`);
	const announce = answersFor(
		{ questions: [{ name, type: 'A' }] },
		name,
		networkInterfaces(),
		null
	);
	if (announce?.length) responder.respond({ answers: announce });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
