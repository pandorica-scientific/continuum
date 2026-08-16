import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RepayDialog from '$lib/components/RepayDialog.svelte';
import RefixDialog from '$lib/components/RefixDialog.svelte';

const sim = {
	terms: {
		owedMinor: '12000000',
		owedAsOfMonth: '2026-01',
		dayCount: 'act/365',
		accrualStyle: 'payment',
		paymentDay: 15
	},
	periods: [
		{
			startDate: '2025-01-01',
			endDate: null,
			annualRatePct: 4.2,
			paymentMinor: '45000'
		}
	]
};

describe('loan scenario dialog rendering', () => {
	it('renders the repayment-specific form around the shared current-schedule preview', () => {
		const { body } = render(RepayDialog, {
			props: { loanId: 'loan-1', currency: 'CZK', sim, onclose: () => {} }
		});

		expect(body).toContain('Record a repayment');
		expect(body).toContain('Balance after (optional, from the bank)');
		expect(body).toContain('fill in the amount to preview the effect');
	});

	it('renders the refix-specific form around the shared current-schedule preview', () => {
		const { body } = render(RefixDialog, {
			props: { loanId: 'loan-1', currency: 'CZK', sim, onclose: () => {} }
		});

		expect(body).toContain('New fixation');
		expect(body).toContain('Annual rate %');
		expect(body).toContain('name a rate or a payment — the other is worked out to hold the same term');
	});
});
