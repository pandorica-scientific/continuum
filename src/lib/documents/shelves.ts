// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The shelves the application writes to by name.
 *
 * Capture files into the Inbox, an accepted import into Statements, payslips
 * and tax attachments into Income & Tax, bills from the Property screen into
 * Property. Every writer reads its key here; no other file spells one, and
 * `tests/unit/shelf-keys` fails the build on a writer that does.
 *
 * Four keys and no more. A shelf the application does not write to has no
 * business being named in code — it is the household's to rename or remove,
 * which is exactly what `system` on the row records.
 */
export const SYSTEM_SHELF_KEYS = {
	inbox: 'inbox',
	statements: 'statements',
	incomeTax: 'income_tax',
	property: 'property'
} as const;

export type WrittenShelfKey = (typeof SYSTEM_SHELF_KEYS)[keyof typeof SYSTEM_SHELF_KEYS];
