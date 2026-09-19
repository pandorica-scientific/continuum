// SPDX-License-Identifier: AGPL-3.0-or-later
// What may be uploaded, in the one place the server and the file pickers agree.

/**
 * Every extension the server will store.
 *
 * The server refuses anything else outright, so a picker offering more than
 * this is a picker that leads to "File type .docx is not allowed" after the
 * upload — the worst moment to learn it. Written down once and read from both
 * sides, because two lists of the same rule drift and the drift only shows up
 * as somebody's failed upload.
 */
export const UPLOAD_EXTENSIONS = [
	'.png',
	'.jpg',
	'.jpeg',
	'.webp',
	'.gif',
	'.svg',
	// An iPhone photographs in HEIC, so the camera button hands one over
	// directly. Refusing it fails the upload outright with "File type .heic is
	// not allowed", which is a dead end at the moment someone has just taken a
	// picture.
	'.heic',
	'.heif',
	'.pdf',
	// Original statement files, kept for re-parsing.
	'.csv',
	'.xml',
	'.ofx',
	'.abo',
	'.xlsx'
] as const;

/**
 * The `accept` a documents upload takes.
 *
 * Not decoration: `UploadDropzone` decides from `accept` whether a camera or the
 * scanner could help here, so a dropzone that names nothing draws no capture
 * buttons at all — which is exactly how the Documents screen came to have no
 * scan button on a phone while every other upload site had one.
 */
export const DOCUMENT_ACCEPT = UPLOAD_EXTENSIONS.join(',');

/** The parts of a File that say whether two picks are the same file. */
export interface PickedFile {
	name: string;
	size: number;
	lastModified: number;
}

/**
 * Gathering files across several visits to the picker.
 *
 * A file input replaces its selection every time, which is right for "choose a
 * file" and wrong for "gather the year's paperwork": adding one document and
 * then another silently threw the first away. A multi-file FIELD therefore
 * merges instead, and this is the rule it merges by.
 *
 * Order is arrival order — the answers beside each file (what it is, which
 * country it came from) are paired with it by position, so a merge that
 * reordered would move somebody's answer onto another document.
 *
 * The same file picked twice is one file. There is no identity to go on beyond
 * what the browser exposes, so name, size and modified time together stand in
 * for one: two genuinely different files agreeing on all three would have to be
 * copies of each other.
 */
export function mergePicked<T extends PickedFile>(held: readonly T[], incoming: readonly T[]): T[] {
	const merged = [...held];
	for (const file of incoming) {
		const seen = merged.some(
			(other) =>
				other.name === file.name &&
				other.size === file.size &&
				other.lastModified === file.lastModified
		);
		if (!seen) merged.push(file);
	}
	return merged;
}
