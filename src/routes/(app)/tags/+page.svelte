<script lang="ts">
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';

	let { data } = $props();
</script>

<ScreenHeader
	emoji="🏷️"
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

	{#each data.tags as t (t.id)}
		<a class="card tag-row" href="/transactions?tag={t.id}">
			<span class="t-name">{t.name}</span>
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
	{/each}
</section>

<style>
	.tag-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		flex-wrap: wrap;
		color: inherit;
		text-decoration: none;
	}
	.tag-row:hover {
		background: var(--card2);
		text-decoration: none;
	}
	.t-name {
		font-size: 13.5px;
		font-weight: 500;
	}
	.t-figures {
		display: flex;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
	}
	.t-part {
		font-size: 14px;
	}
	.t-converted,
	.t-quiet {
		font-size: 12px;
		color: var(--fg3);
	}
	.empty {
		color: var(--fg3);
		font-size: 13px;
	}
</style>
