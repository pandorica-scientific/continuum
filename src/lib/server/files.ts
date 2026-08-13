import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
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

export async function saveUpload(file: File): Promise<string> {
	const ext = extname(file.name).toLowerCase();
	if (!ALLOWED_EXT.has(ext)) throw new Error(`File type ${ext || 'unknown'} is not allowed.`);
	await mkdir(uploadDir(), { recursive: true });
	const name = `${randomUUID()}${ext}`;
	await writeFile(join(uploadDir(), name), new Uint8Array(await file.arrayBuffer()));
	return name;
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

export async function openUpload(name: string): Promise<Response | null> {
	// The name is always a uuid + extension we generated; reject anything else.
	if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(name)) return null;
	const path = join(uploadDir(), name);
	try {
		const info = await stat(path);
		return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
			headers: {
				'content-type': CONTENT_TYPES[extname(name)] ?? 'application/octet-stream',
				'content-length': String(info.size),
				'cache-control': 'private, max-age=31536000, immutable'
			}
		});
	} catch {
		return null;
	}
}
