// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The easter egg: clicking the mark on an error screen replaces the Continuum
// rings with a drawing made for that status.
//
// The drawings are white line art on transparency, drawn once at 1024 and
// shared with the design file rather than re-exported per theme. They are used
// as a luminance mask over `currentColor`, so one file serves both themes and
// every hue — the ink takes the colour of the state it belongs to.

/** Where the drawings live under `static/`, without a code or an extension. */
export const ARTWORK_DIR = '/error-pages';

/** The square the drawings were exported at; the mask geometry depends on it. */
export const ARTWORK_SIZE = 1024;

/** The drawing for a status, as a URL the browser can fetch. */
export function artworkFor(code: string): string {
	return `${ARTWORK_DIR}/${code}.webp`;
}
