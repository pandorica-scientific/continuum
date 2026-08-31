// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What the documents screen and its form share that is not shelf-shaped.
//
// `SHELVES` used to live here: ten keys and labels the screen, the form and the
// CHECK constraint all had to agree about. Shelves are rows now — see
// `src/lib/server/documents/shelves.ts` — so the list is loaded, not compiled.

import { ENUMS } from '$lib/enums';

/** Derived, so the document form and the CHECK on document.expiry_verb agree. */
export const EXPIRY_VERBS = ENUMS['document.expiry_verb'];

/**
 * What each verb means, for the picker. The words alone sound alike; the
 * meaning beside them is what makes the choice answerable.
 */
export const EXPIRY_VERB_MEANINGS: Record<(typeof EXPIRY_VERBS)[number], string> = {
	renews: 'a replacement will arrive',
	expires: 'it simply stops',
	due: 'a payment falls'
};

/** Derived, so the identity form and the CHECK on document_identity.kind agree. */
export const IDENTITY_KINDS = ENUMS['document_identity.kind'];

/**
 * What a wallet card calls itself.
 *
 * Every one of these files as `type: 'id_document'`, so this is the only place
 * the difference between a passport and a driving licence is written down for
 * a reader.
 */
export const IDENTITY_KIND_LABELS: Record<(typeof IDENTITY_KINDS)[number], string> = {
	passport: 'Passport',
	id_card: 'Identity card',
	driving_licence: 'Driving licence',
	residence_permit: 'Residence permit',
	// "Other" in the picker, where the four named kinds are right above it and
	// the reader is choosing between them. NOT what a card face says: a card
	// reading "Other" tells its owner nothing, so `identityKindLabel` falls back
	// to the document's own type there instead.
	other: 'Other'
};

/** The named kinds only; `other` and anything unknown come back null. */
export const identityKindLabel = (code: string | null | undefined): string | null =>
	code && code !== 'other'
		? (IDENTITY_KIND_LABELS[code as (typeof IDENTITY_KINDS)[number]] ?? null)
		: null;
