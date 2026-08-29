// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'svelte/server';
import TaxYearDetail from '$lib/components/TaxYearDetail.svelte';
import type { AboutDocument } from '$lib/server/documents/targets';

const doc = (over: Partial<AboutDocument> = {}): AboutDocument => ({
	id: 'd1',
	name: '2025 CZ tax statement',
	ext: 'PDF',
	storedName: 'abc.pdf',
	type: 'tax_document',
	shelfKey: 'finance',
	shelfLabel: 'Finance',
	expiresOn: null,
	expiryVerb: 'expires',
	addedOn: '2026-01-02',
	sensitivity: 'normal',
	tags: [],
	...over
});

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
			doc(),
			doc({ id: 'd2', name: '2025 CZ broker earnings report', storedName: null })
		]
	}
];

const countries = [{ code: 'CZ', name: 'Czechia', token: '--series-health-soft' }];
const props = { statements, countries, personHue: () => '--series-r10', onedit: () => {} };

describe('the expanded year', () => {
	it('lists every attachment the statement holds, through the shared documents card', () => {
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('2025 CZ tax statement');
		expect(body).toContain('2025 CZ broker earnings report');
	});

	it('links an attachment that has a file and does not link one that does not', () => {
		// A document can be metadata-only; a dead link is worse than plain text.
		// The link addresses the DOCUMENT, not its stored name: `/files/[name]`
		// cannot say which document a name belongs to, and a member holding one
		// could open a restricted document with it.
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('/documents/d1/file');
		expect(body.match(/\/documents\/[^/]+\/file/g)).toHaveLength(1);
		expect(body).not.toContain('/files/');
	});

	it('sits its own card inside the statement card rather than nesting one', () => {
		// DocumentsCard draws a `.card` by default; nested inside the statement's
		// own `.card.statement` that would double the border and padding, so this
		// card is asked for the bare form instead.
		const { body } = render(TaxYearDetail, { props });
		expect(body).not.toMatch(/<div class="card stack/);
	});

	it('unfiles an attachment through the plain detach action — no re-file, no confirm', () => {
		// A tax attachment detached stays filed on the Finance shelf; only the
		// link to this statement goes, so one tap is enough — unlike a card whose
		// detach destroys the document.
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('action="?/detach"');
		expect(body).toContain('Unfile 2025 CZ tax statement from 2025 CZ');
		expect(body).not.toContain('Delete?');
	});

	it('says what belongs here when a statement has nothing filed yet', () => {
		const empty = [{ ...statements[0], attachments: [] }];
		const { body } = render(TaxYearDetail, { props: { ...props, statements: empty } });
		expect(body).toContain('Nothing filed against this statement yet.');
	});

	it('shows the lock on a restricted attachment only to an admin', () => {
		const restricted = [{ ...statements[0], attachments: [doc({ sensitivity: 'restricted' })] }];
		const asMember = render(TaxYearDetail, { props: { ...props, statements: restricted } });
		expect(asMember.body).not.toContain('aria-label="Restricted"');

		const asAdmin = render(TaxYearDetail, {
			props: { ...props, statements: restricted, isAdmin: true }
		});
		expect(asAdmin.body).toContain('aria-label="Restricted"');
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

	it('posts the attach-kind upload against this statement', () => {
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('action="?/attach"');
	});

	it('says nothing about where delete lives, because there is nothing to explain', () => {
		// The caption once claimed "Delete lives behind the ⋯ menu now" while a
		// bin sat two inches above it. Gone, and it must stay gone.
		const { body } = render(TaxYearDetail, { props });
		expect(body).not.toContain('Delete lives behind');
	});

	it('hides statement deletion behind the menu rather than showing it always', () => {
		const { body } = render(TaxYearDetail, { props });
		expect(body).toContain('⋯');
		expect(body).not.toContain('Delete statement');
	});

	it('wires up the statement menu SSR never opens', () => {
		// Deleting a statement needs the ⋯ menu open, which SSR never reaches —
		// reading the source is the only way to assert it is wired at all.
		const source = readFileSync(resolve('src/lib/components/TaxYearDetail.svelte'), 'utf8');
		expect(source).toContain('?/remove');
		expect(source).toContain('Delete statement');
	});

	it('explains two filings in one year rather than letting them look like a mistake', () => {
		const two = [statements[0], { ...statements[0], id: 's2', country: 'DE' }];
		const { body } = render(TaxYearDetail, { props: { ...props, statements: two } });
		expect(body).toContain('Two filings in one year is a move, not a mistake');
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
