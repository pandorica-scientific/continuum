// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * What kinds of paper this household files.
 *
 * Seventeen ship with the app and the household adds its own. The difference
 * between the two is not cosmetic: a built-in key is read by name somewhere in
 * the code — the salary tracker looks for `payslip`, an accepted import writes
 * `bank_statement`, the wallet puts its identity fields on `id_document` — so
 * a built-in may be relabelled and never removed. A household's own type has
 * no behaviour behind it at all, which is exactly what makes it safe to invent.
 */
import { asc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { db, type Queryable } from '$lib/server/db';
import { documentType } from '$lib/server/db/schema';

export interface DocumentTypeRow {
	key: string;
	label: string;
	builtin: boolean;
}

/** Built-ins first in their shipped order, then the household's, alphabetically. */
export async function listDocumentTypes(handle: Queryable = db): Promise<DocumentTypeRow[]> {
	return handle
		.select({
			key: documentType.key,
			label: documentType.label,
			builtin: documentType.builtin
		})
		.from(documentType)
		.orderBy(asc(documentType.sortOrder), asc(documentType.label));
}

/** `Vaccination book` → `vaccination_book`, which is what a document stores. */
export function typeKeyFor(label: string): string {
	return label
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 40);
}

/**
 * Add a type, or return the one that already answers to that name.
 *
 * Idempotent rather than an error: two people adding "Vaccination book" on two
 * devices have agreed, not collided. A label that slugs to nothing — punctuation
 * only — is the one refusal, because the key is what documents store.
 */
export async function addDocumentType(
	label: string,
	handle: Queryable = db
): Promise<DocumentTypeRow> {
	const name = label.trim();
	const key = typeKeyFor(name);
	if (!key) throw new Error('A type needs a name with letters in it.');

	const [existing] = await handle
		.select({ key: documentType.key, label: documentType.label, builtin: documentType.builtin })
		.from(documentType)
		.where(eq(documentType.key, key))
		.limit(1);
	if (existing) return existing;

	// After every built-in, so the shipped order stays the shipped order and a
	// household's own types gather at the end of every picker.
	await handle.insert(documentType).values({ key, label: name, builtin: false, sortOrder: 1000 });
	return { key, label: name, builtin: false };
}

/** What a household's own type is refused for, in words rather than a code. */
export const TYPE_IN_USE = 'That type is on documents already, so it cannot be removed.';
export const TYPE_IS_BUILTIN = 'That type comes with the app and cannot be removed.';

/**
 * Remove a type the household added, if nothing is filed as it.
 *
 * The foreign key from `document.type` is what actually refuses, so this reads
 * its violation rather than counting first: a document filed a moment ago
 * between the count and the delete would slip through a check that asked.
 */
export async function removeDocumentType(key: string, handle: Queryable = db): Promise<void> {
	const [row] = await handle
		.select({ builtin: documentType.builtin })
		.from(documentType)
		.where(eq(documentType.key, key))
		.limit(1);
	if (!row) return;
	if (row.builtin) throw new Error(TYPE_IS_BUILTIN);
	try {
		await handle.delete(documentType).where(eq(documentType.key, key));
	} catch (error) {
		if (isTypeInUse(error)) throw new Error(TYPE_IN_USE, { cause: error });
		throw error;
	}
}

/**
 * True only for the foreign key from `document.type`.
 *
 * `NO ACTION` reports 23503 and the `ON DELETE RESTRICT` this column declares
 * reports the more specific 23001; both are matched, with the constraint name,
 * so the cascade from `shelf_type` — which is not a refusal at all — could
 * never be reported as one.
 *
 * Drizzle wraps the driver's `PostgresError` in a `DrizzleQueryError` with the
 * original as `.cause`, which is where the code is read from.
 */
function isTypeInUse(error: unknown): boolean {
	const cause = error instanceof Error ? error.cause : undefined;
	return (
		cause instanceof postgres.PostgresError &&
		(cause.code === '23503' || cause.code === '23001') &&
		(cause.constraint_name ?? '').includes('document_type_document_type_key_fk')
	);
}

/**
 * A posted type, or `other`.
 *
 * The list replaces `asEnumValue` for this column: the values are rows now, so
 * what is valid is what the household has, and a stale option posted from a tab
 * open since before a type was removed lands on `other` rather than on a
 * foreign key violation.
 */
export function asDocumentType(value: unknown, known: readonly string[]): string {
	const code = typeof value === 'string' ? value : '';
	return known.includes(code) ? code : 'other';
}
