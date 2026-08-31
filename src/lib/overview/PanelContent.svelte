<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The one place that maps a panel key to its component. Content components
	// know nothing about the grid, and the board knows nothing about content —
	// this is the seam between them.
	import AccountsPanel from './panels/AccountsPanel.svelte';
	import ActivityPanel from './panels/ActivityPanel.svelte';
	import BriefingPanel from './panels/BriefingPanel.svelte';
	import BudgetPanel from './panels/BudgetPanel.svelte';
	import CompositionPanel from './panels/CompositionPanel.svelte';
	import DebtsPanel from './panels/DebtsPanel.svelte';
	import EnergyPanel from './panels/EnergyPanel.svelte';
	import EquityPanel from './panels/EquityPanel.svelte';
	import FlowPanel from './panels/FlowPanel.svelte';
	import InvestmentsPanel from './panels/InvestmentsPanel.svelte';
	import NetworthPanel from './panels/NetworthPanel.svelte';
	import PaperPanel from './panels/PaperPanel.svelte';
	import RetirementPanel from './panels/RetirementPanel.svelte';
	import SalaryPanel from './panels/SalaryPanel.svelte';
	import SavingsPanel from './panels/SavingsPanel.svelte';
	import StatementsPanel from './panels/StatementsPanel.svelte';
	import TaxPanel from './panels/TaxPanel.svelte';
	import UpcomingPanel from './panels/UpcomingPanel.svelte';

	let {
		panelKey,
		data,
		currency
	}: {
		panelKey: string;
		// Each panel validates its own shape; the board carries it untyped.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		data: any;
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
	<FlowPanel {data} {currency} />
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
{:else if panelKey === 'paper'}
	<PaperPanel {data} />
{:else if panelKey === 'statements'}
	<StatementsPanel {data} />
{:else if panelKey === 'salary'}
	<SalaryPanel {data} />
{:else if panelKey === 'debts'}
	<DebtsPanel {data} />
{:else if panelKey === 'budget'}
	<BudgetPanel {data} />
{/if}

<style>
	.missing {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
