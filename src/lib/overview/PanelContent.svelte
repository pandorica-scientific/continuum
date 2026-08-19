<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// The one place that maps a panel key to its component. Content components
	// know nothing about the grid, and the board knows nothing about content —
	// this is the seam between them.
	import AccountsPanel from './panels/AccountsPanel.svelte';
	import ActivityPanel from './panels/ActivityPanel.svelte';
	import BriefingPanel from './panels/BriefingPanel.svelte';
	import CompositionPanel from './panels/CompositionPanel.svelte';
	import EnergyPanel from './panels/EnergyPanel.svelte';
	import EquityPanel from './panels/EquityPanel.svelte';
	import FlowPanel from './panels/FlowPanel.svelte';
	import InvestmentsPanel from './panels/InvestmentsPanel.svelte';
	import NetworthPanel from './panels/NetworthPanel.svelte';
	import RetirementPanel from './panels/RetirementPanel.svelte';
	import SavingsPanel from './panels/SavingsPanel.svelte';
	import TaxPanel from './panels/TaxPanel.svelte';
	import UpcomingPanel from './panels/UpcomingPanel.svelte';

	let {
		panelKey,
		data,
		period,
		currency
	}: {
		panelKey: string;
		// Each panel validates its own shape; the board carries it untyped.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		data: any;
		period: string;
		currency: string;
	} = $props();
</script>

{#if data === undefined}
	<span class="missing">This panel has no data on this load.</span>
{:else if data?.failed}
	<!-- One panel failing must not take the board with it, so it reports here. -->
	<span class="missing">This panel could not load. The rest of the board is unaffected.</span>
{:else if panelKey === 'briefing'}
	<BriefingPanel {data} />
{:else if panelKey === 'flow'}
	<FlowPanel {data} {period} {currency} />
{:else if panelKey === 'composition'}
	<CompositionPanel {data} />
{:else if panelKey === 'upcoming'}
	<UpcomingPanel {data} />
{:else if panelKey === 'networth'}
	<NetworthPanel {data} />
{:else if panelKey === 'accounts'}
	<AccountsPanel {data} />
{:else if panelKey === 'equity'}
	<EquityPanel {data} />
{:else if panelKey === 'energy'}
	<EnergyPanel {data} />
{:else if panelKey === 'investments'}
	<InvestmentsPanel {data} />
{:else if panelKey === 'retirement'}
	<RetirementPanel {data} />
{:else if panelKey === 'tax'}
	<TaxPanel {data} />
{:else if panelKey === 'activity'}
	<ActivityPanel {data} />
{:else if panelKey === 'savings'}
	<SavingsPanel {data} />
{/if}

<style>
	.missing {
		font-size: 12.5px;
		color: var(--fg3);
	}
</style>
