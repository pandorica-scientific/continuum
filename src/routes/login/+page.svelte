<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { untrack } from 'svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import PasskeyButton from '$lib/components/PasskeyButton.svelte';

	let { data, form } = $props();

	// The first person is only where the field starts. Read once: a re-render
	// must not pull the choice back after someone has picked the other one.
	let personId = $state(untrack(() => data.people[0]?.id ?? ''));
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
	{:else if data.passkeyWorksAt}
		<!-- A passkey is bound to one address. Silence here read as "this build has
		     no passkeys"; naming the address that works turns a dead end into a
		     next step. -->
		<p class="passkey-note">
			Passkeys work at <code>{data.passkeyWorksAt}</code> — sign in with a password here.
		</p>
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
		{#if data.openMode}
			<!-- No credential is being asked for, so no field is shown. Saying so
			     plainly matters: a sign-in box that simply lets you in is otherwise
			     indistinguishable from one that is broken. -->
			<p class="open-note">
				This instance is open — anyone who can reach it can sign in as anyone. Turn that off in
				Settings.
			</p>
		{:else}
			<input
				name="password"
				type="password"
				placeholder="Password"
				autocomplete="current-password"
			/>
		{/if}
		<button type="submit" class="btn btn-primary">Sign in</button>
	</form>
</div>

<style>
	.open-note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--yellow);
		line-height: 1.5;
	}

	.passkey-note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
		text-align: center;
	}

	.wrap {
		max-width: 380px;
		margin: 0 auto;
		padding: 90px 20px;
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
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
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		padding: 18px;
	}
	.people {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.person {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		border: 1px solid var(--bd);
		background: transparent;
		color: var(--fg2);
		border-radius: var(--radius-md);
		padding: 9px 11px;
		font-size: var(--text-md);
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
		font-size: var(--text-xs);
	}
	input[name='password'] {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: var(--radius-md);
		padding: 9px 11px;
		font-size: var(--text-md);
	}
</style>
