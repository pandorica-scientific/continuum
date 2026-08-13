<script lang="ts">
	let {
		emoji,
		title,
		caption,
		syncedAt
	}: { emoji: string; title: string; caption: string; syncedAt?: string } = $props();
</script>

<header>
	<div class="titles">
		<h1><span class="emoji">{emoji}</span><span>{title}</span></h1>
		<span class="caption">{caption}</span>
	</div>
	<div class="actions">
		{#if syncedAt}
			<span class="synced">🕒 synced {syncedAt}</span>
		{/if}
		<a href="/import" class="btn">➕ Import statement</a>
	</div>
</header>

<style>
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		flex-wrap: wrap;
	}
	.titles {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	h1 {
		margin: 0;
		font-size: 28px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.2;
		display: flex;
		align-items: center;
		gap: 11px;
	}
	.emoji {
		font-size: 24px;
		line-height: 1;
	}
	.caption {
		font-size: 13.6px;
		color: var(--fg3);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.synced {
		font-size: 12px;
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: 8px;
		padding: 7px 11px;
		background: var(--card);
		white-space: nowrap;
	}
	a.btn:hover {
		text-decoration: none;
	}
</style>
