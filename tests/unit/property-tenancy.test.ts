import { describe, expect, it } from 'vitest';
import { activeTenanciesByProperty, tenancyRangesOverlap } from '$lib/property/tenancy';
import { createTenancy } from '$lib/server/property/mutations';

interface Row {
	id: string;
	propertyId: string;
	startDate: string | null;
	endDate: string | null;
}

const row = (id: string, startDate: string | null, endDate: string | null): Row => ({
	id,
	propertyId: 'flat-a',
	startDate,
	endDate
});

describe('active tenancy policy', () => {
	it('requires the lease to have started and not yet ended, including both boundary days', () => {
		const active = activeTenanciesByProperty(
			[
				row('ended', null, '2026-08-14'),
				row('future', '2026-08-16', null),
				row('boundary', '2026-08-15', '2026-08-15')
			],
			'2026-08-15'
		);

		expect([...active.values()].map((tenancy) => tenancy.id)).toEqual(['boundary']);
	});

	it('chooses the latest start deterministically when legacy rows overlap', () => {
		const active = activeTenanciesByProperty(
			[
				row('old', '2026-01-01', null),
				row('z-new', '2026-06-01', null),
				row('a-new', '2026-06-01', null)
			],
			'2026-08-15'
		);

		expect(active.get('flat-a')?.id).toBe('a-new');
	});
});

describe('tenancy range overlap', () => {
	it('treats open ends and a shared boundary day as overlapping', () => {
		expect(
			tenancyRangesOverlap(
				{ startDate: '2026-01-01', endDate: '2026-02-01' },
				{ startDate: '2026-02-01', endDate: null }
			)
		).toBe(true);
		expect(
			tenancyRangesOverlap(
				{ startDate: '2026-01-01', endDate: '2026-01-31' },
				{ startDate: '2026-02-01', endDate: null }
			)
		).toBe(false);
	});

	it('rejects an impossible calendar date before opening a database transaction', async () => {
		expect(
			await createTenancy({
				id: 'invalid-day',
				propertyId: 'flat-a',
				tenantName: 'Tenant',
				rentMinor: 1n,
				depositMinor: 0n,
				startDate: '2026-99-99',
				endDate: null,
				renewalNoticeDate: null
			})
		).toMatchObject({ ok: false, status: 400 });
	});
});
