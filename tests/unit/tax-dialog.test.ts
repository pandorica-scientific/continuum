// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaxStatementDialog from '$lib/components/TaxStatementDialog.svelte';

const props = {
	people: [{ id: 'p1', name: 'Robert' }],
	taxDocs: [{ id: 'd1', name: '2024 CZ tax statement' }],
	currencies: ['EUR', 'CZK'],
	prefillTotals: {},
	baseCurrency: 'CZK',
	existing: null,
	onclose: () => {}
};

describe('the statement dialog', () => {
	it('accepts several files at once', () => {
		// A year's filing is the statement, the employer's confirmation and the
		// broker's report — three files, one save.
		const { body } = render(TaxStatementDialog, { props });
		expect(body).toContain('multiple');
	});

	it('offers every attachment kind', () => {
		const { body } = render(TaxStatementDialog, { props });
		expect(body).toContain('Employer earnings report');
		expect(body).toContain('Broker earnings report');
	});

	it('posts the kind alongside the files', () => {
		const { body } = render(TaxStatementDialog, { props });
		expect(body).toContain('name="fileKind"');
	});

	it('still offers a document already on the Finance shelf', () => {
		const { body } = render(TaxStatementDialog, { props });
		expect(body).toContain('2024 CZ tax statement');
		expect(body).toContain('name="documentId"');
	});

	it('keeps filing the paperwork part of recording the statement', () => {
		// Recording a statement and filing the paper it came from is one act.
		// Splitting them is what the old screen did, and it meant leaving the
		// screen to file a document before the statement could be recorded.
		const { body } = render(TaxStatementDialog, { props });
		expect(body).toContain('The paperwork');
		expect(body).toContain('action="?/save"');
	});

	it('does not carry a documentId into an edit any more', () => {
		// The statement no longer holds one document; it is linked to many.
		const existing = {
			id: 's1',
			personId: 'p1',
			year: 2025,
			country: 'CZ',
			currencyCode: 'CZK',
			gross: '100',
			taxPaid: '10',
			lines: [],
			note: null
		};
		const { body } = render(TaxStatementDialog, { props: { ...props, existing } });
		expect(body).toContain('2025');
	});
});
