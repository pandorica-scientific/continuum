// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { answersFor, chooseAddresses, localName } from '../../docker/mdns.mjs';

const nic = (address: string, netmask: string, internal = false) => ({
	address,
	netmask,
	family: 'IPv4',
	internal
});

/** A server on Ethernet and Wi-Fi, with Docker's bridge and loopback beside them. */
const INTERFACES = {
	lo: [nic('127.0.0.1', '255.0.0.0', true)],
	eth0: [nic('192.168.68.51', '255.255.252.0')],
	wlan0: [nic('10.0.0.7', '255.255.255.0')],
	docker0: [nic('172.17.0.1', '255.255.0.0')]
};

describe('localName', () => {
	it('is continuum.local by default and takes CONTINUUM_NAME', () => {
		expect(localName({})).toBe('continuum.local');
		expect(localName({ CONTINUUM_NAME: 'Ledger' })).toBe('ledger.local');
		expect(localName({ CONTINUUM_NAME: 'ledger.local' })).toBe('ledger.local');
	});
});

describe('chooseAddresses', () => {
	it('answers a phone with the address on its own subnet', () => {
		expect(chooseAddresses(INTERFACES, '192.168.70.20')).toEqual(['192.168.68.51']);
		expect(chooseAddresses(INTERFACES, '10.0.0.44')).toEqual(['10.0.0.7']);
	});

	it('offers every address when the asker matches no interface', () => {
		expect(chooseAddresses(INTERFACES, '100.64.0.9')).toEqual([
			'192.168.68.51',
			'10.0.0.7',
			'172.17.0.1'
		]);
		expect(chooseAddresses(INTERFACES, null)).toEqual(['192.168.68.51', '10.0.0.7', '172.17.0.1']);
	});

	it('never hands out loopback', () => {
		expect(chooseAddresses(INTERFACES, '127.0.0.1')).not.toContain('127.0.0.1');
	});
});

describe('answersFor', () => {
	it('answers only its own name, case-insensitively', () => {
		const q = { questions: [{ name: 'Continuum.local', type: 'A' }] };
		expect(answersFor(q, 'continuum.local', INTERFACES, '192.168.69.3')).toEqual([
			{
				name: 'continuum.local',
				type: 'A',
				ttl: 120,
				class: 'IN',
				flush: true,
				data: '192.168.68.51'
			}
		]);
		expect(
			answersFor(
				{ questions: [{ name: 'printer.local', type: 'A' }] },
				'continuum.local',
				INTERFACES,
				'192.168.69.3'
			)
		).toBeNull();
	});

	it('stays quiet for an AAAA-only query, which it cannot satisfy', () => {
		const q = { questions: [{ name: 'continuum.local', type: 'AAAA' }] };
		expect(answersFor(q, 'continuum.local', INTERFACES, '192.168.69.3')).toBeNull();
	});
});
