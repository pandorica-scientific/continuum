// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ids that arrive from outside.
 *
 * Surrogate keys became `uuid` in migration 0053, and PostgreSQL refuses a
 * malformed one outright — `invalid input syntax for type uuid` — rather than
 * simply matching no row. A lookup by an id from a URL or a form therefore
 * turned a 404 into a 500 the moment anyone sent something that was not a uuid,
 * which an end-to-end test caught by asking for a person that does not exist.
 *
 * Junk becomes the nil uuid: a valid uuid that nothing can ever be, because
 * UUIDv7 always carries a timestamp and a version nibble. So the query is legal,
 * matches nothing, and every caller's existing "no rows, so 404" path runs
 * exactly as it did when ids were text.
 *
 * Deliberately NOT for ids we generate ourselves — those are already uuids, and
 * routing one through here would hide a real defect behind a silent miss.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id that no row can have, so a lookup with it finds nothing. */
const NO_SUCH_ROW = '00000000-0000-0000-0000-000000000000';

export function asRowId(value: unknown): string {
	if (typeof value !== 'string') return NO_SUCH_ROW;
	const trimmed = value.trim();
	return UUID.test(trimmed) ? trimmed : NO_SUCH_ROW;
}

/** For an optional id: absent stays absent, junk becomes unmatchable. */
export function asOptionalRowId(value: unknown): string | undefined {
	if (value === null || value === undefined || value === '') return undefined;
	return asRowId(value);
}
