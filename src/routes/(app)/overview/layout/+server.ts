import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { normalise, type OverviewPlacement } from '$lib/overview/layout';
import { PANEL_BOUNDS, PANELS } from '$lib/overview/panels';
import type { RequestHandler } from './$types';

// normalise keeps one entry per panel, so anything longer than the registry is
// already junk. Refusing it early keeps a hostile body from being walked.
const MAX_ENTRIES = PANELS.length * 4;

/**
 * Save this person's Overview board.
 *
 * Written on discrete gestures — drag end, resize end, add, remove, reset — and
 * the last write wins. Two tabs customising at once belong to the same person,
 * so losing costs them one re-drag rather than any integrity.
 *
 * The layout lives in a jsonb column, which stores whatever it is handed, so
 * the posted array is never trusted: `normalise` drops unknown panels and
 * duplicates, and clamps every coordinate onto the grid.
 */
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.person) error(401, 'Sign in first.');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Expected a JSON body.');
	}

	if (!Array.isArray(body)) error(400, 'Expected an array of panel placements.');
	if (body.length > MAX_ENTRIES) error(400, 'That is more panels than exist.');

	const layout = normalise(body as OverviewPlacement[], PANEL_BOUNDS);
	await db.update(person).set({ overviewLayout: layout }).where(eq(person.id, locals.person.id));

	// Handing the stored layout back lets the board correct itself when it
	// posted something the server clamped.
	return json({ layout });
};
