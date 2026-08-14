import { describe, expect, it } from 'vitest';
import { enrollmentStatus } from '$lib/server/auth/enrollment';

const now = new Date('2026-08-14T12:00:00Z');
const later = new Date('2026-08-20T12:00:00Z');
const earlier = new Date('2026-08-10T12:00:00Z');

describe('enrollmentStatus', () => {
	it('is valid when unused and not yet expired', () => {
		expect(enrollmentStatus({ expiresAt: later, usedAt: null }, now)).toBe('valid');
	});

	it('is used once consumed, even if still within its window', () => {
		expect(enrollmentStatus({ expiresAt: later, usedAt: earlier }, now)).toBe('used');
	});

	it('is expired when the window has closed', () => {
		expect(enrollmentStatus({ expiresAt: earlier, usedAt: null }, now)).toBe('expired');
	});

	it('treats the exact expiry instant as expired, not valid', () => {
		expect(enrollmentStatus({ expiresAt: now, usedAt: null }, now)).toBe('expired');
	});

	it('is unknown when no row exists', () => {
		expect(enrollmentStatus(undefined, now)).toBe('unknown');
	});

	it('reports used before expired, so a consumed old token is not mislabelled', () => {
		expect(enrollmentStatus({ expiresAt: earlier, usedAt: earlier }, now)).toBe('used');
	});
});
