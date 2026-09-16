// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The one dependency key the map screens invalidate. Its own module because
 * the country page's server `load` and the browser-side `CountryMap` both
 * need it and may not import each other. Exists because `invalidateAll()`
 * re-ran every load on the route for one region change, causing a blink.
 */
export const VISITS = 'continuum:visits';
