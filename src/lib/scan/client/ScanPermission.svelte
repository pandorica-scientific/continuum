<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import Icon from '$lib/components/Icon.svelte';

	let {
		state,
		onallow,
		onchoosefile
	}: {
		state: 'insecure' | 'absent' | 'asking' | 'denied';
		onallow: () => void;
		onchoosefile: () => void;
	} = $props();

	/**
	 * A table with an entry for EVERY state, not a lookup with three cases and a
	 * fourth that falls through. The prototype had exactly that, and reading a
	 * property off the missing entry threw out of the render function — which
	 * took the whole component down, so all four screens rendered nothing rather
	 * than one degrading.
	 */
	const SCREENS = {
		asking: {
			title: 'Use the camera to photograph this page?',
			// For a self-hosted product, the sentence that earns the tap is where
			// the image goes. Shown BEFORE the OS prompt, because a raw system
			// dialog with no context gets denied and the OS will not re-ask.
			body: 'The photo is processed on your own server and never leaves it — there is no third party here.',
			primary: 'Allow the camera'
		},
		denied: {
			title: 'Continuum cannot reach the camera',
			// Names the padlock, because that is the thing to tap.
			body: 'The browser is holding the permission. Tap the padlock in the address bar, allow the camera, then reload.',
			primary: 'Reload and try again'
		},
		absent: {
			title: 'No camera on this device',
			body: 'Nothing is wrong — this screen simply has no camera attached. Continuum on a phone will have one.',
			primary: 'Open on my phone'
		},
		insecure: {
			// The camera EXISTS; the address is not https. Telling this person to
			// open it on their phone sends them to the same plain-http address.
			title: 'The camera needs a secure connection',
			body: 'This address is plain http, and browsers only allow the camera over https. Your phone camera app still works — photograph the page with that and it comes through the same way.',
			primary: 'Use the camera app'
		}
	} as const;

	const screen = $derived(SCREENS[state]);
</script>

<div class="screen">
	<div class="art"><Icon name="camera" size={28} /></div>
	<div class="copy">
		<h2>{screen.title}</h2>
		<p>{screen.body}</p>
		<div class="actions">
			<button type="button" class="btn btn-primary" onclick={onallow}>{screen.primary}</button>
			<!-- Every state keeps this, so the task is never blocked. -->
			<button type="button" class="btn" onclick={onchoosefile}>Choose a file instead</button>
		</div>
	</div>
</div>

<style>
	/* Themed, not scrimmed: there is no camera feed behind these, so the scan
	   tokens would be painting a plate over the app's own background. */
	.screen {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		padding: var(--space-8);
		padding-top: calc(var(--safe-top) + var(--space-8));
		/* Copy anchored to the bottom, for reach. */
		padding-bottom: calc(var(--safe-bottom) + var(--space-8));
		background: var(--bg);
		color: var(--fg1);
	}
	.art {
		flex: 1;
		display: grid;
		place-items: center;
		color: var(--fg3);
	}
	.copy {
		display: grid;
		gap: var(--space-5);
		max-width: 34rem;
		width: 100%;
		margin: 0 auto;
	}
	h2 {
		margin: 0;
		font-size: var(--text-2xl);
	}
	p {
		margin: 0;
		color: var(--fg2);
	}
	.actions {
		display: grid;
		gap: var(--space-4);
	}
	.actions :global(.btn) {
		min-height: var(--touch-min);
	}
	.actions :global(.btn):focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
</style>
