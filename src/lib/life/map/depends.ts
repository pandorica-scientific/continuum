// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The one dependency key the map screens invalidate.
 *
 * Its own module because both halves need it and they may not import each
 * other: the country page's `load` declares it, and `CountryMap` — which runs
 * in the browser — asks for it after a scratch. Importing a `+page.server.ts`
 * from a component would pull server-only code into the bundle.
 *
 * It exists because `invalidateAll()` re-ran every load on the route for a
 * change to one region — the layout's net worth, the briefing, all of it —
 * which is the blink somebody sees after each scratch.
 */
export const VISITS = 'continuum:visits';
