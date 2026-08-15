import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import SplitDialog from '$lib/components/SplitDialog.svelte';

describe('split dialog money and tags', () => {
	it('formats a JPY remainder with the currency minor-unit scale', () => {
		const { body } = render(SplitDialog, {
			props: {
				transactionId: 'txn-jpy',
				merchant: 'Tokyo shop',
				amountMajor: '1500',
				currency: 'JPY',
				categories: [],
				existing: [
					{ id: 's1', amountMajor: '500', categoryId: null, tagNames: 'Trip' },
					{ id: 's2', amountMajor: '500', categoryId: null, tagNames: '' }
				],
				knownTags: [{ id: 'trip', name: 'Trip' }],
				onclose: () => undefined
			}
		});

		expect(body).toMatch(/500\s+JPY left to allocate/u);
		expect(body).toContain('name="splitTags"');
		expect(body).toContain('value="Trip"');
	});
});
