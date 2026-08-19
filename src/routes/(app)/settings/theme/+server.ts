// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { isEnumValue } from '$lib/enums';
import { THEME_COOKIE, themeCookieOptions } from '$lib/theme';
import type { RequestHandler } from './$types';

/**
 * Save this person's theme.
 *
 * Stored on the person, not in the browser: it used to live in `localStorage`,
 * which meant two people sharing a laptop shared a theme and one person on a
 * laptop and a phone silently had two.
 *
 * The cookie set alongside it is a mirror, not the record. `app.html` reads it
 * before paint — a database round trip cannot happen that early, and without it
 * every load flashes dark before correcting itself.
 */
export const PUT: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.person) error(401, 'Sign in first.');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Expected a JSON body.');
	}

	const theme = (body as { theme?: unknown })?.theme;
	if (!isEnumValue('person.theme', theme)) error(400, 'That is not a theme.');

	await db.update(person).set({ theme }).where(eq(person.id, locals.person.id));
	cookies.set(THEME_COOKIE, theme, themeCookieOptions());

	return json({ theme });
};
