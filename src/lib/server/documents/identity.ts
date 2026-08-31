// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { eq } from 'drizzle-orm';
import { asEnumValue, type EnumValue } from '$lib/enums';
import { db, type Queryable } from '$lib/server/db';
import { documentIdentity, documentIdentityNumber } from '$lib/server/db/schema';

/** One more number the document carries, named by whoever typed it. */
export interface IdentityNumber {
	label: string;
	value: string;
}

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
 * The extra numbers, in the order the form posted them.
 *
 * A row survives only if BOTH halves were filled: a label with no number names
 * nothing and a number with no label cannot be read back. An emptied row is
 * how one is deleted, which is why the write below replaces the set rather
 * than merging into it.
 */
export function readIdentityNumbers(form: FormData): IdentityNumber[] {
	const labels = form.getAll('identityExtraLabel').map((v) => String(v).trim());
	const values = form.getAll('identityExtraValue').map((v) => String(v).trim());
	const rows: IdentityNumber[] = [];
	for (let i = 0; i < Math.max(labels.length, values.length); i++) {
		const label = labels[i] ?? '';
		const value = values[i] ?? '';
		if (label && value) rows.push({ label, value });
	}
	return rows;
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

/**
 * Replace the extra numbers with exactly what the form holds.
 *
 * A replacement, not a merge: the form shows every row the document has, so
 * what comes back IS the intended set and a row that is missing from it was
 * cleared on purpose. The same rule the tags field follows two screens over.
 *
 * Ordinals are re-issued from the form's order, so removing the first of three
 * leaves 0 and 1 rather than a gap the next insert would collide with.
 */
export async function replaceIdentityNumbers(
	documentId: string,
	numbers: IdentityNumber[],
	handle: Queryable = db
): Promise<void> {
	await handle
		.delete(documentIdentityNumber)
		.where(eq(documentIdentityNumber.documentId, documentId));
	if (numbers.length === 0) return;
	await handle
		.insert(documentIdentityNumber)
		.values(numbers.map((row, ordinal) => ({ documentId, ordinal, ...row })));
}

/** A document's extra numbers, in the order they were typed. */
export async function identityNumbersFor(
	documentId: string,
	handle: Queryable = db
): Promise<IdentityNumber[]> {
	return handle
		.select({ label: documentIdentityNumber.label, value: documentIdentityNumber.value })
		.from(documentIdentityNumber)
		.where(eq(documentIdentityNumber.documentId, documentId))
		.orderBy(documentIdentityNumber.ordinal);
}
