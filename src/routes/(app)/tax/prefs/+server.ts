// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { normaliseTaxView } from '$lib/tax';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { getBaseCurrency } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * Save how this person left the Tax screen.
 *
 * Written on discrete gestures — a mode toggle, a currency, a filer — and the
 * last write wins. Two tabs belong to the same person, so losing costs one
 * click rather than any integrity.
 *
 * The same shape as /overview/layout: a jsonb column on the person, normalised
 * on the way in because the column stores whatever it is handed.
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

	// Handing back what was stored lets the screen correct itself when it posted
	// something the server refused.
	return json(prefs);
};
