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

/**
 * The SQLSTATE of a refusal from Postgres, wherever in the cause chain the
 * driver's error sits. Read from the `code` field every Postgres driver sets
 * rather than by `instanceof` one driver's class, so a change of driver or of
 * how Drizzle wraps it does not quietly turn every refusal into a 500.
 */
function postgresRefusal(
	error: unknown
): { code: string; message: string; detail?: string } | null {
	for (let at: unknown = error, depth = 0; at && depth < 5; depth++) {
		const { code, message, detail } = at as { code?: unknown; message?: unknown; detail?: unknown };
		if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && typeof message === 'string') {
			return { code, message, detail: typeof detail === 'string' ? detail : undefined };
		}
		at = (at as { cause?: unknown }).cause;
	}
	return null;
}

/**
 * Run a statement, answering Postgres' refusals as the caller's mistake.
 *
 * A value the column cannot hold (class 22), a broken constraint (class 23), a
 * value of the wrong type (42804) and a key too long to index (54000) are all
 * about the row that was sent, so they are a 400 or a 409 in Postgres' own
 * words; anything else is the server's fault and stays a 500 with its stack in
 * the log.
 *
 * Only the message goes back, never the detail, with one exception below: the
 * detail of a NOT NULL or CHECK refusal is "Failing row contains (…)" — the
 * whole row, hidden columns and all, a person's password hash among them.
 */
export async function refusingBadRows<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		const refusal = postgresRefusal(error);
		if (!refusal) throw error;
		const { code, message, detail } = refusal;
		// 23505 a duplicate key, 23503 a missing or still-referenced row, 23001
		// a delete an ON DELETE RESTRICT key holds back: the request was well
		// formed, and conflicts with rows already there. Their detail names the
		// key and nothing else, and is what says WHICH row is in the way.
		if (code === '23505' || code === '23503' || code === '23001') {
			throw new ApiError([message, detail].filter(Boolean).join(' — '), 409);
		}
		if (code.startsWith('22') || code.startsWith('23') || code === '42804' || code === '54000') {
			throw new ApiError(message, 400);
		}
		throw error;
	}
}

/**
 * Whether reading a request's body failed because it was larger than the
 * server takes. SvelteKit's adapter refuses such a body with a 413 of its own
 * part-way through the read, which a parser then reports as a failed parse;
 * this tells the two apart, so the caller hears "too large" rather than "not
 * JSON".
 */
export function bodyTooLarge(error: unknown): boolean {
	for (let at: unknown = error, depth = 0; at && depth < 5; depth++) {
		if ((at as { status?: unknown }).status === 413) return true;
		at = (at as { cause?: unknown }).cause;
	}
	return false;
}
