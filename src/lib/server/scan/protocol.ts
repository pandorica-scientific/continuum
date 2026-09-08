// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What crosses the process boundary.
 *
 * PATHS AND JSON ONLY. A 12 MP frame is 48 MB of pixels; sending that through
 * IPC would serialise it, copy it, and defeat the reason the child exists at
 * all. So the child reads its input from disk and writes its output there, and
 * the message carries names.
 */
import type { Line, Outline, PageMode, Rotation } from '$lib/scan/core/types';

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

/**
 * The uncropped photograph, for the corner screen's fallback.
 *
 * A third op rather than a decode in the route, because the decode is the
 * expensive and memory-permanent part: HEIC goes through libheif, whose heap
 * never shrinks, and the child exists so that heap can be thrown away. It also
 * puts this behind the same one-at-a-time queue as everything else, so two
 * people opening the corner screen no longer decode two photographs at once.
 */
export interface OriginalRequest {
	id: string;
	op: 'original';
	sourcePath: string;
	/** Where to write the downscaled JPEG. */
	outPath: string;
	/** The widest it may come back. */
	width: number;
}

export type ScanRequest = DetectRequest | RenderRequest | OriginalRequest;

/**
 * A request before the supervisor stamps an id on it.
 *
 * Written as a union of omits rather than `Omit<ScanRequest, 'id'>`, which does
 * NOT distribute: applied to a union it keeps only the keys every member
 * shares, so `outPath`, `outline` and `mode` all quietly vanish and a render
 * request stops type-checking against the very type that describes it.
 */
export type PendingScanRequest =
	Omit<DetectRequest, 'id'> | Omit<RenderRequest, 'id'> | Omit<OriginalRequest, 'id'>;

export type ScanReply =
	| {
			id: string;
			ok: true;
			outline: Outline | null;
			/**
			 * The straight edges the detector fitted in this photograph.
			 *
			 * For the corner screen, which snaps a dragged handle onto them. In the
			 * SOURCE's pixels like the outline, and empty on anything but a detect:
			 * a render is told where the page is, it does not go looking.
			 */
			lines: Line[];
			width: number;
			height: number;
	  }
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
