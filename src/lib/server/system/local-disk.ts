// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The default storage driver: the data volume.
 *
 * `/data` in Docker, `./data` in development. Every read swallows its error
 * and answers null, because a document whose upload has been lost still exists
 * as a record and the screens have to say so rather than throw.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { env } from '$env/dynamic/private';
import type { StorageDriver } from './storage';

function uploadDir(): string {
	return env.UPLOAD_DIR || 'data';
}

export const localDisk: StorageDriver = {
	id: 'local-disk',

	async put(name, bytes) {
		await mkdir(uploadDir(), { recursive: true });
		await writeFile(join(uploadDir(), name), bytes);
	},

	async get(name) {
		try {
			return new Uint8Array(await readFile(join(uploadDir(), name)));
		} catch {
			return null;
		}
	},

	async size(name) {
		try {
			return (await stat(join(uploadDir(), name))).size;
		} catch {
			return null;
		}
	},

	async remove(name) {
		try {
			await unlink(join(uploadDir(), name));
			return true;
		} catch {
			return false;
		}
	},

	async open(name) {
		const path = join(uploadDir(), name);
		try {
			const info = await stat(path);
			return {
				stream: Readable.toWeb(createReadStream(path)) as ReadableStream,
				size: info.size
			};
		} catch {
			return null;
		}
	}
};
