// SPDX-License-Identifier: AGPL-3.0-or-later
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { normaliseTaxView } from '$lib/tax';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { getBaseCurrency } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * Save how this person left the Tax screen. Last write wins — two tabs
 * belong to the same person, so a race costs one click, not integrity.
 */
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.person) error(401, 'Sign in first.');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Expected a JSON body.');
	}

	const [people, currencies, base] = await Promise.all([
		db.select({ id: person.id }).from(person),
		availableCurrencies(),
		getBaseCurrency()
	]);

	const prefs = normaliseTaxView(
		body,
		people.map((p) => p.id),
		currencies,
		base
	);
	await db.update(person).set({ taxView: prefs }).where(eq(person.id, locals.person.id));

	// Return the stored value so the screen can correct itself if it posted something invalid.
	return json(prefs);
};
