// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The one card that every record screen files its paper through.
 *
 * There is no browser suite in this repository, so the card is rendered to a
 * string and read: what is asserted here is the part a screen depends on —
 * which links exist, which forms exist, and what a person is told when nothing
 * is filed yet. The expiry hue is asserted through the pure helper as well as
 * through the markup, because the helper is what the screens share.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import DocumentsCard from '$lib/components/DocumentsCard.svelte';
import { documentExpiryTone } from '$lib/documents-view';
import type { AboutDocument, CandidateDocument } from '$lib/server/documents/targets';

const TODAY = '2026-08-28';

const doc = (over: Partial<AboutDocument> = {}): AboutDocument => ({
	id: 'd1',
	name: 'Renting contract',
	ext: 'PDF',
	storedName: 'stored-abc.pdf',
	type: 'contract',
	shelfKey: 'property',
	shelfLabel: 'Property',
	expiresOn: null,
	expiryVerb: 'expires',
	addedOn: '2026-01-02',
	sensitivity: 'normal',
	tags: [],
	...over
});

const candidate = (over: Partial<CandidateDocument> = {}): CandidateDocument => ({
	id: 'c1',
	name: 'Building insurance',
	ext: 'PDF',
	shelfLabel: 'Household',
	...over
});

const target = { id: 't1', kind: 'property' as const, label: 'Vinohrady flat' };

const base = {
	documents: [doc()],
	target,
	emptyText: 'Nothing filed about this flat yet — the renting contract belongs here.'
};

describe('the documents card', () => {
	it('opens a document that has a file through the document, never through the stored name', () => {
		// `/files/<stored name>` cannot say which document a name belongs to,
		// which is how a member could once open a restricted one.
		const { body } = render(DocumentsCard, { props: base });
		expect(body).toContain('href="/documents/d1/file"');
		expect(body).not.toContain('stored-abc.pdf');
		expect(body).toContain('data-file-ext="PDF"');
		expect(body).toContain('target="_blank"');
	});

	it('prints a metadata-only document as plain text rather than a dead link', () => {
		const { body } = render(DocumentsCard, {
			props: { ...base, documents: [doc({ id: 'd2', name: 'Meter reading', storedName: null })] }
		});
		expect(body).toContain('Meter reading');
		expect(body).not.toContain('/documents/d2/file');
	});

	it('says what belongs here when nothing is filed yet', () => {
		const { body } = render(DocumentsCard, { props: { ...base, documents: [] } });
		expect(body).toContain('the renting contract belongs here');
	});

	it('files the row under its shelf and says when it falls due', () => {
		const { body } = render(DocumentsCard, {
			props: { ...base, documents: [doc({ expiresOn: '2024-01-01', expiryVerb: 'renews' })] }
		});
		expect(body).toContain('Property');
		// A renewal that has passed stays red: nothing knows the replacement
		// was filed, so the alarm does not lapse on its own.
		expect(body).toContain('var(--red)');
	});

	it('leaves a document with no expiry quiet, with the date it arrived', () => {
		const { body } = render(DocumentsCard, { props: base });
		expect(body).toContain('added 2 Jan 2026');
		expect(body).toContain('var(--fg3)');
		expect(body).not.toContain('var(--red)');
		expect(body).not.toContain('var(--yellow)');
	});

	it('shows the lock on a restricted row to an admin', () => {
		const { body } = render(DocumentsCard, {
			props: {
				...base,
				documents: [doc({ sensitivity: 'restricted' })],
				isAdmin: true
			}
		});
		expect(body).toContain('aria-label="Restricted"');
	});

	it('draws no lock for a member — restricted paper never reaches their card at all', () => {
		// A member's query does not return the row, so a lock on a member's
		// screen could only ever be a lock on a document that is not restricted.
		const { body } = render(DocumentsCard, {
			props: { ...base, documents: [doc({ sensitivity: 'restricted' })] }
		});
		expect(body).not.toContain('aria-label="Restricted"');
	});

	it('offers the attach picker only when there is something to attach', () => {
		const { body } = render(DocumentsCard, {
			props: {
				...base,
				attach: { action: 'attachDocument', candidates: [candidate(), candidate({ id: 'c2' })] }
			}
		});
		expect(body).toContain('action="?/attachDocument"');
		expect(body).toContain('name="documentId"');
		expect(body).toContain('value="c2"');
		// Every form the card posts carries the record it is filed against.
		expect(body).toContain('name="targetId"');
		expect(body).toContain('value="t1"');
	});

	it('hides the attach picker when every visible document is already here', () => {
		const { body } = render(DocumentsCard, {
			props: { ...base, attach: { action: 'attachDocument', candidates: [] } }
		});
		expect(body).not.toContain('action="?/attachDocument"');
	});

	it('has no attach picker at all on a screen that did not give one', () => {
		const { body } = render(DocumentsCard, { props: base });
		expect(body).not.toContain('<select');
	});

	it('offers a detach control only when the screen gave a detach action', () => {
		const { body } = render(DocumentsCard, {
			props: { ...base, detachAction: 'detachDocument' }
		});
		expect(body).toContain('action="?/detachDocument"');
		expect(body).toContain('value="d1"');
		// Unfiling is not deleting, so it says so rather than warning.
		expect(body).toContain('Unfile Renting contract from Vinohrady flat');
	});

	it('draws no detach control on a card that only lists', () => {
		const { body } = render(DocumentsCard, { props: base });
		expect(body).not.toContain('action="?/detach');
	});

	it('asks before deleting when the screen says its detach is not a plain unlink', () => {
		// Transactions' detach deletes the document (Task 9), not just the link,
		// so a first tap arms the row rather than posting straight away — the
		// form that would actually delete is not on the page until it is.
		const { body } = render(DocumentsCard, {
			props: { ...base, detachAction: 'detachDocument', confirmDetach: true }
		});
		expect(body).not.toContain('action="?/detachDocument"');
		expect(body).toContain('Delete Renting contract from Vinohrady flat');
		expect(body).not.toContain('Unfile');
	});

	it('still posts straight away when the screen never asked for a confirm', () => {
		const { body } = render(DocumentsCard, {
			props: { ...base, detachAction: 'detachDocument', confirmDetach: false }
		});
		expect(body).toContain('action="?/detachDocument"');
	});

	it('offers the add button only with an href, and takes the wording it is given', () => {
		const plain = render(DocumentsCard, { props: base });
		expect(plain.body).not.toContain('➕');

		const { body } = render(DocumentsCard, {
			props: {
				...base,
				addHref: '/documents?add=1&addShelfKey=property&targetKind=property&targetId=t1',
				addLabel: 'Add a document about this flat'
			}
		});
		expect(body).toContain('Add a document about this flat');
		expect(body).toContain('targetKind=property&amp;targetId=t1');
	});

	it('sends "Open in Documents" to the entity filter, not to a search for the name', () => {
		// A name round-trip matches every document whose name contains the
		// string; the entity filter is the record itself.
		const { body } = render(DocumentsCard, { props: base });
		expect(body).toContain('href="/documents?entity=t1"');
	});

	it('takes the heading it is given, and calls itself Documents otherwise', () => {
		expect(render(DocumentsCard, { props: base }).body).toContain('Documents');
		expect(render(DocumentsCard, { props: { ...base, heading: 'Reports' } }).body).toContain(
			'Reports'
		);
	});

	it('wraps itself in a card by default, and drops the wrapper and its padding when told it already sits inside one', () => {
		// The contacts edit panel and the accounts row are cards themselves;
		// nesting this card's own border and padding inside one of them reads as
		// a mistake, not a feature, so `bare` drops both and leaves the content.
		// Svelte appends its own scoped-style hash to the class attribute, so the
		// match only pins the classes this component controls.
		expect(render(DocumentsCard, { props: base }).body).toMatch(/<div class="card stack /);

		const { body } = render(DocumentsCard, { props: { ...base, bare: true } });
		expect(body).not.toMatch(/<div class="card stack /);
		expect(body).toMatch(/<div class="stack /);
		// Everything else still renders — bare only changes the outer wrapper.
		expect(body).toContain('Renting contract');
	});
});

describe('documentExpiryTone', () => {
	it('reads a passed date as expired', () => {
		expect(documentExpiryTone(doc({ expiresOn: '2026-08-01' }), TODAY)).toBe('expired');
	});

	it('reads a date inside the sixty-day window as soon', () => {
		expect(documentExpiryTone(doc({ expiresOn: '2026-10-01' }), TODAY)).toBe('soon');
	});

	it('leaves a date beyond the window quiet — a renewal a year out is a fact, not a task', () => {
		expect(documentExpiryTone(doc({ expiresOn: '2027-10-01' }), TODAY)).toBe('quiet');
	});

	it('leaves a document with no expiry quiet', () => {
		expect(documentExpiryTone(doc(), TODAY)).toBe('quiet');
	});

	it('shares the Documents screen rule rather than restating it', () => {
		// A bill is due sooner than a contract renews, and the card must not
		// invent its own window: thirty days for `due`, sixty for the rest.
		expect(documentExpiryTone(doc({ expiresOn: '2026-10-01', expiryVerb: 'due' }), TODAY)).toBe(
			'quiet'
		);
		expect(documentExpiryTone(doc({ expiresOn: '2026-09-10', expiryVerb: 'due' }), TODAY)).toBe(
			'soon'
		);
		// A lapsed `expires` stops shouting after a month; nothing is owed and
		// nothing replaces it, so the date becomes history.
		expect(documentExpiryTone(doc({ expiresOn: '2026-01-01' }), TODAY)).toBe('quiet');
		expect(documentExpiryTone(doc({ expiresOn: '2026-01-01', expiryVerb: 'renews' }), TODAY)).toBe(
			'expired'
		);
	});
});
