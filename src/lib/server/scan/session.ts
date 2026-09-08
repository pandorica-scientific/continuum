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

/**
 * Whether an id is one of ours, for a caller that wants to ANSWER rather than
 * throw.
 *
 * `checked` below is the guard and stays one: it throws, unconditionally, at
 * the moment an id meets a path. But a thrown `Error` reaches SvelteKit as a
 * 500 with a stack trace in the log, which is the wrong answer for someone
 * following a stale link — that is a 400. The routes ask this first and reply
 * properly; the guard is still there behind them.
 */
export function isScanId(id: string): boolean {
	return ID.test(id);
}

function checked(id: string, what: string): string {
	if (!isScanId(id)) throw new Error(`That is not a ${what}.`);
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

/** Where a page's files live. The original keeps the extension it arrived with. */
export function scanPagePaths(
	sessionId: string,
	pageId: string,
	ext = '.jpg'
): {
	sourcePath: string;
	previewPath: string;
	originalPath: string;
	artefactPath: (mode: PageMode) => string;
} {
	const dir = join(sessionDir(sessionId), checked(pageId, 'scan page'));
	return {
		sourcePath: `${dir}-source${ext}`,
		previewPath: `${dir}-preview.png`,
		// The uncropped photograph at screen size, for the corner editor. Written
		// once and reused: it is a downscale of a file that never changes, so the
		// second visit to that screen costs a read rather than a decode.
		originalPath: `${dir}-original.jpg`,
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

/**
 * How many pages this session would put in a document.
 *
 * KEPT pages, counted by their artefacts, and deliberately not uploads. Every
 * upload writes a source whether or not the page survives it, so counting those
 * counted retakes: someone who photographed six pages twice hit "a document
 * holds at most 20 pages" at twenty shutter presses, while the review screen in
 * front of them showed fourteen and the browser's own cap still said there was
 * room. The cap is a statement about the document, so it is measured on what
 * the document will contain.
 *
 * By page id rather than by file, because the two modes write different
 * extensions and a page kept twice would otherwise count twice.
 */
export async function countScanPages(sessionId: string): Promise<number> {
	const dir = sessionDir(sessionId);
	if (!existsSync(dir)) return 0;
	return keptIn(await readdir(dir)).size;
}

/** The page ids with an artefact among these filenames. */
function keptIn(names: string[]): Set<string> {
	const kept = new Set<string>();
	for (const name of names) {
		const at = name.indexOf('-page.');
		if (at > 0) kept.add(name.slice(0, at));
	}
	return kept;
}

/**
 * Sources nobody kept and nobody is looking at, gone.
 *
 * ONE PAGE IS IN FLIGHT AT A TIME. The screen photographs a page, inspects it,
 * and either keeps it or retakes it before the next photograph — there is no
 * path through it that has two unkept pages at once, and a retake says so with
 * a `DELETE`. So a source with no artefact beside it, at the moment a NEW
 * photograph arrives, is one whose `DELETE` never landed: a tab closed on the
 * corner screen, a phone that lost the network on the way out.
 *
 * Without this the count of them was unbounded. The page cap counts kept pages
 * — correctly, since it is a statement about the document — so a client that
 * never said goodbye could add originals to a session all afternoon while its
 * page count stayed at zero. Now a session holds what it kept, plus the one
 * being looked at.
 */
export async function dropUnkeptScanPages(sessionId: string): Promise<number> {
	const dir = sessionDir(sessionId);
	if (!existsSync(dir)) return 0;

	const names = await readdir(dir);
	const kept = keptIn(names);
	const stale = new Set<string>();
	for (const name of names) {
		const at = name.indexOf('-source.');
		if (at > 0 && !kept.has(name.slice(0, at))) stale.add(name.slice(0, at));
	}

	for (const pageId of stale) await dropScanPage(sessionId, pageId);
	return stale.size;
}

/** Everything this session wrote, gone. */
export async function dropScanSession(sessionId: string): Promise<void> {
	await rm(sessionDir(sessionId), { recursive: true, force: true });
}

/**
 * One page's files, gone, while the session carries on.
 *
 * A retake uploads a NEW page into the same session and leaves the old one
 * behind — and the old one is the 2–4 MB original, not the preview. Nothing
 * asked for it again, so it sat there until the document was made. The client
 * says so at the moment it discards the page.
 */
export async function dropScanPage(sessionId: string, pageId: string): Promise<void> {
	const dir = sessionDir(sessionId);
	if (!existsSync(dir)) return;
	const prefix = `${checked(pageId, 'scan page')}-`;
	for (const name of await readdir(dir)) {
		if (name.startsWith(prefix)) await rm(join(dir, name), { force: true });
	}
}

/**
 * Leave exactly one artefact behind for a page.
 *
 * Black-and-white writes a PNG and every other mode a JPEG, so keeping a page
 * twice at two different modes leaves TWO files. `document/+server.ts` reads
 * whichever exists and tests the PNG first, so the second keep would be the one
 * ignored — the document would carry the mode the person changed their mind
 * about. Deleting the other one makes "whichever exists" a statement about one
 * file.
 */
export async function dropOtherArtefact(
	sessionId: string,
	pageId: string,
	mode: PageMode
): Promise<void> {
	const { artefactPath } = scanPagePaths(sessionId, pageId);
	await rm(artefactPath(mode === 'bw' ? 'color' : 'bw'), { force: true });
}

/**
 * When this session was last worked on.
 *
 * The DIRECTORY's own mtime is not that, and reading it as though it were is
 * how a scan gets swept out from under the person taking it. A directory's
 * mtime moves when an entry is added, removed or renamed — so keeping a page
 * moves it, and re-rendering one does NOT: a mode tap and a corner drag both
 * overwrite files that already exist. Someone who spends two hours on a single
 * difficult page, changing modes and dragging corners the whole time, touches
 * the directory once at the start and never again.
 *
 * So the newest mtime of anything inside it, which every render moves.
 */
async function lastWorkedOn(path: string, own: number): Promise<number> {
	let newest = own;
	for (const name of await readdir(path).catch(() => [])) {
		const info = await stat(join(path, name)).catch(() => null);
		if (info) newest = Math.max(newest, info.mtimeMs);
	}
	return newest;
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
		if (!info?.isDirectory()) continue;
		if ((await lastWorkedOn(path, info.mtimeMs)) > cutoff) continue;
		await rm(path, { recursive: true, force: true });
		removed++;
	}
	return removed;
}
