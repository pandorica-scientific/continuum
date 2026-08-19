<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import BrandMark from '$lib/components/BrandMark.svelte';
	import PasskeyButton from '$lib/components/PasskeyButton.svelte';

	let { data, form } = $props();

	let personId = $state(data.people[0]?.id ?? '');
</script>

<svelte:head><title>Continuum — sign in</title></svelte:head>

<div class="wrap">
	<div class="brand">
		<BrandMark size={26} />
		<span class="wordmark">Continuum</span>
	</div>

	{#if form?.message}
		<div class="error">{form.message}</div>
	{/if}

	{#if data.passkeys}
		<PasskeyButton />
	{/if}

	<form method="POST" class="card form">
		<div class="people">
			{#each data.people as p (p.id)}
				<button
					type="button"
					class="person"
					class:active={personId === p.id}
					onclick={() => (personId = p.id)}
				>
					<span class="avatar">{p.initials}</span>
					<span>{p.name}</span>
				</button>
			{/each}
		</div>
		<input type="hidden" name="personId" value={personId} />
		<input name="password" type="password" placeholder="Password" autocomplete="current-password" />
		<button type="submit" class="btn btn-primary">Sign in</button>
	</form>
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
		font-size: 15.5px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 18px;
	}
	.people {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.person {
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--bd);
		background: transparent;
		color: var(--fg2);
		border-radius: 8px;
		padding: 9px 11px;
		font-size: 13.5px;
		cursor: pointer;
		text-align: left;
	}
	.person.active {
		border-color: var(--bd2);
		background: var(--card2);
		color: var(--fg1);
	}
	.avatar {
		width: 26px;
		height: 26px;
		border-radius: 26px;
		background: var(--card3);
		display: grid;
		place-items: center;
		font-size: 11px;
	}
	input[name='password'] {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 9px 11px;
		font-size: 13.5px;
	}
</style>
