<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Every tag, what it is on, and what it has cost — in the Documents centre
	// column, where the rail stays put beside it.
	import { enhance } from '$app/forms';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { tagHue } from '$lib/tag-hue';
	import { reach } from '$lib/tags-view';
	import type { TagsScreen } from '$lib/server/tags/screen';

	let {
		screen,
		message
	}: {
		screen: TagsScreen;
		message?: string;
	} = $props();

	// Two taps rather than a browser confirm(): this untags everything the tag
	// is on, and a native dialog blocks the page while it is open.
	let confirming = $state<string | null>(null);
	$effect(() => {
		void screen.tags;
		confirming = null;
	});
</script>

<section class="section">
	<div class="eyebrow-row">
		<Eyebrow hue="--fg3" icon="tag" label="Tags" />
		<span class="eyebrow-caption">
			{screen.tags.length}
			{screen.tags.length === 1 ? 'tag' : 'tags'} · what each has cost, across every category it touches
		</span>
	</div>

	{#if screen.tags.length === 0}
		<p class="empty">No tags yet. Add one to a document or a transaction and it appears here.</p>
	{/if}

	{#if message}
		<p class="row-error" role="alert">{message}</p>
	{/if}

	{#each screen.tags as t (t.id)}
		<div class="card tag-row">
			<a class="t-link" href="/documents?tag={encodeURIComponent(t.name)}">
				<span
					class="t-name"
					style:color="var({tagHue(t.name)})"
					style:border-color="color-mix(in srgb, var({tagHue(t.name)}) 45%, transparent)"
					>{t.name}</span
				>
				{#if t.documents.length || t.properties.length || t.loans.length || t.transactions > 0 || t.splitLines > 0}
					<span class="t-linked">
						{#each t.properties as p (p.id)}<span class="t-item">🏢 {p.name}</span>{/each}
						{#each t.loans as l (l.id)}<span class="t-item">🏦 {l.name}</span>{/each}
						{#each t.documents as d (d.id)}<span class="t-item">🗂️ {d.name}</span>{/each}
						{#if t.documentsMore + t.propertiesMore + t.loansMore > 0}
							<span class="t-more">+{t.documentsMore + t.propertiesMore + t.loansMore} more</span>
						{/if}
						{#if t.transactions > 0}
							<!-- A whole tagged transaction carries no card of its own either —
							     `setTransactionTags`, the ordinary tagging path, has no name to
							     show beside a property or a document. -->
							<span class="t-more">+{t.transactions} on transactions</span>
						{/if}
						{#if t.splitLines > 0}
							<!-- A split line carries no card of its own to list beside the
							     items above, but a tag used only here must not look unused. -->
							<span class="t-more">+{t.splitLines} on transaction lines</span>
						{/if}
					</span>
				{/if}
				<span class="t-figures">
					{#if t.empty}
						<span class="t-quiet">no money tagged</span>
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
			<a class="t-money" href="/transactions?tag={t.id}" title="Transactions carrying this tag">
				register →
			</a>
			{#if t.loans.length || t.loansMore}
				<!-- Loans have no tag filter of their own to link to, unlike the
				     register above — this opens the screen so the loan can be found
				     among the (usually few) cards there. -->
				<a class="t-money" href="/loans" title="Loans carrying this tag"> loans → </a>
			{/if}
			{#if confirming === t.id}
				<form method="POST" action="?/deleteTag" use:enhance class="t-confirm">
					<!-- Never gated on `t.tagged` — `reach` totals every carrier the
					     delete removes, including a whole tagged transaction or a tagged
					     split line, neither of which has a chip above. -->
					<span class="t-reach">{reach(t)}</span>
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
	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
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
	.t-name {
		display: inline-flex;
		align-items: center;
		height: 26px;
		padding: 0 var(--space-5);
		border: 1px solid var(--bd);
		border-radius: var(--radius-chip);
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.t-money {
		flex: none;
		font-size: var(--text-sm);
		color: var(--fg3);
		text-decoration: none;
	}
	.t-money:hover {
		color: var(--fg1);
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
		padding: var(--space-1) var(--space-2);
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
	.t-linked {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-7);
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
