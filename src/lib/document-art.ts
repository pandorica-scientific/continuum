// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Which face a wallet card is drawn on.
import type { EnumValue } from '$lib/enums';

/**
 * The card faces, keyed by file name without extension.
 *
 * Read from the directory rather than listed here: a set that is written down
 * twice goes wrong the first time a country is added, and the failure — a card
 * drawing a blank — looks like a styling bug rather than a missing file. Vite
 * resolves and fingerprints each URL at build time, so this costs nothing at
 * run time and a renamed file is a build error rather than a 404.
 */
const CARDS = import.meta.glob<string>('$lib/assets/doc-placeholders/cards/*.webp', {
	eager: true,
	query: '?url',
	import: 'default'
});

/** `…/cards/cz-passport.webp` → `cz-passport`. */
const byKey = new Map(
	Object.entries(CARDS).map(([file, url]) => [
		file
			.split('/')
			.pop()!
			.replace(/\.webp$/, ''),
		url
	])
);

/** Every face the set holds, for the test that proves the manifest and the files agree. */
export const ART_KEYS: ReadonlySet<string> = new Set(byKey.keys());

/**
 * Which artwork an identity kind is drawn on.
 *
 * Four faces were drawn per country, and the enum has five kinds: a residence
 * permit shares the generic identity face rather than getting a fifth drawing
 * of a document whose appearance varies by issuing country anyway.
 */
const ART_KIND: Record<EnumValue<'document_identity.kind'>, string> = {
	passport: 'passport',
	id_card: 'identity-card',
	driving_licence: 'driving-licence',
	residence_permit: 'generic-id',
	other: 'generic-id'
};

/** The face every card falls back to: no country, no kind, still a card. */
export const GENERIC_ART = 'generic-document';

/**
 * The face for a document, narrowing until something exists.
 *
 * `<country>-<kind>` is the drawing that was made for exactly this document;
 * `<country>-generic-id` keeps the country when the kind has no face of its
 * own; `generic-document` is the last step and always resolves. The chain
 * matters because the set covers thirty countries and the field accepts all of
 * them — a Brazilian passport gets a card, not a hole.
 */
export function documentArtUrl(
	country: string | null,
	kind: EnumValue<'document_identity.kind'> | null
): string {
	const code = (country ?? '').trim().toLowerCase();
	const art = ART_KIND[kind ?? 'other'];
	const candidates = code ? [`${code}-${art}`, `${code}-generic-id`] : [];
	for (const key of candidates) {
		const url = byKey.get(key);
		if (url) return url;
	}
	return byKey.get(GENERIC_ART) ?? '';
}
