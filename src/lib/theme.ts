// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import type { EnumValue } from '$lib/enums';

export type Theme = EnumValue<'person.theme'>;

/**
 * The mirror of `person.theme` that the browser can read before paint.
 *
 * The record is the column; this exists because `app.html` has to decide what
 * to paint before any JavaScript module has loaded, let alone a database has
 * answered. Written by the server on every signed-in load, so signing in as
 * someone else corrects it on the first page rather than the second.
 *
 * Not `httpOnly`: the whole point is that the inline script reads it. There is
 * nothing in it worth protecting — it says which of two colour schemes someone
 * prefers.
 */
export const THEME_COOKIE = 'continuum_theme';

export function themeCookieOptions() {
	return {
		path: '/',
		httpOnly: false,
		sameSite: 'lax' as const,
		maxAge: 60 * 60 * 24 * 365
	};
}

/** Null — never chosen — reads as dark, which is the default the app paints. */
export function themeOrDefault(stored: string | null | undefined): Theme {
	return stored === 'light' ? 'light' : 'dark';
}
