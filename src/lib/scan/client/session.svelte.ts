// SPDX-License-Identifier: AGPL-3.0-or-later
// The pages of one scan, in the order they will appear in the document.
//
// One PDF means the order of the tiles IS the order of the pages — getting it
// wrong is not a display preference, it is a wrong document.
//
// The phone now holds NO PAGE AT ALL. It used to keep each rendered page
// encoded, because a rendered A4 page is about 35 MB as pixels and twenty of
// them is more memory than a phone has; now the rendered page lives on the
// server and what is kept here is its id and a URL to a small preview. The old
// retention guarantee — that nothing full-resolution outlives the preview that
// produced it — has become something stronger: nothing full-resolution is ever
// in the browser.

import { defaultFilename, type PageMode } from '../core/index.ts';

export interface ScanPage {
	/** The server's id for this page, within the scan session. */
	id: string;
	mode: PageMode;
	/** Where the tile's picture comes from. Served, not held. */
	previewUrl: string;
}

/**
 * A very old phone struggles on a long session. Capping and SAYING SO beats an
 * out-of-memory crash — and the cap is now enforced by the server as well,
 * because this one has become advice that the endpoint does not depend on.
 */
export const MAX_PAGES = 20;

export function createSession() {
	let pages = $state<ScanPage[]>([]);
	let filename = $state(defaultFilename(Date.now()));
	let scanId = $state<string | null>(null);

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
		/** The server's session, once the first photograph has made one. */
		get id() {
			return scanId;
		},
		set id(next: string | null) {
			scanId = next;
		},

		add(id: string, mode: PageMode, previewUrl: string) {
			if (pages.length >= MAX_PAGES) return;
			pages = [...pages, { id, mode, previewUrl }];
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
			// The server keeps the page's artefact until the session ends. Nothing
			// is revoked here any more because nothing was ever allocated: a
			// removed page simply stops being asked for.
			pages = pages.filter((p) => p.id !== id);
		},

		rename(name: string) {
			filename = name.trim() || defaultFilename(Date.now());
		},

		dispose() {
			pages = [];
			scanId = null;
		}
	};
}
