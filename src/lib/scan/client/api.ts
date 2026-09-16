// SPDX-License-Identifier: AGPL-3.0-or-later
// The six calls the scan screens make.
//
// `/scan`, not `/api/scan`: that prefix is a bearer-token boundary for external
// clients, and these are session-cookie requests from the app's own pages.
//
// Nothing here touches a pixel — decode, detection, warp and encode all happen
// server-side.

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

/** The server's message rather than a status code — written to be read. */
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
	// SvelteKit's `error()` replies with `{ message }`. Anything else (a proxy's
	// HTML page, an empty body) falls back rather than being quoted.
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
	// `lines` defaults to empty: a photograph with no detected page has none.
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

/** Where the current preview is. The path is stable; `token` busts the cache after a render. */
export function previewUrl(sessionId: string, pageId: string, token: number): string {
	return `/scan/page/${pageId}/preview?session=${sessionId}&v=${token}`;
}

/**
 * The uncropped original, downscaled, from the server.
 *
 * Fallback for the corner screen when the phone's own copy is gone (a kept
 * page) or undecodable (HEIC). Downscale size is the server's to choose; handle
 * positions are in frame coordinates via SVG viewBox, so resolution is a
 * sharpness question, not a correctness one.
 */
export function originalUrl(sessionId: string, pageId: string): string {
	return `/scan/page/${pageId}/original?session=${sessionId}`;
}

/**
 * One kept page, as a picture — for things that want the corner editor and
 * de-skew but aren't documents (a label, a meter dial) and would be ruined by
 * being thresholded into a PDF.
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
 * Give up on a scan. `keepalive` so it still fires as the screen closes;
 * failures are unreported since the sweep would reach the session anyway.
 */
export function dropScanSession(sessionId: string): void {
	void fetch(`/scan/session/${sessionId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}

/**
 * Give up on one page, with the scan carrying on. Sent when a photograph is
 * retaken, so the rejected original doesn't linger in the same session.
 */
export function dropScanPage(sessionId: string, pageId: string): void {
	void fetch(`/scan/page/${pageId}?session=${sessionId}`, {
		method: 'DELETE',
		keepalive: true
	}).catch(() => {});
}
