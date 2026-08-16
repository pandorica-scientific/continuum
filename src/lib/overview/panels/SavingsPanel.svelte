<script lang="ts">
	interface Month {
		month: string;
		kept: string;
		negative: boolean;
		height: number;
		pct: number | null;
	}

	let { data }: { data: { months: Month[]; averagePct: number | null } } = $props();
</script>

{#if data.months.length}
	<div class="wrap">
		<span class="caption">
			{data.averagePct === null ? 'no income recorded' : `keeping ${data.averagePct}% on average`}
			· months in red spent more than they earned
		</span>
		<div class="bars">
			{#each data.months as m (m.month)}
				<div class="col" title="{m.month}: {m.kept}">
					<div class="bar" class:negative={m.negative} style:height="{m.height}%"></div>
					<span class="mono month">{m.month}</span>
				</div>
			{/each}
		</div>
	</div>
{:else}
	<span class="quiet">Not enough history to show a trend yet.</span>
{/if}

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: 10px;
		height: 100%;
	}
	.caption {
		font-size: 11.5px;
		color: var(--fg3);
		line-height: 1.45;
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		flex: 1;
		min-height: 56px;
	}
	.col {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: center;
		gap: 4px;
		height: 100%;
	}
	.bar {
		width: 100%;
		background: var(--green);
		border-radius: 2px 2px 0 0;
		min-height: 2px;
	}
	.bar.negative {
		background: var(--red);
	}
	.month {
		font-size: 9px;
		color: var(--fg3);
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
	}
</style>
