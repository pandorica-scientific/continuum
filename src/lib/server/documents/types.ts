// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What kinds of paper this household files.
 *
 * A built-in key is read by name in code (the salary tracker looks for
 * `payslip`, an accepted import writes `bank_statement`, the wallet keys off
 * `id_document`), so it may be relabelled but never removed. A household's
 * own type has no behaviour behind it, which is what makes it safe to invent.
 */
import { asc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { db, type Queryable } from '$lib/server/db';
import { documentType } from '$lib/server/db/schema';

export interface DocumentTypeRow {
	key: string;
	label: string;
	builtin: boolean;
	/** The amber window this kind earns, or null for the sixty-day default. */
	reminderDays: number | null;
}

/** Built-ins first in their shipped order, then the household's, alphabetically. */
export async function listDocumentTypes(handle: Queryable = db): Promise<DocumentTypeRow[]> {
	return handle
		.select({
			key: documentType.key,
			label: documentType.label,
			builtin: documentType.builtin,
			reminderDays: documentType.reminderDays
		})
		.from(documentType)
		.orderBy(asc(documentType.sortOrder), asc(documentType.label));
}

/**
 * Just the keys, which is all validating a posted type needs.
 *
 * Read fresh inside each action rather than carried down from the load: a
 * type added in another tab a second ago is a key this one has never seen.
 */
export async function documentTypeKeys(handle: Queryable = db): Promise<string[]> {
	return (await listDocumentTypes(handle)).map((row) => row.key);
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
 * devices have agreed, not collided.
 */
export async function addDocumentType(
	label: string,
	handle: Queryable = db
): Promise<DocumentTypeRow> {
	const name = label.trim();
	const key = typeKeyFor(name);
	if (!key) throw new Error('A type needs a name with letters in it.');

	const [existing] = await handle
		.select({
			key: documentType.key,
			label: documentType.label,
			builtin: documentType.builtin,
			reminderDays: documentType.reminderDays
		})
		.from(documentType)
		.where(eq(documentType.key, key))
		.limit(1);
	if (existing) return existing;

	// After every built-in, so a household's own types gather at the end of every picker.
	await handle.insert(documentType).values({ key, label: name, builtin: false, sortOrder: 1000 });
	return { key, label: name, builtin: false, reminderDays: null };
}

/** What a household's own type is refused for, in words rather than a code. */
export const TYPE_IN_USE = 'That type is on documents already, so it cannot be removed.';
export const TYPE_IS_BUILTIN = 'That type comes with the app and cannot be removed.';

/**
 * Remove a type the household added, if nothing is filed as it.
 *
 * The foreign key from `document.type` is what actually refuses, so this
 * reads its violation rather than counting first: a document filed between
 * the count and the delete would slip through a check that asked.
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
 * Matched by constraint name as well as code (23503 or 23001), so the cascade
 * from `shelf_type` — not a refusal at all — is never reported as one.
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
 * What is valid is what the household has now, so a stale option posted from
 * a tab open since before a type was removed lands on `other` rather than a
 * foreign key violation.
 */
export function asDocumentType(value: unknown, known: readonly string[]): string {
	const code = typeof value === 'string' ? value : '';
	return known.includes(code) ? code : 'other';
}
