// SPDX-License-Identifier: AGPL-3.0-or-later
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
		// A boolean would let the first scan to finish declare nobody scanning,
		// letting OCR start underneath the other one.
		const first = holdCpuQueueForScan();
		const second = holdCpuQueueForScan();
		first();
		expect(cpuQueueHeldForScan()).toBe(true);
		second();
		expect(cpuQueueHeldForScan()).toBe(false);
	});

	it('ignores a release called twice', () => {
		// Guards against counting below zero, which would leave the queue permanently held.
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
