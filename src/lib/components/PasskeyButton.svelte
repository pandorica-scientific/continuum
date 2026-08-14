<script lang="ts">
	import { goto } from '$app/navigation';
	import { startAuthentication } from '@simplewebauthn/browser';

	let error = $state('');
	let busy = $state(false);

	async function signIn() {
		error = '';
		busy = true;
		try {
			const options = await (await fetch('/auth/passkey/login/options', { method: 'POST' })).json();
			const response = await startAuthentication({ optionsJSON: options });
			const verify = await fetch('/auth/passkey/login/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ response })
			});
			if (!verify.ok) throw new Error('That passkey was not accepted.');
			await goto('/overview');
		} catch (err) {
			// Cancelling the system prompt is a deliberate act, not a failure, so
			// it must not paint the screen red.
			const name = (err as { name?: string }).name;
			if (name !== 'NotAllowedError' && name !== 'AbortError') {
				error = err instanceof Error ? err.message : 'Passkey sign-in failed.';
			}
		} finally {
			busy = false;
		}
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
		font-size: 13px;
	}
</style>
