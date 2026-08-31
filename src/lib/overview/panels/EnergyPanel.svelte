<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	interface Day {
		day: string;
		kwh: string;
		height: number;
		above: boolean;
	}

	let { data }: { data: { days: Day[]; average?: string; note: string | null } } = $props();
</script>

{#if data.days.length}
	<div class="wrap">
		<span class="caption">averaging {data.average} kWh a day · bars above it in orange</span>
		<div class="bars">
			{#each data.days as d (d.day)}
				<div class="col" title="{d.day}: {d.kwh} kWh">
					<div class="bar" class:above={d.above} style:height="{d.height}%"></div>
					<span class="mono day">{d.day}</span>
				</div>
			{/each}
		</div>
	</div>
{:else}
	<span class="quiet">{data.note}</span>
{/if}

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		height: 100%;
	}
	.caption {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		flex: 1;
		min-height: 60px;
	}
	.col {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: center;
		gap: var(--space-2);
		height: 100%;
	}
	.bar {
		width: 100%;
		background: var(--teal);
		border-radius: 2px 2px 0 0;
		min-height: 2px;
	}
	.bar.above {
		background: var(--orange);
	}
	.day {
		font-size: var(--text-2xs);
		color: var(--fg3);
	}
</style>
