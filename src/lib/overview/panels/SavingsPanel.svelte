<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	interface Month {
		month: string;
		kept: string;
		negative: boolean;
		height: number;
		pct: number | null;
	}

	let { data }: { data: { months: Month[]; peak: string; averagePct: number | null } } = $props();

	// Which bar the pointer is over, or null. Focus sets it too, so the readout
	// is reachable without a mouse — and on a touch screen, where the native
	// `title` tooltip this replaces never appeared at all.
	let active = $state<Month | null>(null);
</script>

{#if data.months.length}
	<div class="wrap">
		<span class="caption">
			{data.averagePct === null ? 'no income recorded' : `keeping ${data.averagePct}% on average`}
			· months in red spent more than they earned
		</span>
		<div class="plot">
			<div class="axis mono">
				<span>{data.peak}</span>
				<span>0</span>
			</div>
			<div class="bars">
				{#each data.months as m (m.month)}
					<!-- The value lives in aria-label, so assistive tech reads it from the
					     bar itself and needs no hover. The readout below is the pointer
					     affordance; making the bar focusable to drive it would put a dozen
					     tab stops in a small panel for a value already announced here. -->
					<div
						class="col"
						role="img"
						aria-label="{m.month}: {m.kept}"
						onmouseenter={() => (active = m)}
						onmouseleave={() => (active = null)}
					>
						<div class="bar" class:negative={m.negative} style:height="{m.height}%"></div>
						<span class="mono month">{m.month}</span>
					</div>
				{/each}
			</div>
		</div>
		<span class="readout mono" aria-live="polite">
			{active ? `${active.month} · ${active.kept}` : ''}
		</span>
	</div>
{:else}
	<span class="quiet">Not enough history to show a trend yet.</span>
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
		line-height: 1.45;
	}
	.plot {
		display: flex;
		gap: var(--space-4);
		flex: 1;
		min-height: 56px;
	}
	.axis {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		font-size: var(--text-2xs);
		color: var(--fg3);
		text-align: right;
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		flex: 1;
		min-height: 56px;
	}
	/* The height is reserved so the chart does not jump as the pointer crosses
	   it, which is worse than the missing readout this replaces. */
	.readout {
		font-size: var(--text-xs);
		color: var(--fg2);
		min-height: 1.2em;
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
		background: var(--green);
		border-radius: 2px 2px 0 0;
		min-height: 2px;
	}
	.bar.negative {
		background: var(--red);
	}
	.month {
		font-size: var(--text-2xs);
		color: var(--fg3);
	}
	.quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
