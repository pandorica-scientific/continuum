// SPDX-License-Identifier: AGPL-3.0-or-later
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { normalise, type OverviewPlacement } from '$lib/overview/layout';
import { PANEL_BOUNDS, PANELS } from '$lib/overview/panels';
import type { RequestHandler } from './$types';

// Anything longer than the registry allows is already junk; refuse it before walking it.
const MAX_ENTRIES = PANELS.length * 4;

/**
 * Save this person's Overview board. Last write wins (fine: both tabs belong
 * to the same person). The posted array is never trusted — `normalise` drops
 * unknown panels/duplicates and clamps coordinates onto the grid.
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

	// Hand back the stored layout so the board can correct itself if it was clamped.
	return json({ layout });
};
