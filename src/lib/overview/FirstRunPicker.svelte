<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The first Overview anybody sees, and the only screen in the app that is
	// nothing but a question.
	//
	// Before this, a new person was handed four panels chosen for them and had
	// to find Customise to learn there were fourteen more. So the board starts
	// empty and this stands above it: every panel their modules allow, each
	// saying what it draws, and the suggested board one press away for anyone
	// who would rather not decide.
	//
	// It stays put while panels are picked — the board fills in below it and a
	// chip leaves this grid as it is placed — because choosing one panel is not
	// an answer to the question this is asking. Done is. Both routes out go
	// through the board's own add and reset, so there is no second way for an
	// arrangement to be stored.
	import PanelChip from './PanelChip.svelte';
	import type { PanelDefinition } from './panels';

	let {
		panels,
		onadd,
		onsuggested,
		ondone
	}: {
		/** The panels available to place — module-gated ones are already gone,
		 *  and one already on the board has left this list. */
		panels: PanelDefinition[];
		onadd: (key: string) => void;
		onsuggested: () => void;
		/** Finished picking. The only thing that closes this. */
		ondone: () => void;
	} = $props();
</script>

<section class="picker">
	<h2>Build your board</h2>
	<p>
		Pick as many panels as you like — each one lands on the board below as you press it. Press Done
		when you have what you want; nothing here is final, and Customise brings it all back.
	</p>
	<div class="actions">
		<button type="button" class="btn btn-primary" onclick={onsuggested}>
			Use the suggested board
		</button>
		<button type="button" class="btn" onclick={ondone}>Done</button>
	</div>
	<div class="grid">
		{#each panels as panel (panel.key)}
			<PanelChip
				icon={panel.icon}
				title={panel.title}
				description={panel.description}
				onclick={() => onadd(panel.key)}
			/>
		{/each}
	</div>
</section>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-5);
		padding: var(--space-8);
		background: var(--card);
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
	}
	h2 {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	p {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg2);
		max-width: 68ch;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	/* Wide enough that a description reads as a line rather than a column of
	   two-word fragments, and no wider: on a phone that is one chip across, and
	   on a full-width board it is six. */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: var(--space-5);
		width: 100%;
		margin-top: var(--space-3);
	}
</style>
