import { describe, expect, it } from 'vitest';
import { securedPropertiesFromForm } from '$lib/loans/form';

describe('securedPropertiesFromForm', () => {
	it('keeps blank shares automatic but preserves invalid explicit text for rejection', () => {
		const form = new FormData();
		form.set('secured_home', 'on');
		form.set('share_home', 'abc');
		form.set('secured_flat', 'on');
		form.set('share_flat', '');

		expect(securedPropertiesFromForm(form, ['home', 'flat'])).toEqual([
			{ propertyId: 'home', sharePct: 'abc' },
			{ propertyId: 'flat', sharePct: null }
		]);
	});

	it('normalises decimal commas and ignores unchecked or unknown properties', () => {
		const form = new FormData();
		form.set('secured_home', 'on');
		form.set('share_home', '12,5');
		form.set('share_flat', '50');
		form.set('secured_injected', 'on');
		form.set('share_injected', '100');

		expect(securedPropertiesFromForm(form, ['home', 'flat'])).toEqual([
			{ propertyId: 'home', sharePct: '12.5' }
		]);
	});
});
