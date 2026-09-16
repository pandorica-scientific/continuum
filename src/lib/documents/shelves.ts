// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The shelves the application writes to by name.
 *
 * Every writer reads its key here; no other file spells one, and
 * `tests/unit/shelf-keys` fails the build on a writer that does.
 *
 * Four keys and no more. A shelf the application does not write to is the
 * household's to rename or remove — that's what `system` on the row records.
 */
export const SYSTEM_SHELF_KEYS = {
	inbox: 'inbox',
	statements: 'statements',
	incomeTax: 'income_tax',
	property: 'property'
} as const;

export type WrittenShelfKey = (typeof SYSTEM_SHELF_KEYS)[keyof typeof SYSTEM_SHELF_KEYS];
