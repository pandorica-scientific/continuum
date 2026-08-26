// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { env } from '$env/dynamic/private';

// User uploads (floor plans, photos, later documents) live on the data volume
// (`/data` in Docker, `./data` in development) and are served through an
// authenticated route — never from `static/`.

const ALLOWED_EXT = new Set([
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
	// original statement files, kept for re-parsing
	'.csv',
	'.xml',
	'.ofx',
	'.abo',
	'.xlsx'
]);

function uploadDir(): string {
	return env.UPLOAD_DIR || 'data';
}

function isUploadName(name: string): boolean {
	return /^[0-9a-f-]{36}\.[a-z0-9]+$/.test(name);
}

export async function saveUpload(file: File): Promise<string> {
	return saveUploadBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}

/**
 * The same, for a caller that already holds the bytes.
 *
 * Every upload path that has to look INSIDE a file — reading a payslip,
 * fingerprinting it — has already materialised the bytes. Wrapping them back
 * into a `File` only for `saveUpload` to unwrap them again copied a whole PDF
 * twice per upload, and once per file across a bulk drop.
 */
export async function saveUploadBytes(bytes: Uint8Array, fileName: string): Promise<string> {
	const ext = extname(fileName).toLowerCase();
	if (!ALLOWED_EXT.has(ext)) throw new Error(`File type ${ext || 'unknown'} is not allowed.`);
	await mkdir(uploadDir(), { recursive: true });
	const name = `${randomUUID()}${ext}`;
	await writeFile(join(uploadDir(), name), bytes);
	return name;
}

/**
 * The fingerprint of an upload's CONTENTS, not of its name.
 *
 * A payslip re-uploaded is the same bytes under whatever name the browser
 * happened to hand over, and since a month may hold more than one slip there is
 * no longer a unique key that catches it: a second upload mints a second
 * document id, which is a second row by definition. The bytes are the only
 * thing that says "this is the file already filed" without guessing from
 * figures — two jobs paying the same amount in the same month are a real
 * arrangement, and must not be merged on the strength of matching numbers.
 */
export function hashBytes(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The same fingerprint for a file already on the volume.
 *
 * Documents filed before there was a hash column carry none, so the first
 * upload that has to compare against one computes it and stores it. Null when
 * the file is gone — a document whose upload has been lost cannot be matched
 * against, and must not stop the ones that can.
 */
export async function hashStoredUpload(name: string): Promise<string | null> {
	if (!isUploadName(name)) return null;
	try {
		return hashBytes(new Uint8Array(await readFile(join(uploadDir(), name))));
	} catch {
		return null;
	}
}

/** Remove a just-saved orphan after a later database mutation fails. */
export async function removeUpload(name: string): Promise<boolean> {
	if (!isUploadName(name)) return false;
	try {
		await unlink(join(uploadDir(), name));
		return true;
	} catch {
		return false;
	}
}

const CONTENT_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.heic': 'image/heic',
	'.heif': 'image/heif',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf',
	'.csv': 'text/csv',
	'.xml': 'application/xml',
	'.ofx': 'application/octet-stream',
	'.abo': 'application/octet-stream',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

/**
 * Uploads are user content served from the app's own origin, so nothing in
 * them may run. An SVG is not an image to a browser, it is a document: navigate
 * to one and any <script> it carries executes on this origin with the session
 * cookie attached — stored cross-site scripting from an ordinary photo upload,
 * and from there every authenticated action is reachable.
 *
 * The policy applies to the file's own document, so an SVG still renders inside
 * an <img> (which cannot run scripts anyway) while a direct visit to it is
 * inert. `nosniff` stops a .csv or .abo being re-interpreted as HTML on the
 * strength of its contents.
 */
// No `sandbox` token. It would put the response in an opaque origin with
// scripting disabled, which is exactly what the browsers' own PDF viewers are
// — pdf.js in Firefox, the built-in viewer in Chrome — so every uploaded bill,
// payslip and scanned statement opened as a blank tab, with `allow-downloads`
// absent so the save fallback failed too. It bought nothing either: there is no
// script-src here, and `default-src 'none'` already blocks inline and external
// script alike, which is the whole of the SVG threat.
const SECURITY_HEADERS: Record<string, string> = {
	'content-security-policy':
		"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'",
	'x-content-type-options': 'nosniff'
};

// Data formats nobody views in a browser tab. Handing them over as a download
// removes the question of how the browser might choose to render them.
const DOWNLOAD_ONLY = new Set(['.csv', '.xml', '.ofx', '.abo', '.xlsx']);

export async function openUpload(name: string): Promise<Response | null> {
	// The name is always a uuid + extension we generated; reject anything else.
	if (!isUploadName(name)) return null;
	const path = join(uploadDir(), name);
	const ext = extname(name);
	try {
		const info = await stat(path);
		const headers: Record<string, string> = {
			...SECURITY_HEADERS,
			'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
			'content-length': String(info.size),
			'cache-control': 'private, max-age=31536000, immutable'
		};
		if (DOWNLOAD_ONLY.has(ext)) headers['content-disposition'] = `attachment; filename="${name}"`;
		return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
	} catch {
		return null;
	}
}
