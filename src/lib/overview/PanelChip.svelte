<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// One panel, offered rather than placed: the icon and title the board draws
	// as an eyebrow, on a button that adds it.
	//
	// Lifted out of the Customise tray when the first-run picker needed the same
	// thing at a larger size. Two copies would have been the tray and the picker
	// drifting apart panel by panel — and the tray's version is the one every
	// household has already learnt to recognise, so it is kept exactly as it
	// was and the description is what the picker adds on top.
	import IconTile from '$lib/components/IconTile.svelte';
	import type { IconName } from '$lib/icons';

	let {
		icon,
		hue = '--fg3',
		title,
		description,
		onclick
	}: {
		icon: IconName;
		/** The panel's identity colour, so the tray reads as the board does. */
		hue?: string;
		title: string;
		/** The picker's second line. Absent in the tray, where the board behind
		 *  it already shows what these panels look like. */
		description?: string;
		onclick: () => void;
	} = $props();
</script>

<button type="button" class="chip" class:described={description} {onclick}>
	<span class="title"><IconTile {hue} {icon} size={description ? 26 : 18} />{title}</span>
	{#if description}
		<span class="description">{description}</span>
	{/if}
</button>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--card);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		color: var(--fg2);
		font-size: var(--text-sm);
		padding: 4px var(--space-6) 4px 5px;
		cursor: pointer;
		text-align: left;
	}
	.chip:hover {
		background: var(--surface-2);
	}
	/* The same ring every other control in the app draws. Without it eighteen
	   chips beside a .btn primary fall back to whatever the browser does, which
	   is a different focus outline on the one screen made of nothing but these. */
	.chip:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
	/* A pill drawn around two lines of prose reads as a mistake, so a described
	   chip is a card: the same colours, squared off to the board's own radius,
	   and filling its cell so a grid of them lines up whatever the descriptions
	   happen to wrap to. */
	.chip.described {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		border-radius: var(--radius-card);
		padding: var(--space-6) var(--space-7);
		width: 100%;
		height: 100%;
	}
	.title {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
	}
	/* Only where a description sits under it: two lines the same size and a
	   shade apart is not a hierarchy, and in the tray there is no second line
	   for the title to be distinguished from. */
	.chip.described .title {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.description {
		font-size: var(--text-sm);
		color: var(--fg3);
		line-height: 1.45;
	}
</style>
