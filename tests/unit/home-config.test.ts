import { describe, expect, it } from 'vitest';
import { configuredMeterProperty } from '$lib/server/home';

describe('configuredMeterProperty', () => {
	it('uses the explicitly bound lived-in property when several exist', () => {
		const properties = [
			{ id: 'first', name: 'First home', kind: 'lived' },
			{ id: 'chosen', name: 'Chosen home', kind: 'lived' }
		];

		expect(
			configuredMeterProperty({ kind: 'demo', meterPropertyId: 'chosen' }, properties)
		).toEqual(properties[1]);
	});

	it('fails closed when the configured property is no longer lived in', () => {
		expect(
			configuredMeterProperty({ kind: 'demo', meterPropertyId: 'rental' }, [
				{ id: 'rental', kind: 'rented' }
			])
		).toBeNull();
	});
});
