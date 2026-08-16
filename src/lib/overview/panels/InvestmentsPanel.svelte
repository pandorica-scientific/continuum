<script lang="ts">
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
		gap: 14px;
	}
	.headline {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.value {
		font-size: 19px;
		font-weight: 600;
	}
	.caption {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
		color: var(--fg2);
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
	}
</style>
