<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	interface Group {
		label: string;
		asset: string | null;
		liability: string | null;
		net: string;
		colorVar: string;
		width: number;
		owedPct: number;
		detail: string;
	}

	let {
		data
	}: {
		data: {
			groups: Group[];
			assetsTotal: string;
			liabilitiesTotal: string;
			net: string;
			netPositive: boolean;
		};
	} = $props();
</script>

<div class="stack">
	{#each data.groups as g (g.label)}
		<div class="comp">
			<span class="c-label">{g.label}</span>
			<span class="mono c-numbers">
				{#if g.asset && g.liability}
					<span style="color: var(--fg2);">{g.asset}</span>
					<span style="color: var(--red);">{g.liability}</span>
					<span style:color="var({g.colorVar})">= {g.net}</span>
				{:else if g.liability}
					<span style="color: var(--red);">{g.liability}</span>
				{:else}
					<span style:color="var({g.colorVar})">{g.net}</span>
				{/if}
			</span>
			<div class="c-track">
				<div class="c-bar" style:width="{g.width}%">
					<div class="c-net" style:background="var({g.colorVar})"></div>
					{#if g.owedPct > 0}
						<div class="c-owed" style:width="{g.owedPct}%"></div>
					{/if}
				</div>
			</div>
			<span class="c-detail">{g.detail}</span>
		</div>
	{/each}
	<div class="net-line">
		<span class="c-label">Net worth</span>
		<span class="mono c-numbers">
			<span style="color: var(--fg2);">{data.assetsTotal}</span>
			<span style="color: var(--red);">{data.liabilitiesTotal}</span>
			<span class="net-value" style:color={data.netPositive ? 'var(--green)' : 'var(--red)'}>
				= {data.net}
			</span>
		</span>
	</div>
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.comp {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px 12px;
	}
	.c-label {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.c-numbers {
		font-size: var(--text-sm);
		text-align: right;
		display: flex;
		gap: 10px;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	.c-track {
		grid-column: 1 / -1;
		height: 6px;
		background: var(--card3);
		border-radius: 4px;
		overflow: hidden;
	}
	.c-bar {
		position: relative;
		height: 100%;
		border-radius: 4px;
		overflow: hidden;
	}
	.c-net {
		position: absolute;
		inset: 0;
	}
	.c-owed {
		position: absolute;
		top: 0;
		right: 0;
		height: 100%;
		background: var(--red);
		opacity: 0.85;
	}
	.net-line {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px 12px;
		border-top: 1px solid var(--bd);
		padding-top: 12px;
	}
	.net-line .c-label {
		font-weight: 600;
		color: var(--fg1);
	}
	.net-value {
		font-weight: 600;
	}
	.c-detail {
		grid-column: 1 / -1;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
</style>
