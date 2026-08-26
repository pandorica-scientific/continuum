// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The camera, and the four ways it can be unavailable.
//
// getUserMedia requires a secure context, so a self-hosted Continuum at
// http://192.168.1.50:3000 gets no viewfinder, ever — and it fails with the
// same DOMException as a machine with no camera at all. The states below keep
// them apart, because the recovery is completely different: one is "open it on
// your phone", the other is "your phone camera app still works, use that".

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
		// Checked before asking, so the user gets the screen that names the real
		// problem rather than a permission prompt that cannot succeed.
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
			// Torch is Chrome-on-Android only and is absent from iOS Safari
			// entirely. HIDE the control when it is missing rather than disabling
			// it, or half of users get a dead button in the one band they can
			// actually reach one-handed.
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
		/** For ImageCapture: the still comes off the TRACK, not the video element. */
		get track() {
			return track;
		},
		start,
		stop,
		setTorch
	};
}
