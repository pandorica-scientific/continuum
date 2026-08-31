// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ART_KEYS, GENERIC_ART, documentArtUrl } from '$lib/document-art';
import { ENUMS } from '$lib/enums';

/**
 * The manifest is what the artwork was generated from; `ART_KEYS` is what the
 * app can actually draw. They are produced by different steps — a render that
 * failed halfway leaves the second short of the first without anything else
 * noticing, because a missing face degrades to the generic one and looks
 * deliberate.
 */
const manifest = JSON.parse(
	readFileSync('src/lib/assets/doc-placeholders/manifest.json', 'utf8')
) as {
	countries: { code: string }[];
	documents: { key: string }[];
};

describe('the card artwork set', () => {
	it('holds a face for every country and document in the manifest, plus the generic one', () => {
		const expected = manifest.countries.flatMap((c) =>
			manifest.documents.map((d) => `${c.code.toLowerCase()}-${d.key}`)
		);
		for (const key of expected) expect(ART_KEYS.has(key)).toBe(true);
		expect(ART_KEYS.has(GENERIC_ART)).toBe(true);
		expect(ART_KEYS.size).toBe(expected.length + 1);
	});

	it('resolves every country and identity kind the record can hold', () => {
		for (const { code } of manifest.countries) {
			for (const kind of ENUMS['document_identity.kind']) {
				expect(documentArtUrl(code, kind)).not.toBe('');
			}
		}
	});
});

describe('documentArtUrl', () => {
	it('prefers the drawing made for that country and kind', () => {
		expect(documentArtUrl('CZ', 'passport')).toContain('cz-passport');
		expect(documentArtUrl('CZ', 'id_card')).toContain('cz-identity-card');
		expect(documentArtUrl('CZ', 'driving_licence')).toContain('cz-driving-licence');
	});

	it('keeps the country when the kind has no face of its own', () => {
		// A residence permit looks different in every country that issues one,
		// so it is drawn on the country's generic identity face rather than on a
		// fifth drawing that would be wrong everywhere.
		expect(documentArtUrl('PL', 'residence_permit')).toContain('pl-generic-id');
		expect(documentArtUrl('PL', 'other')).toContain('pl-generic-id');
		expect(documentArtUrl('PL', null)).toContain('pl-generic-id');
	});

	it('falls back to the generic face for a country outside the set', () => {
		// The field accepts all 249 codes; the set covers thirty. A Brazilian
		// passport gets a card, not a hole.
		expect(documentArtUrl('BR', 'passport')).toContain(GENERIC_ART);
		expect(documentArtUrl(null, 'passport')).toContain(GENERIC_ART);
		expect(documentArtUrl(null, null)).toContain(GENERIC_ART);
		expect(documentArtUrl('  ', 'id_card')).toContain(GENERIC_ART);
	});

	it('reads the country however it was cased or spaced', () => {
		expect(documentArtUrl('cz', 'passport')).toBe(documentArtUrl('CZ', 'passport'));
		expect(documentArtUrl(' CZ ', 'passport')).toBe(documentArtUrl('CZ', 'passport'));
	});
});
