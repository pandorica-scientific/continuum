<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// One organisation in the Documents rail's pencil mode: emoji, name, the
	// kind badge, the document count, and the `⋯` that removes it.
	//
	// A third sibling of `ShelfRow` and `SubjectRow`, and the same argument for
	// being one: the grid, the height, the hover fill and the badge are
	// deliberately identical values, so three rows read as one row in three
	// places rather than as three designs. What differs is the tail — an
	// organisation is deleted rather than archived, because unlike a subject it
	// has no paper of its own to demote.
	let {
		organisation,
		onrename,
		onmenu
	}: {
		organisation: {
			id: string;
			name: string;
			emoji: string;
			kind: string;
			count: number;
			/** How many people have ever had a role period here. */
			people: number;
		};
		onrename?: () => void;
		onmenu?: () => void;
	} = $props();
</script>

<div class="org-row" role="listitem">
	<span class="emoji">{organisation.emoji}</span>
	<button type="button" class="label" onclick={() => onrename?.()}>{organisation.name}</button>
	<span class="mono count">{organisation.count}</span>
	<span class="tail">
		<!-- The kind is said rather than drawn: "ČSSZ" and "VZP" are two
		     initialisms a person half-remembers, and employer-or-authority is
		     what tells them apart at a glance. `other` says nothing worth the
		     width. -->
		{#if organisation.kind !== 'other'}
			<span class="mono badge">{organisation.kind}</span>
		{/if}
		<button
			type="button"
			class="menu"
			aria-label="More for {organisation.name}"
			onclick={() => onmenu?.()}>⋯</button
		>
	</span>
</div>

<style>
	.org-row {
		display: grid;
		/* `SubjectRow`'s grid exactly. */
		grid-template-columns: 26px minmax(0, 1fr) auto minmax(24px, auto);
		align-items: center;
		gap: var(--space-3);
		height: 36px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: transparent;
	}
	.org-row:hover {
		background: var(--card2);
	}
	.emoji {
		font-size: var(--text-lg);
		line-height: 1;
		text-align: center;
	}
	.tail {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
	}
	.label {
		border: 0;
		background: transparent;
		color: var(--fg1);
		font-size: var(--text-md);
		text-align: left;
		padding: 0;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		font-size: var(--text-2xs);
		color: var(--fg3);
		font-variant-numeric: tabular-nums;
	}
	.badge {
		font-size: var(--text-2xs);
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 1px 6px;
	}
	.menu {
		border: 0;
		background: transparent;
		color: var(--fg3);
		cursor: pointer;
		padding: 0 var(--space-2);
		line-height: 1;
	}
	.menu:hover {
		color: var(--fg1);
	}
</style>
