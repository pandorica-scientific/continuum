// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The transactions register's receipts dialog, split out of `+page.svelte` so
 * its states — a candidates fetch that failed, one still in flight — can be
 * rendered directly with a prop rather than only ever existing as `$state`
 * inside a route component nothing outside it can set.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ReceiptsDialog from '$lib/components/ReceiptsDialog.svelte';
import type { AboutDocument, CandidateDocument } from '$lib/server/documents/targets';

const doc = (over: Partial<AboutDocument> = {}): AboutDocument => ({
	id: 'd1',
	name: 'Vet invoice',
	ext: 'PDF',
	storedName: 'stored-abc.pdf',
	type: 'receipt',
	shelfKey: 'inbox',
	shelfLabel: 'Inbox',
	expiresOn: null,
	expiryVerb: 'expires',
	addedOn: '2026-01-02',
	sensitivity: 'normal',
	tags: ['receipt'],
	...over
});

const candidate = (over: Partial<CandidateDocument> = {}): CandidateDocument => ({
	id: 'c1',
	name: 'Building insurance',
	ext: 'PDF',
	shelfLabel: 'Household',
	...over
});

const transaction = {
	id: 't1',
	merchant: 'Vet clinic',
	amount: '-1 200,00 Kč',
	documents: [doc()]
};

const base = {
	transaction,
	candidates: [] as CandidateDocument[],
	candidatesError: null as string | null,
	loadingCandidates: false,
	formMessage: null as string | null,
	onclose: () => {}
};

describe('the receipts dialog', () => {
	it('names the row it is open for', () => {
		const { body } = render(ReceiptsDialog, { props: base });
		expect(body).toContain('Vet clinic');
		expect(body).toContain('-1 200,00 Kč');
		expect(body).toContain('Vet invoice');
	});

	it('says a failure the way it is told to, rather than showing an empty picker', () => {
		// A network error and a non-action response (a CSRF refusal page, a 500)
		// both end up here — a person cannot tell those apart, and does not need
		// to know which one happened, only that the picker did not load.
		const { body } = render(ReceiptsDialog, {
			props: { ...base, candidatesError: 'Could not load the documents you could attach.' }
		});
		expect(body).toContain('Could not load the documents you could attach.');
	});

	it('says it is checking while the fetch is in flight, rather than popping the list in silently', () => {
		const { body } = render(ReceiptsDialog, { props: { ...base, loadingCandidates: true } });
		expect(body).toContain('Checking what you could attach');
	});

	it('shows neither message once the fetch has come back clean', () => {
		const { body } = render(ReceiptsDialog, {
			props: { ...base, candidates: [candidate()], loadingCandidates: false, candidatesError: null }
		});
		expect(body).not.toContain('Could not load');
		expect(body).not.toContain('Checking what you could attach');
		expect(body).toContain('Building insurance');
	});

	it('prefers the error over the loading line if a caller ever sets both', () => {
		const { body } = render(ReceiptsDialog, {
			props: {
				...base,
				loadingCandidates: true,
				candidatesError: 'Could not load the documents you could attach.'
			}
		});
		expect(body).toContain('Could not load the documents you could attach.');
		expect(body).not.toContain('Checking what you could attach');
	});

	it('shows a failure from attaching or detaching that named this row', () => {
		const { body } = render(ReceiptsDialog, {
			props: { ...base, formMessage: 'Choose a file, or a document you already have.' }
		});
		expect(body).toContain('Choose a file, or a document you already have.');
	});

	it('posts the upload form against this transaction', () => {
		const { body } = render(ReceiptsDialog, { props: base });
		expect(body).toContain('action="?/attachDocument"');
		expect(body).toContain('name="targetId"');
		expect(body).toContain('value="t1"');
	});
});
