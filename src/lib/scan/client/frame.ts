// SPDX-License-Identifier: AGPL-3.0-or-later
// The one thing the browser still does with pixels: get the photograph out of
// the camera. Everything else (decode, EXIF, downscale, encode) runs
// server-side; this just turns a live track into bytes.

/**
 * The still, at sensor resolution rather than the video track's (a track is
 * often 1080p even behind a 12 MP camera). `ImageCapture` is the only way to
 * reach it; Safari lacks it, so the video frame is the fallback.
 *
 * Returned as a File, unopened — the blob is already an encoded JPEG with EXIF
 * intact, so the browser never decodes the full frame.
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
			// Some Android cameras advertise ImageCapture but refuse takePhoto
			// while the track is live; fall back to the video frame.
		}
	}
	return asFile(await frameFromVideo(video));
}

function asFile(blob: Blob): File {
	// The extension is what the server reads to decide how to decode.
	const type = blob.type || 'image/jpeg';
	const ext = type === 'image/png' ? 'png' : 'jpg';
	return new File([blob], `scan.${ext}`, { type });
}

/**
 * The video element's current frame, encoded — lower resolution than the
 * sensor but always what the person was looking at.
 *
 * The canvas is released explicitly since its backing store lives outside the
 * JS heap; a browser that won't allocate another one returns a transparent
 * image rather than throwing, which over the dark preview reads as black.
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
			// High, since this is the only encode before the server sees it.
			0.95
		);
	});
}
