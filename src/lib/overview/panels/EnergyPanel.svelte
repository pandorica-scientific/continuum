<script lang="ts">
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
		gap: 10px;
		height: 100%;
	}
	.caption {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		flex: 1;
		min-height: 60px;
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
		background: var(--teal);
		border-radius: 2px 2px 0 0;
		min-height: 2px;
	}
	.bar.above {
		background: var(--orange);
	}
	.day {
		font-size: 9.5px;
		color: var(--fg3);
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
	}
</style>
