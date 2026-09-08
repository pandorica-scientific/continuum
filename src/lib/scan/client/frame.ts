// SPDX-License-Identifier: AGPL-3.0-or-later
// The one thing the browser still does with pixels: get the photograph OUT of
// the camera.
//
// This file used to hold every canvas call in the engine — decoding a dropped
// file, applying EXIF, downscaling for detection, encoding a page. All of it
// has gone to the server, along with the memory ceilings that made it fragile
// on a phone. What is left is the viewfinder's shutter, which has to turn a
// live track into bytes because there is no other way to reach the sensor.
//
// The phone's own camera app — the path a self-hosted Continuum on plain http
// always takes — needs none of this: it hands over a File already.

/**
 * The still, at SENSOR resolution rather than the video track's.
 *
 * A video track is commonly 1080p even when the camera behind it is 12 MP, and
 * that gap is the whole margin between a legible scan of small print and a
 * blurry one. `ImageCapture` is the only way to reach it, and Safari still
 * lacks it entirely — so the video frame is the fallback, not the plan.
 *
 * Returned as a FILE, unopened. The blob `takePhoto` produces is already an
 * encoded JPEG with its EXIF intact, so handing it straight to the server means
 * the browser never decodes a 12 MP frame at all — which is the allocation that
 * failed on iOS, and it is now simply absent rather than made more careful.
 *
 * It also retires the aspect-ratio check this function used to carry. That
 * existed because corners were found on a frame the browser had decoded and
 * possibly re-oriented, so a still shaped differently from the viewfinder gave
 * a crop of somewhere else. Detection now runs server-side on these exact
 * bytes; there is nothing left to disagree.
 */
export async function stillFileFromTrack(
	track: MediaStreamTrack,
	video: HTMLVideoElement
): Promise<File> {
	const Capture = (
		globalThis as {
			ImageCapture?: new (track: MediaStreamTrack) => { takePhoto(): Promise<Blob> };
		}
	).ImageCapture;

	if (Capture) {
		try {
			const blob = await new Capture(track).takePhoto();
			if (blob.size > 0) return asFile(blob);
		} catch {
			// Some Android cameras advertise ImageCapture and then refuse
			// takePhoto while the track is live. The video frame is always there.
		}
	}
	return asFile(await frameFromVideo(video));
}

function asFile(blob: Blob): File {
	// The name carries the extension the server reads to decide how to decode,
	// and `isImageFile` is what admits it. A photograph from `takePhoto` is a
	// JPEG on every browser that implements it.
	const type = blob.type || 'image/jpeg';
	const ext = type === 'image/png' ? 'png' : 'jpg';
	return new File([blob], `scan.${ext}`, { type });
}

/**
 * The video element's current frame, encoded.
 *
 * Lower resolution than the sensor, always right: it is literally what the
 * person was looking at, so it can never disagree with what they framed.
 *
 * The canvas is released explicitly. Its backing store lives outside the
 * JavaScript heap, so dropping the reference is a promise to free it eventually
 * and nothing more — and when a browser will not give out another one it does
 * not throw, it hands back a fully TRANSPARENT image, which over the preview's
 * dark card reads as a solid black page.
 */
function frameFromVideo(video: HTMLVideoElement): Promise<Blob> {
	const canvas = document.createElement('canvas');
	canvas.width = video.videoWidth;
	canvas.height = video.videoHeight;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('This browser gave no 2D drawing context.');
	context.drawImage(video, 0, 0, canvas.width, canvas.height);

	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				canvas.width = 0;
				canvas.height = 0;
				if (blob) resolve(blob);
				else reject(new Error('That photo could not be taken.'));
			},
			'image/jpeg',
			// High, because this is the ONLY encode the photograph receives before
			// the server sees it — everything downstream works from what arrives.
			0.95
		);
	});
}
