import { describe, expect, it } from 'vitest';
import { formatBytes, formatUptime } from '$lib/server/system/status';

describe('status formatting', () => {
	it('formats byte sizes with sensible units', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(2048)).toBe('2.0 kB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
		expect(formatBytes(3.4 * 1024 * 1024 * 1024)).toBe('3.4 GB');
	});

	it('formats uptime at the right granularity', () => {
		expect(formatUptime(59)).toBe('0m');
		expect(formatUptime(60 * 25)).toBe('25m');
		expect(formatUptime(3600 * 3 + 60 * 7)).toBe('3h 7m');
		expect(formatUptime(86400 * 2 + 3600 * 5)).toBe('2d 5h');
	});
});
