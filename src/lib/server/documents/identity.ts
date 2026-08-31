// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * What an identity document says on its face.
 *
 * Five fields, all optional, all typed by a person. Nothing in this module is
 * ever called by the extraction pipeline, and that is the point: `extract/`
 * reads text into chunks and is forbidden from writing a record's fields, so a
 * passport number here was read by the household off the passport. A number a
 * recogniser guessed wrong is worse than an empty box, because the empty box
 * asks and the wrong one is believed.
 *
 * The row is keyed by the document and cascades with it. It is NOT deleted when
 * a document is retyped away from `id_document` — the fields stop being shown
 * and are still there if the type comes back, because a mis-set dropdown should
 * not throw away five things somebody typed.
 */
import { isCountryCode } from '$lib/countries';
import { asEnumValue, type EnumValue } from '$lib/enums';
import { db, type Queryable } from '$lib/server/db';
import { documentIdentity } from '$lib/server/db/schema';

export interface IdentityFields {
	kind: EnumValue<'document_identity.kind'>;
	country: string | null;
	number: string | null;
	issuedOn: string | null;
	issuer: string | null;
}

/** Empty string is what an untouched input posts; it means absent, not blank. */
const orNull = (value: FormDataEntryValue | null): string | null => {
	const text = typeof value === 'string' ? value.trim() : '';
	return text === '' ? null : text;
};

/**
 * The five fields, as the form posted them.
 *
 * The country is normalised to the shape the CHECK, the flag and the artwork
 * lookup all expect; anything else becomes null rather than being stored as
 * something only one of the three can read.
 */
export function readIdentityFields(form: FormData): IdentityFields {
	const country = orNull(form.get('identityCountry'))?.toUpperCase() ?? null;
	return {
		kind: asEnumValue('document_identity.kind', form.get('identityKind'), 'other'),
		country: isCountryCode(country) ? country : null,
		number: orNull(form.get('identityNumber')),
		issuedOn: orNull(form.get('identityIssuedOn')),
		issuer: orNull(form.get('identityIssuer'))
	};
}

/**
 * Write the fields, whether or not the document had them before.
 *
 * An upsert rather than an insert-or-update pair: the caller is inside the same
 * transaction that saved the document, and a row that exists is exactly as
 * ordinary as one that does not.
 */
export async function upsertIdentity(
	documentId: string,
	fields: IdentityFields,
	handle: Queryable = db
): Promise<void> {
	await handle
		.insert(documentIdentity)
		.values({ documentId, ...fields })
		.onConflictDoUpdate({ target: documentIdentity.documentId, set: fields });
}
