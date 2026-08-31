<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	let {
		data
	}: {
		data: {
			empty: boolean;
			asOf?: string;
			value?: string;
			moneyIn?: string;
			gain?: string;
			gainPositive?: boolean;
			annualised?: string | null;
		};
	} = $props();
</script>

{#if data.empty}
	<span class="quiet">No portfolio report has been imported yet.</span>
{:else}
	<div class="stack">
		<div class="headline">
			<span class="mono value">{data.value}</span>
			<span class="caption">as at {data.asOf}</span>
		</div>
		<div class="rows">
			<div class="row"><span>Money in</span><span class="mono">{data.moneyIn}</span></div>
			<div class="row">
				<span>Gain</span>
				<span class="mono" style:color={data.gainPositive ? 'var(--green)' : 'var(--red)'}>
					{data.gain}
				</span>
			</div>
			<div class="row">
				<span>Annualised</span>
				<span class="mono">{data.annualised ?? '—'}</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.headline {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.value {
		font-size: var(--text-2xl);
		font-weight: 600;
	}
	.caption {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.row {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
