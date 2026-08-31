// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
