// SPDX-License-Identifier: AGPL-3.0-or-later
// The camera, and the four ways it can be unavailable.
//
// getUserMedia requires a secure context, so an insecure host gets no
// viewfinder and fails with the same DOMException as no camera at all. The
// states below keep the two apart since their recovery differs: one needs a
// different origin, the other needs the phone's own camera app.

export type CameraState =
	| { kind: 'idle' }
	| { kind: 'insecure' }
	| { kind: 'absent' }
	| { kind: 'asking' }
	| { kind: 'denied' }
	| { kind: 'live'; stream: MediaStream; torch: boolean };

/**
 * Mirrors the browsers' own "potentially trustworthy origin" rule, which is
 * what getUserMedia actually gates on.
 */
export function isSecureForCamera(location: { protocol: string; hostname: string }): boolean {
	if (location.protocol === 'https:') return true;
	const host = location.hostname;
	return (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host === '127.0.0.1' ||
		host === '::1' ||
		host === '[::1]'
	);
}

export function createCamera() {
	let state = $state<CameraState>({ kind: 'idle' });
	let track: MediaStreamTrack | null = null;

	async function start() {
		// Checked before asking, so the user sees the real problem rather than a
		// permission prompt that cannot succeed.
		if (!isSecureForCamera(window.location)) {
			state = { kind: 'insecure' };
			return;
		}
		if (!navigator.mediaDevices?.getUserMedia) {
			state = { kind: 'absent' };
			return;
		}

		state = { kind: 'asking' };
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: { ideal: 'environment' },
					width: { ideal: 3840 },
					height: { ideal: 2160 }
				}
			});
			track = stream.getVideoTracks()[0] ?? null;
			// Torch is Chrome-on-Android only. Hide the control rather than disable
			// it, so it isn't a dead button on iOS Safari.
			const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
			state = { kind: 'live', stream, torch: capabilities?.torch === true };
		} catch (error) {
			const name = (error as DOMException)?.name;
			state =
				name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError'
					? { kind: 'absent' }
					: { kind: 'denied' };
		}
	}

	function stop() {
		if (state.kind === 'live') for (const t of state.stream.getTracks()) t.stop();
		track = null;
		state = { kind: 'idle' };
	}

	async function setTorch(on: boolean) {
		if (!track || state.kind !== 'live' || !state.torch) return;
		await track.applyConstraints({
			advanced: [{ torch: on } as unknown as MediaTrackConstraintSet]
		});
	}

	return {
		get state() {
			return state;
		},
		/** For ImageCapture: the still comes off the track, not the video element. */
		get track() {
			return track;
		},
		start,
		stop,
		setTorch
	};
}
