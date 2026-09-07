// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { machineName, reachableAddresses, readNetworkFacts } from '$lib/server/system/addresses';

const OPTS = { name: 'continuum', port: 80 };

describe('machineName', () => {
	it('is the first label of the host name, lowercased', () => {
		expect(machineName('Raspberrypi')).toBe('raspberrypi');
		expect(machineName('nas.fritz.box')).toBe('nas');
	});

	it('is nothing for a name that says nothing', () => {
		// Docker Desktop's VM, a bare container ID, an empty file.
		expect(machineName('docker-desktop')).toBeNull();
		expect(machineName('3f9a1c2b4d5e')).toBeNull();
		expect(machineName('')).toBeNull();
		expect(machineName(undefined)).toBeNull();
	});
});

describe('reachableAddresses', () => {
	it('leads with the machine name, then .local names, then the LAN address', () => {
		const urls = reachableAddresses(
			{ hostname: 'raspberrypi', addresses: ['192.168.68.51', '172.17.0.1'] },
			OPTS
		).map((r) => r.url);
		expect(urls).toEqual([
			'http://raspberrypi/',
			'http://raspberrypi.local',
			'http://continuum.local',
			'http://192.168.68.51'
		]);
	});

	it('leaves out docker bridge addresses a phone cannot reach', () => {
		const urls = reachableAddresses(
			{ hostname: 'nas', addresses: ['172.18.0.1', '10.0.0.5'] },
			OPTS
		).map((r) => r.url);
		expect(urls).not.toContain('http://172.18.0.1');
		expect(urls).toContain('http://10.0.0.5');
	});

	it('does not repeat the machine when it is already called continuum', () => {
		const urls = reachableAddresses({ hostname: 'continuum', addresses: [] }, OPTS).map(
			(r) => r.url
		);
		expect(urls).toEqual(['http://continuum.local']);
	});

	it('on Docker Desktop names localhost and the computer, never the VM or continuum.local', () => {
		// The announcer sits inside Docker Desktop's VM: its multicast never
		// reaches the network and its addresses are the VM's, so the one
		// address that cannot work there is the announced name.
		const facts = { hostname: 'docker-desktop', addresses: ['192.168.65.3'] };
		expect(reachableAddresses(facts, OPTS).map((r) => r.url)).toEqual(['http://localhost']);
		// The browser got here somehow; that address is real and is shown first.
		expect(
			reachableAddresses(facts, { ...OPTS, browsing: 'Roberts-MacBook.local' }).map((r) => r.url)
		).toEqual(['http://roberts-macbook.local', 'http://localhost']);
		expect(
			reachableAddresses(facts, { ...OPTS, browsing: 'localhost:8080' }).map((r) => r.url)
		).toEqual(['http://localhost']);
	});

	it('always has the announced name, even with no facts at all', () => {
		expect(reachableAddresses(null, OPTS).map((r) => r.url)).toEqual(['http://continuum.local']);
	});

	it('appends the port everywhere when it is not 80', () => {
		const urls = reachableAddresses(
			{ hostname: 'pi', addresses: ['192.168.1.9'] },
			{ name: 'ledger', port: 8080 }
		).map((r) => r.url);
		expect(urls).toEqual([
			'http://pi:8080/',
			'http://pi.local:8080',
			'http://ledger.local:8080',
			'http://192.168.1.9:8080'
		]);
	});
});

describe('readNetworkFacts', () => {
	it('reads what the announcer wrote and tolerates its absence', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'net-'));
		try {
			const file = join(dir, 'network.json');
			expect(await readNetworkFacts(file)).toBeNull();
			writeFileSync(file, JSON.stringify({ hostname: 'pi', addresses: ['192.168.1.9', 7] }));
			expect(await readNetworkFacts(file)).toEqual({ hostname: 'pi', addresses: ['192.168.1.9'] });
			writeFileSync(file, 'not json');
			expect(await readNetworkFacts(file)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
