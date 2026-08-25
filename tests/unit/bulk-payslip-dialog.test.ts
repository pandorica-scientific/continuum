// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import BulkPayslipDialog from '$lib/components/BulkPayslipDialog.svelte';

const props = {
	people: [
		{ id: 'p1', name: 'Robert' },
		{ id: 'p2', name: 'Kseniya' }
	],
	currencies: ['CZK', 'EUR'],
	baseCurrency: 'EUR',
	onclose: () => {}
};

const source = () => readFileSync(resolve('src/lib/components/BulkPayslipDialog.svelte'), 'utf8');

describe('filing several payslips at once', () => {
	it('is a dialog of its own, not the single-slip one repeated', () => {
		const { body } = render(BulkPayslipDialog, { props });
		expect(body).toContain('role="dialog"');
		expect(body).toContain('Add several payslips');
	});

	it('lists files that were already on the shelf apart from ones it refused', () => {
		// "Skipped" means this one needs you. A file already filed needs nothing —
		// saying so is only so that eleven of twelve landing does not read as a
		// failure, and so that dropping a folder in twice is visibly harmless.
		expect(source()).toContain('data?.already');
		expect(source()).toContain('Already filed, so left alone:');
		expect(source()).toContain('.known {');
	});

	it('does not report nothing to file when everything was already filed', () => {
		expect(source()).toContain(
			'filed.length === 0 && skipped.length === 0 && already.length === 0'
		);
	});
});
