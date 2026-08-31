// SPDX-License-Identifier: AGPL-3.0-or-later
// The pages of one scan, in the order they will appear in the document.
//
// One PDF means the order of the tiles IS the order of the pages — getting it
// wrong is not a display preference, it is a wrong document.
//
// Only the ENCODED page is kept, never the frame it came from. A rendered A4
// page is about 35 MB as pixels, so twenty of them is more memory than a phone
// has; encoded they are a few hundred kilobytes each. The frame is decoded back
// one at a time when the PDF is written, which is also the retention guarantee:
// nothing full-resolution outlives the preview that produced it.

import { defaultFilename, type PageMode } from '../core/index.ts';

export interface ScanPage {
	id: string;
	mode: PageMode;
	/** The rendered page, encoded. */
	blob: Blob;
	/** An object URL onto `blob`, for the tile. Revoked when the page goes. */
	previewUrl: string;
}

/**
 * A very old phone struggles on a long session. Capping and SAYING SO beats an
 * out-of-memory crash, and the recovery costs nothing because nothing is on a
 * server to reconcile.
 */
export const MAX_PAGES = 20;

let counter = 0;

export function createSession() {
	let pages = $state<ScanPage[]>([]);
	let filename = $state(defaultFilename(Date.now()));

	function free(page: ScanPage) {
		if (page.previewUrl) URL.revokeObjectURL(page.previewUrl);
	}

	return {
		get pages() {
			return pages;
		},
		get filename() {
			return filename;
		},
		get full() {
			return pages.length >= MAX_PAGES;
		},

		add(mode: PageMode, blob: Blob) {
			if (pages.length >= MAX_PAGES) return;
			pages = [
				...pages,
				{ id: `page-${++counter}`, mode, blob, previewUrl: URL.createObjectURL(blob) }
			];
		},

		move(id: string, direction: -1 | 1) {
			const from = pages.findIndex((page) => page.id === id);
			const to = from + direction;
			// An edge move does nothing rather than wrapping: the buttons dim at
			// the ends instead of disappearing, so the reason is visible.
			if (from < 0 || to < 0 || to >= pages.length) return;
			const next = [...pages];
			[next[from], next[to]] = [next[to], next[from]];
			pages = next;
		},

		remove(id: string) {
			const page = pages.find((p) => p.id === id);
			if (page) free(page);
			pages = pages.filter((p) => p.id !== id);
		},

		rename(name: string) {
			filename = name.trim() || defaultFilename(Date.now());
		},

		dispose() {
			for (const page of pages) free(page);
			pages = [];
		}
	};
}
