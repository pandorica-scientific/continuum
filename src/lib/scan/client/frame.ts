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
	readOrientation,
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

/** Fit to a target width, never scaling UP — enlarging invents detail. */
function fit(width: number, height: number, target?: number) {
	if (!target || width <= target) return { width, height };
	return { width: target, height: Math.max(1, Math.round((height * target) / width)) };
}

export function frameFromVideo(video: HTMLVideoElement, targetWidth = DETECT_WIDTH): Frame {
	const { width, height } = fit(video.videoWidth, video.videoHeight, targetWidth);
	return draw(video, width, height);
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
			const bitmap = await createImageBitmap(blob);
			const frame = frameFromBitmap(bitmap);
			bitmap.close();
			return frame;
		} catch {
			// Some Android cameras advertise ImageCapture and then refuse
			// takePhoto while the track is live. The video frame is always there.
		}
	}
	return frameFromVideo(video, video.videoWidth);
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
	const bitmap = await createImageBitmap(file).catch(() => null);

	if (!bitmap) {
		if (!looksLikeHeic(bytes, file.name)) throw new Error('That image could not be read.');
		const { decodeHeic } = await import('./heic-decode.ts');
		return applyOrientation(await decodeHeic(bytes), readOrientation(bytes));
	}

	const frame = frameFromBitmap(bitmap);
	// Freed immediately: a 12 MP bitmap is ~48 MB, and holding one per dropped
	// file is how a ten-image drop kills the tab.
	bitmap.close();
	return applyOrientation(frame, readOrientation(bytes));
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
