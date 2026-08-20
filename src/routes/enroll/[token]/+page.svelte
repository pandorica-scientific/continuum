<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import BrandMark from '$lib/components/BrandMark.svelte';
	import { passwordHint } from '$lib/password-policy';

	let { data, form } = $props();
</script>

<svelte:head><title>Continuum — set your password</title></svelte:head>

<div class="wrap">
	<div class="brand">
		<BrandMark size={26} />
		<span class="wordmark">Continuum</span>
	</div>

	{#if form?.message}
		<div class="error">{form.message}</div>
	{/if}

	{#if data.valid}
		<form method="POST" class="card form">
			<p class="lead">Welcome, {data.name}. Choose a password to finish setting up your account.</p>
			<input
				name="password"
				type="password"
				placeholder={`Password (${passwordHint(data.passwordMinLength)})`}
				autocomplete="new-password"
			/>
			<input
				name="confirmPassword"
				type="password"
				placeholder="Repeat password"
				autocomplete="new-password"
			/>
			<button type="submit" class="btn btn-primary">Set password</button>
			{#if data.passkeys}
				<p class="lead">
					Once you are in, add a passkey from Settings to sign in with your face or fingerprint
					instead.
				</p>
			{/if}
		</form>
	{:else}
		<div class="error">This link is not valid. Ask whoever invited you for a new one.</div>
	{/if}
</div>

<style>
	.wrap {
		max-width: 380px;
		margin: 0 auto;
		padding: 90px 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.wordmark {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 18px;
	}
	.lead {
		font-size: var(--text-md);
		color: var(--fg2);
		margin: 0;
	}
	input {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 9px 11px;
		font-size: var(--text-md);
	}
</style>
