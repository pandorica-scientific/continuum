// SPDX-License-Identifier: AGPL-3.0-or-later
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { isEnumValue } from '$lib/enums';
import { THEME_COOKIE, themeCookieOptions } from '$lib/theme';
import type { RequestHandler } from './$types';

/**
 * Save this person's theme. Stored on the person, not only `localStorage`, so
 * two people sharing a device do not share a theme. The cookie set alongside
 * is a mirror only — `app.html` reads it before paint, avoiding a flash.
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
