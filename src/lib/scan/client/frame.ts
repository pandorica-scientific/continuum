// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every canvas call in the engine, in one file.
//
// `core` is canvas-free so that its arithmetic can be tested without a DOM;
// this is where that boundary gets paid for. A plain <canvas> rather than an
// OffscreenCanvas: 2D OffscreenCanvas only reached Safari in 16.4, and nothing
// here runs off the main thread, so the newer API buys a version cliff and no
// capability.

import {
	DETECT_WIDTH,
	applyOrientation,
	looksLikeHeic,
	needsRotation,
	readOrientation,
	readStoredSize,
	type Frame
} from '../core/index.ts';

function scratch(width: number, height: number) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('This browser gave no 2D drawing context.');
	return { canvas, context };
}

function draw(source: CanvasImageSource, width: number, height: number): Frame {
	const { context } = scratch(width, height);
	context.drawImage(source, 0, 0, width, height);
	const { data } = context.getImageData(0, 0, width, height);
	return { data, width, height };
}

/**
 * The widest source the pipeline will work from.
 *
 * Output is clamped to 2480 px (A4 at 300 DPI), so anything past this is thrown
 * away by the warp anyway — but it is not free on the way there. Recent phones
 * shoot 48 MP: 8064 x 6048 is 195 MB as RGBA, four times what the design
 * assumed, and `renderPage` holds several Mats derived from it at once. Capping
 * here costs nothing visible and takes the peak from ~195 MB to ~30 MB.
 */
const MAX_CAPTURE_WIDTH = 3200;

/**
 * How far a still's aspect ratio may differ from the preview's before it is
 * treated as a different picture rather than the same one.
 *
 * Generous, because a sensor's still is often cropped slightly differently from
 * its video track; far tighter than the 33% gap between 4:3 and 3:4, which is
 * the failure this catches.
 */
const ASPECT_AGREEMENT = 0.15;

/** Fit to a target width, never scaling UP — enlarging invents detail. */
function fit(width: number, height: number, target?: number) {
	if (!target || width <= target) return { width, height };
	return { width: target, height: Math.max(1, Math.round((height * target) / width)) };
}

export function frameFromVideo(video: HTMLVideoElement, targetWidth = DETECT_WIDTH): Frame {
	const { width, height } = fit(video.videoWidth, video.videoHeight, targetWidth);
	return draw(video, width, height);
}

/**
 * Rescale a frame we already hold. Used to measure a full-resolution still at a
 * detection-friendly width without decoding anything twice.
 */
export function frameFromBitmapSource(frame: Frame, targetWidth: number): Frame {
	const { width, height } = fit(frame.width, frame.height, targetWidth);
	if (width === frame.width && height === frame.height) return frame;
	const { canvas, context } = scratch(frame.width, frame.height);
	context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
	return draw(canvas, width, height);
}

export function frameFromBitmap(bitmap: ImageBitmap, targetWidth?: number): Frame {
	const { width, height } = fit(bitmap.width, bitmap.height, targetWidth);
	return draw(bitmap, width, height);
}

/**
 * The still, at SENSOR resolution rather than the video track's.
 *
 * A video track is commonly 1080p even when the camera behind it is 12 MP, and
 * that gap is the whole margin between a legible scan of small print and a
 * blurry one. `ImageCapture` is the only way to reach it, and Safari still
 * lacks it entirely — so the video frame is the fallback, not the plan.
 */
export async function stillFromTrack(
	track: MediaStreamTrack,
	video: HTMLVideoElement
): Promise<Frame> {
	const Capture = (
		globalThis as {
			ImageCapture?: new (track: MediaStreamTrack) => { takePhoto(): Promise<Blob> };
		}
	).ImageCapture;

	if (Capture) {
		try {
			const blob = await new Capture(track).takePhoto();
			// `from-image` explicitly. The default has changed across versions of
			// the specification and browsers disagree, so leaving it unsaid means
			// a photo carrying an EXIF rotation may or may not be turned — and a
			// phone writes a DIFFERENT rotation depending on how it was held. That
			// is why this failed in landscape and not in portrait.
			const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
			const still = frameFromBitmap(bitmap, MAX_CAPTURE_WIDTH);
			bitmap.close();

			// Whatever the still says, it has to agree with the picture the user
			// was framing. If ImageCapture hands back the sensor's own orientation
			// the aspect ratio comes out inverted, and every corner found on it
			// describes a region of a differently-shaped image — a crop of
			// somewhere else entirely.
			const framed = video.videoWidth / video.videoHeight;
			const captured = still.width / still.height;
			if (framed > 0 && Math.abs(captured - framed) / framed <= ASPECT_AGREEMENT) {
				return still;
			}
		} catch {
			// Some Android cameras advertise ImageCapture and then refuse
			// takePhoto while the track is live. The video frame is always there.
		}
	}
	// The video element is what the user was actually looking at, so it can
	// never disagree with what they framed. Lower resolution, always right.
	return frameFromVideo(video, Math.min(video.videoWidth, MAX_CAPTURE_WIDTH));
}

/**
 * A dropped or photographed file, decoded and turned the right way up.
 *
 * EXIF is applied here rather than left to the caller because canvas
 * `drawImage` ignores it, so every portrait photo from certain Androids would
 * otherwise land sideways — including in `original` mode, where rotation is the
 * only processing there is.
 */
export async function frameFromFile(file: File): Promise<Frame> {
	const bytes = new Uint8Array(await file.arrayBuffer());

	// Try the browser first: Safari decodes HEIC natively, and avoiding 1.5 MB
	// of WASM when it is not needed is most of the win here.
	//
	// `none` explicitly, because the rotation is applied below and doing it
	// twice is worse than not doing it at all. Chrome now defaults to
	// `from-image`, so leaving this unsaid meant a portrait photo was turned by
	// the browser and then turned again here — arriving in landscape, which is
	// precisely what a double rotation looks like.
	const bitmap = await createImageBitmap(file, { imageOrientation: 'none' }).catch(() => null);

	if (!bitmap) {
		if (!looksLikeHeic(bytes, file.name)) throw new Error('That image could not be read.');
		const { decodeHeic } = await import('./heic-decode.ts');
		return applyOrientation(await decodeHeic(bytes), readOrientation(bytes));
	}

	const frame = frameFromBitmap(bitmap, MAX_CAPTURE_WIDTH);
	// Freed immediately: a 12 MP bitmap is ~48 MB, and holding one per dropped
	// file is how a ten-image drop kills the tab.
	bitmap.close();
	return orientUpright(frame, bytes);
}

/**
 * Apply the EXIF rotation, but only if the decoder has not already done it.
 *
 * Chrome applies it to `createImageBitmap` whatever `imageOrientation` asks —
 * measured against a real iPhone JPEG, `'none'`, `'from-image'` and the default
 * all return the same rotated bitmap — while other decoders may not. Rotating a
 * second time lays an upright page on its side, and that looks so much like
 * "the rotation was not applied" that it invites the same wrong fix twice.
 *
 * So this does not guess. It compares what came out of the decoder against the
 * dimensions stored in the file: if they are transposed, the turn has happened
 * already.
 */
function orientUpright(frame: Frame, bytes: Uint8Array): Frame {
	const orientation = readOrientation(bytes);
	if (!needsRotation(orientation, frame, readStoredSize(bytes))) return frame;
	return applyOrientation(frame, orientation);
}

export function frameToBlob(frame: Frame, type = 'image/jpeg', quality = 0.85): Promise<Blob> {
	const { canvas, context } = scratch(frame.width, frame.height);
	context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('The page could not be encoded.'))),
			type,
			quality
		);
	});
}

export async function encodeJpeg(frame: Frame, quality = 0.85): Promise<Uint8Array> {
	return new Uint8Array(await (await frameToBlob(frame, 'image/jpeg', quality)).arrayBuffer());
}
