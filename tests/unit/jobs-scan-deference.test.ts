// SPDX-License-Identifier: AGPL-3.0-or-later
// The CPU queue standing back while someone is scanning.
//
// Extraction is batch work nobody is watching and a scan is a button press
// someone is looking at. Sharing one slot is right; sharing it FIRST-COME is
// not, and this is the whole of the difference.
import { describe, expect, it } from 'vitest';
import { cpuQueueHeldForScan, holdCpuQueueForScan } from '$lib/server/jobs';

describe('holding the CPU queue for a scan', () => {
	it('is not held when nothing is scanning', () => {
		expect(cpuQueueHeldForScan()).toBe(false);
	});

	it('holds from the first request and releases after the last', () => {
		const release = holdCpuQueueForScan();
		expect(cpuQueueHeldForScan()).toBe(true);
		release();
		expect(cpuQueueHeldForScan()).toBe(false);
	});

	it('counts rather than flags, so two scans do not release each other', () => {
		// A mode switch and a keep overlap; so do two people. With a boolean,
		// whichever finished first would declare that nobody was scanning — and
		// that is the exact moment a hundred-page OCR would start underneath the
		// other one.
		const first = holdCpuQueueForScan();
		const second = holdCpuQueueForScan();
		first();
		expect(cpuQueueHeldForScan()).toBe(true);
		second();
		expect(cpuQueueHeldForScan()).toBe(false);
	});

	it('ignores a release called twice', () => {
		// Routes release in a `finally` and may also release on an error path.
		// Counting below zero would leave the queue permanently un-held, which is
		// the failure this guard exists to prevent, arrived at from the other side.
		const release = holdCpuQueueForScan();
		const other = holdCpuQueueForScan();
		release();
		release();
		release();
		expect(cpuQueueHeldForScan()).toBe(true);
		other();
		expect(cpuQueueHeldForScan()).toBe(false);
	});
});
