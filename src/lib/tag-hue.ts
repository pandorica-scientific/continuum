// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which colour a tag is, everywhere it appears.
 *
 * Decided by the tag's name, not stored: the same tag reads the same on a
 * document row, in the inspector and on a transaction without any table
 * agreeing about it, and a tag renamed to something else is a different tag.
 *
 * The reserve series (`--series-r1` … `--series-r10`) rather than the
 * traffic light: green, amber and red mean state in this system, and a tag is
 * a data series — the same class of thing a category is.
 */
const RESERVE = 10;

/** Folded the way the server folds a tag name, so `Renovation` and `renovation` share a hue. */
function fold(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** FNV-1a: small, stable across runtimes, and evenly spread over ten buckets. */
function hash(value: string): number {
	let h = 0x811c9dc5;
	for (const char of value) {
		h ^= char.codePointAt(0) ?? 0;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

/** The CSS token for this tag's hue, e.g. `--series-r4`. */
export function tagHue(name: string): string {
	return `--series-r${(hash(fold(name)) % RESERVE) + 1}`;
}
