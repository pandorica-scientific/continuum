// SPDX-License-Identifier: AGPL-3.0-or-later
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

/**
 * A sentinel option that widens a shortened type list rather than choosing.
 *
 * An option rather than a control beside the select: the list is short because
 * a shelf said so, and the person who needs all seventeen needs them at the
 * moment they are looking at the list.
 */
export const ALL_TYPES = '__all__';

/**
 * May a shelf's own list fill the type field, or has somebody answered already?
 *
 * The one rule, read by the inbox review screen and the inspector alike: an
 * empty field or the `other` a form starts on is fair game, and so is a value
 * this rule put there a moment ago — picking Identity and then Statements must
 * not leave a bank statement typed as an identity document. A value somebody
 * CHOSE is never overwritten, which is the whole distinction `proposed` keeps.
 */
export function mayProposeType(current: string | undefined, proposed: boolean): boolean {
	return current === undefined || current === 'other' || proposed;
}

/**
 * What a type picker offers: the shelf's own list, or everything.
 *
 * Never a restriction — every caller posts whatever is chosen and the server
 * takes any type — so a shelf with no list is a full picker rather than a
 * refusal. The type already chosen stays in the list even when the shelf does
 * not name it, or changing shelf would silently retype the document.
 */
export function typeOptionsFor(
	offered: readonly string[],
	chosen: string | undefined,
	labels: Record<string, string>,
	all = false
): [string, string][] {
	const own = offered.filter((code) => code in labels);
	if (all || own.length === 0) return Object.entries(labels);
	const codes = chosen && !own.includes(chosen) ? [...own, chosen] : own;
	return codes.map((code) => [code, labels[code]]);
}
