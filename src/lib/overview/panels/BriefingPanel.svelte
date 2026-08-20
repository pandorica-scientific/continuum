<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import Pill from '$lib/components/Pill.svelte';
	import type { Hue } from '$lib/ui/hue';

	interface Item {
		emoji: string;
		kind: string;
		hue: Hue;
		pill: string;
		title: string;
		detail: string;
		href: string;
	}

	let { data }: { data: { items: Item[]; caption: string } } = $props();
</script>

{#if data.items.length}
	<div class="briefing">
		{#each data.items as item (item.title)}
			<a href={item.href} class="brief-card">
				<span class="b-top">
					<span>{item.emoji}</span><span>{item.kind}</span>
					<span class="b-pill"><Pill hue={item.hue}>{item.pill}</Pill></span>
				</span>
				<span class="b-title">{item.title}</span>
				<span class="b-detail">{item.detail}</span>
			</a>
		{/each}
	</div>
{:else}
	<span class="quiet">Nothing needs a decision right now.</span>
{/if}

<style>
	.briefing {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 10px;
	}
	.brief-card {
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 7px;
		background: var(--card);
		border: 1px solid var(--bd);
		border-radius: 10px;
		padding: 13px 15px;
		color: var(--fg1);
	}
	.brief-card:hover {
		background: var(--card2);
		text-decoration: none;
	}
	.b-top {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.b-pill {
		margin-left: auto;
	}
	.b-title {
		font-size: var(--text-lg);
		font-weight: 500;
		line-height: 1.35;
	}
	.b-detail {
		font-size: var(--text-sm);
		color: var(--fg3);
		line-height: 1.5;
	}
	.quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
