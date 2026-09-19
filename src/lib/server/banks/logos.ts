// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A bank's logo, where one has been placed on disk.
 *
 * Built exactly like the place engravings next door (`$lib/server/life/places`)
 * — a directory of committed files named by key, read once into a set, served
 * by a route that validates the key rather than joining it onto a path.
 * `scripts/fetch-bank-logos.mjs` is what refreshes them, run by hand, and
 * `assets/bank-logos/CREDITS.md` states where each came from and on what terms.
 *
 * A missing file is an ordinary state, not an error: a bank Wikidata states no
 * logo for, or one a household added themselves, falls back to the emoji the
 * accounts screen has always drawn.
 */
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where a fetched logo lands. Relative to the working directory, as tessdata is. */
const LOGOS_DIR = process.env.BANK_LOGOS_DIR ?? 'assets/bank-logos';

/**
 * The shape `bankKeyFor` mints, which is the only shape that may reach a path.
 * Same lesson as `/files/[name]` and the engravings.
 */
const KEY = /^[a-z0-9][a-z0-9-]{0,60}$/;

let present: Set<string> | null = null;

/**
 * Which keys have a file, read once.
 *
 * Cached for the life of the process: the directory is filled before the image
 * is built, or by a script the operator runs and then restarts. Re-reading it
 * per account row would stat the disk once per row per page.
 */
function available(): Set<string> {
	if (!present) {
		try {
			present = new Set(
				readdirSync(LOGOS_DIR)
					.filter((name) => name.endsWith('.webp'))
					.map((name) => name.slice(0, -'.webp'.length))
			);
		} catch {
			// No logos in this build, which is the ordinary case and not an error:
			// every bank falls back to its emoji.
			present = new Set();
		}
	}
	return present;
}

/** Whether this bank has a logo to draw instead of its emoji. */
export function hasLogo(key: string): boolean {
	return KEY.test(key) && available().has(key);
}

/** One bank's logo, or null where there is none to serve. */
export async function bankLogo(key: string): Promise<Uint8Array | null> {
	if (!hasLogo(key)) return null;
	try {
		return new Uint8Array(await readFile(join(LOGOS_DIR, `${key}.webp`)));
	} catch {
		return null;
	}
}

/**
 * Where a screen should point an `<img>`, or null where the emoji stands.
 *
 * One place builds this path. Two loaders were about to spell the same URL
 * themselves, and a route that moved would have left one of them 404ing.
 */
export function logoHref(key: string): string | null {
	return hasLogo(key) ? `/accounts/logo/${key}.webp` : null;
}

/** Testing seam: forget what the directory held, so a fixture can change it. */
export function forgetLogos(): void {
	present = null;
}
