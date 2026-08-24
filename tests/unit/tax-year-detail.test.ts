// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'svelte/server';
import TaxYearDetail from '$lib/components/TaxYearDetail.svelte';

const statements = [
	{
		id: 's1',
		personId: 'p1',
		personName: 'Robert',
		year: 2025,
		country: 'CZ',
		currency: 'Kč',
		currencyCode: 'CZK',
		gross: '4 374 218',
		taxPaid: '810 741.27',
		ratePct: '18.53',
		lines: [],
		note: null,
		diverges: null,
		attachments: [
			{ id: 'd1', name: '2025 CZ tax statement', ext: 'PDF', file: 'abc.pdf' },
			{ id: 'd2', name: '2025 CZ broker earnings report', ext: 'PDF', file: null }
		]
	}
];

const countries = [{ code: 'CZ', name: 'Czechia', token: '--series-health-soft' }];
const props = { statements, countries, onedit: () => {} };

describe('the expanded year', () => {
	it('lists every attachment the statement holds', () => {
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('2025 CZ tax statement');
		expect(body).toContain('2025 CZ broker earnings report');
	});

	it('links an attachment that has a file and does not link one that does not', () => {
		// A document can be metadata-only; a dead link is worse than plain text.
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('/files/abc.pdf');
		expect(body.match(/\/files\//g)).toHaveLength(1);
	});

	it('offers every attachment kind on the adder', () => {
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('Employer earnings report');
		expect(body).toContain('Broker earnings report');
		expect(body).toContain('Statement');
	});

	it('accepts several files at once', () => {
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('multiple');
	});

	it('posts detach to its own action, distinct from deletion', () => {
		// Detaching keeps the paperwork; deleting destroys it. Conflating them
		// would make an unlink silently remove a filed document.
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('?/detach');
	});

	it('does not expose delete unarmed — the first tap only arms it', () => {
		const { body } = render(TaxYearDetail, { props });
		expect(body).not.toContain('Delete?');
	});

	it('hides statement deletion behind the menu rather than showing it always', () => {
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('⋯');
		expect(body).not.toContain('Delete statement');
	});

	it('wires up the armed and menu branches SSR never reaches', () => {
		// Deleting an attachment needs a first tap to arm, and deleting a
		// statement needs the ⋯ menu open — neither branch renders server-side.
		// Reading the source is the only way to assert they are wired at all, and
		// that the statement one says "statement" so it cannot be misread as
		// deleting a document.
		const source = readFileSync(resolve('src/lib/components/TaxYearDetail.svelte'), 'utf8');
		expect(source).toContain('?/deleteAttachment');
		expect(source).toContain('?/remove');
		expect(source).toContain('Delete statement');
	});

	it('explains two filings in one year rather than letting them look like a mistake', () => {
		const two = [statements[0], { ...statements[0], id: 's2', country: 'DE' }];
		const { body } = render(TaxYearDetail, { props: { ...props, statements: two } });
		expect(body).toContain('Two filings in one year is a move, not a mistake');
	});

	it('points at the new home of delete when there is only one filing', () => {
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('Delete lives behind');
	});

	it('shows a divergence from the payslips when there is one', () => {
		const diverging = [{ ...statements[0], diverges: 'payslips total 4 300 000 — this says …' }];
		const { body } = render(TaxYearDetail, { props: { ...props, statements: diverging } });
		expect(body).toContain('payslips total');
	});

	it('falls back to a reserve hue for a jurisdiction with no assigned colour', () => {
		const { body } = render(TaxYearDetail, { props: { ...props, countries: [] } });
		expect(body).toContain('--series-r1');
	});
});
