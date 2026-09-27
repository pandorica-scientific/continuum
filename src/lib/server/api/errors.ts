// SPDX-License-Identifier: AGPL-3.0-or-later
// A refusal the caller can act on, for the routes that answer row by row.
//
// A module of its own, not respond.ts: respond reads the table registry, and
// the table and file modules throw this, so either home would be a cycle.

/** A refusal with the status it answers with. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}
