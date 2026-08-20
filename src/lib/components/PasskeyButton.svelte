<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { goto } from '$app/navigation';
	import { startAuthentication } from '@simplewebauthn/browser';
	import { runCeremony } from '$lib/webauthn';

	let error = $state('');
	let busy = $state(false);

	async function signIn() {
		error = '';
		busy = true;
		const result = await runCeremony(
			'/auth/passkey/login/options',
			'/auth/passkey/login/verify',
			startAuthentication,
			// Sign-in posts nothing beyond the assertion itself.
			() => ({}),
			'Passkey sign-in failed.'
		);
		busy = false;
		if (result.ok) await goto('/overview');
		else error = result.error;
	}
</script>

<button type="button" class="btn passkey" onclick={signIn} disabled={busy}>
	{busy ? 'Waiting for your passkey…' : '🔑 Sign in with a passkey'}
</button>
{#if error}<div class="error">{error}</div>{/if}

<style>
	.passkey {
		width: 100%;
	}
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: var(--text-md);
	}
</style>
