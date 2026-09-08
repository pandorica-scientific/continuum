// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What crosses the process boundary.
 *
 * PATHS AND JSON ONLY. A 12 MP frame is 48 MB of pixels; sending that through
 * IPC would serialise it, copy it, and defeat the reason the child exists at
 * all. So the child reads its input from disk and writes its output there, and
 * the message carries names.
 */
import type { Outline, PageMode, Rotation } from '$lib/scan/core/types';

export interface DetectRequest {
	id: string;
	op: 'detect';
	/** The uploaded photograph, as saved. */
	sourcePath: string;
	/** Where to write the preview the phone will show. */
	previewPath: string;
	previewWidth: number;
}

export interface RenderRequest {
	id: string;
	op: 'render';
	sourcePath: string;
	/** Where to write the full-resolution artefact. Null for a preview-only run. */
	outPath: string | null;
	/** Where to write the preview. Null when only the artefact is wanted. */
	previewPath: string | null;
	/** The page boundary, which may carry curved edges. Null when none was found. */
	outline: Outline | null;
	mode: PageMode;
	rotation: Rotation;
	/**
	 * Render at the source's own resolution rather than a draft of it.
	 *
	 * True when the page is being KEPT, and for black-and-white previews.
	 * Thresholding is the one operation whose RESULT changes with resolution, so
	 * a draft preview of it would have someone approving a page other than the
	 * one they get. Colour and grayscale previews come from the draft, where the
	 * 1.5-second flat-field blur is not worth paying to show a picture that
	 * downscales honestly anyway.
	 */
	full: boolean;
	previewWidth: number;
}

export type ScanRequest = DetectRequest | RenderRequest;

/**
 * A request before the supervisor stamps an id on it.
 *
 * Written as a union of two omits rather than `Omit<ScanRequest, 'id'>`, which
 * does NOT distribute: applied to a union it keeps only the keys both members
 * share, so `outPath`, `corners` and `mode` all quietly vanish and a render
 * request stops type-checking against the very type that describes it.
 */
export type PendingScanRequest = Omit<DetectRequest, 'id'> | Omit<RenderRequest, 'id'>;

export type ScanReply =
	| { id: string; ok: true; outline: Outline | null; width: number; height: number }
	| { id: string; ok: false; error: string };

/**
 * The width a draft is built at.
 *
 * Carried over unchanged from the browser's own `PREVIEW_WIDTH`, where it was
 * chosen because switching mode at capture resolution "is wasted work and it is
 * felt". Moving the work to a server does not make that untrue; it only moves
 * who feels it.
 */
export const DRAFT_WIDTH = 1400;
