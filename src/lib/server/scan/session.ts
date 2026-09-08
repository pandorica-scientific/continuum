// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A scan in progress, on disk.
 *
 * The originals are SCRATCH. They exist so the server can re-render a page at a
 * new mode or new corners without the phone uploading it again, and they are
 * deleted when the document is saved. Nothing here writes a `document` row and
 * nothing here needs a migration: a scan that is abandoned leaves files and
 * nothing else, which is the whole reason it can be swept.
 *
 * They are also the largest thing an instance would store if they were kept —
 * 2–4 MB a page against about 1 MB for a whole finished PDF — which is why
 * "keep them so an old scan can be re-cropped later" was considered and
 * declined. That feature becomes possible with this architecture; it is not
 * part of it.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import { uuidv7 } from 'uuidv7';
import { isImageFile } from '$lib/scan/core/accept';
import type { PageMode } from '$lib/scan/core/types';

/**
 * How long a session survives without being finished.
 *
 * A phone that goes flat halfway through a stack of paper otherwise leaves its
 * originals behind for ever. Two hours is far longer than any scan and far
 * shorter than "until someone notices the disk is full".
 */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * The cap on one document, as the browser has always enforced it.
 *
 * Checked here as well because the browser's copy is now advice: the endpoints
 * are reachable without it.
 */
export const MAX_PAGES = 20;

/**
 * Read per call rather than captured at module load, exactly as
 * `system/files.ts` reads `uploadDir()` — a test has to be able to point this
 * somewhere else, and a module-level constant cannot be pointed anywhere.
 */
function scanRoot(): string {
	return resolve(env.UPLOAD_DIR || 'data', 'scan');
}

/**
 * Ids reach the filesystem from a URL parameter, so they are checked before
 * they are joined to a path and not after.
 *
 * `system/files.ts` sets the precedent with `isUploadName`. A `..` that gets
 * through here is a read or a delete anywhere the server can reach.
 */
const ID = /^[0-9a-f-]{36}$/;

function checked(id: string, what: string): string {
	if (!ID.test(id)) throw new Error(`That is not a ${what}.`);
	return id;
}

export function sessionDir(sessionId: string): string {
	return join(scanRoot(), checked(sessionId, 'scan session'));
}

export async function createScanSession(): Promise<{ id: string }> {
	const id = uuidv7();
	await mkdir(sessionDir(id), { recursive: true });
	return { id };
}

/** Where a page's three files live. The original keeps the extension it arrived with. */
export function scanPagePaths(
	sessionId: string,
	pageId: string,
	ext = '.jpg'
): { sourcePath: string; previewPath: string; artefactPath: (mode: PageMode) => string } {
	const dir = join(sessionDir(sessionId), checked(pageId, 'scan page'));
	return {
		sourcePath: `${dir}-source${ext}`,
		previewPath: `${dir}-preview.png`,
		// Colour and grayscale are JPEG; black-and-white is a PNG, because it is
		// a 1-bit stream by the time it reaches the PDF and JPEG ringing around
		// black text on white is the one artefact that costs legibility.
		artefactPath: (mode: PageMode) => `${dir}-page.${mode === 'bw' ? 'png' : 'jpg'}`
	};
}

/**
 * The original's extension, as recorded when it was saved.
 *
 * Found by looking rather than by trying a list of extensions: the list of what
 * may be uploaded lives in the engine's `accept.ts` and is private to it, and a
 * second copy here would be one more thing to keep in step with a picker.
 */
export async function scanSourceExt(sessionId: string, pageId: string): Promise<string | null> {
	const dir = sessionDir(sessionId);
	if (!existsSync(dir)) return null;
	const prefix = `${checked(pageId, 'scan page')}-source`;
	const found = (await readdir(dir)).find((name) => name.startsWith(`${prefix}.`));
	return found ? found.slice(prefix.length) : null;
}

/**
 * Save one photograph into a session.
 *
 * The accepted types come from the engine's own `isImageFile` rather than a
 * list restated here: the file picker on the scan screen offers exactly what
 * this admits, and a second copy of the list would drift into refusing
 * something a picker had just offered.
 */
export async function addScanPage(
	sessionId: string,
	bytes: Uint8Array,
	filename: string
): Promise<{ pageId: string; sourcePath: string }> {
	// `type` is empty because the bytes are already off the wire and the name is
	// all that is left to judge by — which is the fallback `isImageFile` exists
	// to provide, for the Android and Safari pickers that hand over a HEIC with
	// no MIME type at all.
	if (!isImageFile({ name: filename, type: '' })) {
		throw new Error(`${extname(filename) || 'That file'} is not a photograph.`);
	}
	const dir = sessionDir(sessionId);
	await mkdir(dir, { recursive: true });

	const pageId = uuidv7();
	const ext = extname(filename).toLowerCase();
	const { sourcePath } = scanPagePaths(sessionId, pageId, ext);
	await writeFile(sourcePath, bytes);
	return { pageId, sourcePath };
}

/** How many pages this session already holds. */
export async function countScanPages(sessionId: string): Promise<number> {
	const dir = sessionDir(sessionId);
	if (!existsSync(dir)) return 0;
	const entries = await readdir(dir);
	return entries.filter((name) => name.includes('-source.')).length;
}

/** Everything this session wrote, gone. */
export async function dropScanSession(sessionId: string): Promise<void> {
	await rm(sessionDir(sessionId), { recursive: true, force: true });
}

/**
 * Delete the sessions nobody came back to.
 *
 * Hung off the same five-minute tick that drains the CPU queue. Required, not
 * housekeeping: without it an abandoned scan is 60 MB that nothing will ever
 * remove.
 */
export async function sweepScanSessions(olderThanMs = SESSION_TTL_MS): Promise<number> {
	const root = scanRoot();
	if (!existsSync(root)) return 0;

	const cutoff = Date.now() - olderThanMs;
	let removed = 0;
	for (const name of await readdir(root)) {
		if (!ID.test(name)) continue;
		const path = join(root, name);
		const info = await stat(path).catch(() => null);
		// The directory's own mtime moves whenever a page is added to it, so a
		// scan still being taken is never swept out from under the person taking
		// it, however long they spend on it.
		if (!info?.isDirectory() || info.mtimeMs > cutoff) continue;
		await rm(path, { recursive: true, force: true });
		removed++;
	}
	return removed;
}
