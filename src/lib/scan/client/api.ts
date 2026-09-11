// SPDX-License-Identifier: AGPL-3.0-or-later
// The six calls the scan screens make.
//
// `/scan`, not `/api/scan`: that prefix is a bearer-token boundary for external
// clients, and these are session-cookie requests from the app's own pages.
//
// Nothing here touches a pixel. That is the point of the release — the browser
// carries the photograph it took and displays what comes back, and every
// decode, detection, warp and encode happens in a process with no memory
// ceiling to hit.

import type { Line, Outline, PageMode, Rotation } from '../core/types.ts';

export interface UploadedPage {
	sessionId: string;
	pageId: string;
	/** The page boundary, which may carry curved edges. Null when none was found. */
	outline: Outline | null;
	/** The straight edges the detector fitted, for the corner screen to snap to. */
	lines: Line[];
	width: number;
	height: number;
}

/**
 * The server's message, rather than a status code, because it is written to be
 * read: "The scanner could not start, most likely short of memory on the
 * server" tells someone what happened, and 500 does not.
 */
function readMessage(body: string): string {
	try {
		return (JSON.parse(body) as { message?: string }).message ?? '';
	} catch {
		return '';
	}
}

async function orThrow(response: Response, fallback: string): Promise<Response> {
	if (response.ok) return response;
	const said = await response.text().catch(() => '');
	// SvelteKit's `error()` replies with `{ message }`. Anything else — a proxy's
	// HTML page, an empty body — is not ours to read, and the fallback says
	// something true instead of quoting it.
	const message = readMessage(said);
	throw new Error(message || fallback);
}

/** Send one photograph. Starts a session when there is not one yet. */
export async function uploadScanPage(file: File, sessionId: string | null): Promise<UploadedPage> {
	const form = new FormData();
	form.set('file', file);
	if (sessionId) form.set('sessionId', sessionId);
	const response = await orThrow(
		await fetch('/scan/page', { method: 'POST', body: form }),
		'That photo could not be read.'
	);
	// `lines` is filled in rather than required of the wire: a photograph the
	// detector found nothing in has none, and a page that arrives without the
	// field should open a corner screen that snaps to nothing rather than one
	// that cannot read its own props.
	const page = (await response.json()) as Omit<UploadedPage, 'lines'> & { lines?: Line[] };
	return { ...page, lines: page.lines ?? [] };
}

export interface PageState {
	sessionId: string;
	pageId: string;
	mode: PageMode;
	outline: Outline | null;
	rotation: Rotation;
}

const asJson = (body: unknown) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
});

/** Re-render at a new mode, corners or rotation, and leave a fresh preview behind. */
export async function renderScanPage(state: PageState): Promise<void> {
	await orThrow(
		await fetch(`/scan/page/${state.pageId}/render`, asJson(state)),
		'That page could not be processed.'
	);
}

/** Commit the page as it stands. The one full-resolution render. */
export async function keepScanPage(state: PageState): Promise<void> {
	await orThrow(
		await fetch(`/scan/page/${state.pageId}/keep`, asJson(state)),
		'That page could not be kept.'
	);
}

/**
 * Where the current preview is.
 *
 * The path is stable and its contents are rewritten by every render, so the
 * token is what makes the browser fetch the new one rather than show the last.
 */
export function previewUrl(sessionId: string, pageId: string, token: number): string {
	return `/scan/page/${pageId}/preview?session=${sessionId}&v=${token}`;
}

/**
 * The uncropped original, downscaled, from the server.
 *
 * The fallback for the corner screen: normally it draws on the phone's own copy
 * of the photograph, which costs no network at all. This is for the page that
 * was already kept — whose copy the phone released — and for a HEIC the browser
 * will not decode.
 *
 * The size is the server's to choose. It renders one downscale per page and
 * reuses it, and the handles are placed in the frame's own coordinates through
 * an SVG viewBox, so how many pixels arrive is a question of sharpness rather
 * than of correctness.
 */
export function originalUrl(sessionId: string, pageId: string): string {
	return `/scan/page/${pageId}/original?session=${sessionId}`;
}

/**
 * One kept page, as a picture.
 *
 * The other ending to the same journey: a label, a meter dial, the back of a
 * card — things that want the corner editor and the de-skew but are pictures
 * rather than documents, and would be ruined by being thresholded into a PDF.
 */
export async function scanPageImage(
	sessionId: string,
	pageId: string,
	filename: string
): Promise<File> {
	const response = await orThrow(
		await fetch(`/scan/page/${pageId}/image?session=${sessionId}`),
		'That picture could not be read back.'
	);
	const type = response.headers.get('content-type') ?? 'image/jpeg';
	const bytes = await response.arrayBuffer();
	const ext = type === 'image/png' ? 'png' : 'jpg';
	return new File([bytes], `${filename}.${ext}`, { type });
}

/** The kept pages, in the order shown, as one PDF. */
export async function assembleScanDocument(
	sessionId: string,
	pageIds: string[],
	filename: string
): Promise<File> {
	const response = await orThrow(
		await fetch('/scan/document', asJson({ sessionId, pageIds, filename })),
		'That PDF could not be built.'
	);
	const bytes = await response.arrayBuffer();
	return new File([bytes], `${filename}.pdf`, { type: 'application/pdf' });
}

/**
 * Give up on a scan.
 *
 * `keepalive` so it still goes when the screen is closing, which is exactly
 * when it is sent. The sweep would reach the session in two hours anyway, so a
 * failure here costs nothing and is deliberately not reported.
 */
export function dropScanSession(sessionId: string): void {
	void fetch(`/scan/session/${sessionId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}

/**
 * Give up on one page, with the scan carrying on.
 *
 * Sent when a photograph is retaken. The new one goes into the SAME session, so
 * without this the rejected original stays there — 2–4 MB of it, times however
 * many attempts a difficult page took. Fire-and-forget for the same reason as
 * above: the session's own end sweeps up whatever this missed.
 */
export function dropScanPage(sessionId: string, pageId: string): void {
	void fetch(`/scan/page/${pageId}?session=${sessionId}`, {
		method: 'DELETE',
		keepalive: true
	}).catch(() => {});
}
