<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';

	let { data, form } = $props();

	// Two taps rather than a browser confirm(): this untags everything the tag is
	// on, and a native dialog blocks the page while it is open.
	let confirming = $state<string | null>(null);
	$effect(() => {
		void data.tags;
		confirming = null;
	});

	/** What the confirmation says a delete would reach. */
	function reach(t: { tagged: number; rules: number }): string {
		const parts: string[] = [];
		if (t.tagged > 0) parts.push(`untags ${t.tagged}`);
		if (t.rules > 0) parts.push(`${t.rules} ${t.rules === 1 ? 'rule' : 'rules'} stop applying it`);
		return parts.join(' · ');
	}
</script>

<ScreenHeader
	title="Tags"
	caption="What each project has cost so far, across every category it touches."
/>

<section class="section">
	<div class="eyebrow-row">
		<Eyebrow emoji="🏷️" label="Running totals" />
		<span class="eyebrow-caption">
			{data.tags.length}
			{data.tags.length === 1 ? 'tag' : 'tags'}
		</span>
	</div>

	{#if data.tags.length === 0}
		<p class="empty">
			No tags yet. Add one to a transaction in the register and its total appears here.
		</p>
	{/if}

	{#if form?.message}
		<p class="row-error" role="alert">{form.message}</p>
	{/if}

	{#each data.tags as t (t.id)}
		<!-- The card is no longer the link itself: a delete button cannot live
		     inside an anchor, so the anchor covers the row's content and the
		     button sits beside it. -->
		<div class="card tag-row">
			<a class="t-link" href="/transactions?tag={t.id}">
				<span class="t-name">{t.name}</span>
				{#if t.documents.length || t.properties.length}
					<span class="t-linked">
						{#each t.properties as p (p.id)}<span class="t-item">🏢 {p.name}</span>{/each}
						{#each t.documents as d (d.id)}<span class="t-item">🗂️ {d.name}</span>{/each}
						{#if t.documentsMore + t.propertiesMore > 0}
							<span class="t-more">+{t.documentsMore + t.propertiesMore} more</span>
						{/if}
					</span>
				{/if}
				<span class="t-figures">
					{#if t.empty}
						<span class="t-quiet">nothing tagged yet</span>
					{:else}
						{#each t.parts as p, i (i)}
							<span class="mono t-part">{p.amount}</span>
						{/each}
						{#if t.mixed}
							<span class="mono t-converted">≈ {t.converted}</span>
						{/if}
					{/if}
				</span>
			</a>
			{#if confirming === t.id}
				<form method="POST" action="?/deleteTag" use:enhance class="t-confirm">
					{#if reach(t)}<span class="t-reach">{reach(t)}</span>{/if}
					<input type="hidden" name="id" value={t.id} />
					<button type="submit" class="t-del confirm">Delete?</button>
				</form>
			{:else}
				<button
					type="button"
					class="t-del"
					aria-label="Remove {t.name}"
					onclick={() => (confirming = t.id)}
				>
					✕
				</button>
			{/if}
		</div>
	{/each}
</section>

<style>
	.tag-row {
		display: flex;
		align-items: center;
		gap: var(--space-6);
	}
	.tag-row:hover {
		background: var(--card2);
	}
	.t-link {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-7);
		flex-wrap: wrap;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}
	.t-link:hover {
		text-decoration: none;
	}
	.t-confirm {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.t-reach {
		font-size: var(--text-xs);
		color: var(--fg3);
		text-align: right;
	}
	.t-del {
		background: none;
		border: 0;
		color: var(--fg3);
		cursor: pointer;
		font-size: var(--text-sm);
		padding: 2px 4px;
		flex: none;
	}
	.t-del:hover,
	.t-del.confirm {
		color: var(--red);
	}
	.row-error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--red);
	}
	.t-name {
		font-size: var(--text-md);
		font-weight: 500;
	}
	.t-linked {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.t-more {
		color: var(--fg3);
	}
	.t-figures {
		display: flex;
		align-items: baseline;
		gap: var(--space-6);
		flex-wrap: wrap;
	}
	.t-part {
		font-size: var(--text-lg);
	}
	.t-converted,
	.t-quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.empty {
		color: var(--fg3);
		font-size: var(--text-md);
	}
</style>
