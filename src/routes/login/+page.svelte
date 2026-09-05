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

<div class="signin">
	<!-- The left panel is the product's one piece of marketing, and it is only
	     ever seen by somebody who already runs it — so it says what is true about
	     the instance rather than what it could do. Below 900px it is dropped
	     entirely: on a phone the form is the whole screen. -->
	<aside class="hero">
		<span class="hero-mark"><BrandMark size={30} /></span>
		<h1 class="tagline">Your household's money, on your own machine.</h1>
		<p class="hero-sub">
			Every figure here was read from a statement you imported, by software running where you put
			it.
		</p>
		<ul class="facts">
			<li>No cloud</li>
			<li>No telemetry</li>
			<li>AGPL-3.0</li>
		</ul>
	</aside>

	<div class="pane">
		<div class="wrap">
			<div class="brand">
				<BrandMark size={22} />
				<span class="wordmark">Continuum</span>
			</div>

			{#if form?.message}
				<div class="error">{form.message}</div>
			{/if}

			{#if data.passkeys}
				<PasskeyButton />
			{:else if data.passkeyWorksAt}
				<!-- A passkey is bound to one address. Silence here read as "this build
				     has no passkeys"; naming the address that works turns a dead end
				     into a next step. -->
				<p class="passkey-note">
					Passkeys work at <code>{data.passkeyWorksAt}</code> — sign in with a password here.
				</p>
			{/if}

			<form method="POST" class="card form">
				<h2 class="form-title">Sign in</h2>
				<div class="people" role="radiogroup" aria-label="Who is signing in">
					{#each data.people as p (p.id)}
						<button
							type="button"
							class="person"
							class:active={personId === p.id}
							role="radio"
							aria-checked={personId === p.id}
							style:--person-hue="var({p.hue})"
							onclick={() => (personId = p.id)}
						>
							<span class="avatar">{p.initials}</span>
							<span class="who">{p.name}</span>
							<span class="radio" aria-hidden="true"></span>
						</button>
					{/each}
				</div>
				<input type="hidden" name="personId" value={personId} />
				{#if data.openMode}
					<!-- No credential is being asked for, so no field is shown. Saying so
					     plainly matters: a sign-in box that simply lets you in is
					     otherwise indistinguishable from one that is broken. -->
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
				<button type="submit" class="btn btn-primary sign-in">Sign in</button>
			</form>
		</div>
	</div>
</div>

<style>
	.signin {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		min-height: 100dvh;
	}
	.hero {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--space-7);
		padding: 60px 56px;
		/* Down the panel, not across its corner: this one is tall and narrow, so
		   at the token's default 135deg the teal end landed in the bottom-right
		   as a blob rather than as the end of a flow. */
		--hero-angle: 165deg;
		background: var(--hero-bg);
		/* Fixed white in both themes: the gradient is dark in both. And the mark
		   inside inherits it, which is the point of BrandMark taking its colour
		   from context. */
		color: #fff;
	}
	.hero-mark {
		display: grid;
		place-items: center;
		width: 52px;
		height: 52px;
		border-radius: var(--radius-tile);
		background: rgba(255, 255, 255, 0.14);
	}
	.tagline {
		margin: 0;
		font-family: var(--font-display);
		font-size: 38px;
		font-weight: 650;
		letter-spacing: -0.03em;
		line-height: 1.1;
		max-width: 12em;
	}
	.hero-sub {
		margin: 0;
		font-size: var(--text-lg);
		line-height: 1.55;
		opacity: 0.82;
		max-width: 30em;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin: var(--space-4) 0 0;
		padding: 0;
		list-style: none;
	}
	.facts li {
		font-size: var(--text-sm);
		padding: 4px var(--space-6);
		border-radius: var(--radius-pill);
		background: rgba(255, 255, 255, 0.16);
	}

	.pane {
		display: grid;
		place-items: center;
		padding: var(--space-8);
		min-width: 0;
	}
	.wrap {
		width: 100%;
		max-width: 380px;
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		color: var(--brand);
	}
	.wordmark {
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.015em;
	}
	.form-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-4xl);
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-ctl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.people {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	/* A radio card, not a toggle: the ring on the right says only one of these
	   can be chosen, which a filled row on its own does not. */
	.person {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr) 16px;
		align-items: center;
		gap: var(--space-5);
		border: 1px solid var(--bd);
		background: transparent;
		color: var(--fg2);
		border-radius: var(--radius-tile);
		padding: var(--space-5) var(--space-6);
		font-family: inherit;
		font-size: var(--text-md);
		cursor: pointer;
		text-align: left;
		transition:
			background-color var(--dur) var(--ease),
			border-color var(--dur) var(--ease);
	}
	.person:hover {
		background: var(--surface-2);
	}
	.person.active {
		border-color: color-mix(in srgb, var(--brand) 55%, transparent);
		background: color-mix(in srgb, var(--brand) 12%, transparent);
		color: var(--fg1);
		font-weight: 500;
	}
	.person:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
	.avatar {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--person-hue) 26%, transparent);
		color: var(--fg1);
		display: grid;
		place-items: center;
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.who {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.radio {
		width: 16px;
		height: 16px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--bd2);
	}
	.person.active .radio {
		border-color: var(--brand);
		border-width: 5px;
	}
	input[name='password'] {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: var(--radius-ctl);
		padding: 9px 11px;
		font-size: var(--text-md);
	}
	.sign-in {
		min-height: 40px;
		background: var(--brand);
		border-color: var(--brand);
		color: var(--fg-inverse);
	}
	.sign-in:hover {
		background: var(--brand);
		opacity: 0.9;
	}
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

	/* One column below 900: the panel is decoration, and on a phone the form is
	   the entire reason the page exists. */
	@media (max-width: 899px) {
		.signin {
			grid-template-columns: minmax(0, 1fr);
		}
		.hero {
			display: none;
		}
	}
</style>
