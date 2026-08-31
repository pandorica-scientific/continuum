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
import { foldTagName } from '$lib/tags-view';

const RESERVE = 10;

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
	return `--series-r${(hash(foldTagName(name)) % RESERVE) + 1}`;
}
