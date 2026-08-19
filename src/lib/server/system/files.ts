// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
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
	const ext = extname(file.name).toLowerCase();
	if (!ALLOWED_EXT.has(ext)) throw new Error(`File type ${ext || 'unknown'} is not allowed.`);
	await mkdir(uploadDir(), { recursive: true });
	const name = `${randomUUID()}${ext}`;
	await writeFile(join(uploadDir(), name), new Uint8Array(await file.arrayBuffer()));
	return name;
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
