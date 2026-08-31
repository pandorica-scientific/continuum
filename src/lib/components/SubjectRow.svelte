<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// One subject in the Documents rail's pencil mode: emoji, name, count, and
	// either the `Household` badge or the `⋯` that archives it.
	//
	// A sibling of `ShelfRow` rather than a second set of props on it, because
	// the two rows differ in the one thing `ShelfRow` exists for: a shelf is the
	// only sortable row in the app and carries a drag handle, and a subject has
	// no order to drag into — the rail sorts them. The grid, the height, the
	// hover fill, the badge and the menu are deliberately identical values, so
	// the two rows read as one row in two places rather than as two designs.
	let {
		subject,
		onrename,
		onmenu
	}: {
		subject: {
			id: string;
			name: string;
			emoji: string;
			archived: boolean;
			/** The seeded subject: renameable, never archivable. */
			household: boolean;
			count: number;
		};
		onrename?: () => void;
		onmenu?: () => void;
	} = $props();
</script>

<div class="subject-row" class:archived={subject.archived} role="listitem">
	<span class="emoji">{subject.emoji}</span>
	<button type="button" class="label" onclick={() => onrename?.()}>{subject.name}</button>
	<span class="mono count">{subject.count}</span>
	<!-- Archived is said, not merely drawn: a dimmed row with no word on it is
	     indistinguishable from a row that happens to be quiet. -->
	<span class="tail">
		{#if subject.archived}
			<span class="mono badge">Archived</span>
		{/if}
		{#if subject.household}
			<span class="mono badge">Household</span>
		{:else}
			<button
				type="button"
				class="menu"
				aria-label="More for {subject.name}"
				onclick={() => onmenu?.()}>⋯</button
			>
		{/if}
	</span>
</div>

<style>
	.subject-row {
		display: grid;
		/* `ShelfRow`'s grid without its 18px handle column: same 26px emoji, same
		   flexible name, same count, same tail. */
		grid-template-columns: 26px minmax(0, 1fr) auto minmax(24px, auto);
		align-items: center;
		gap: var(--space-3);
		height: 36px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: transparent;
	}
	.subject-row:hover {
		background: var(--card2);
	}
	/* Dimmed, not hidden — the row is still a row, and its ⋯ is the only way
	   back. `--fg3` is the quiet colour in both themes; opacity on the emoji
	   because an emoji has no colour of ours to quieten. */
	.subject-row.archived .label {
		color: var(--fg3);
	}
	.subject-row.archived .emoji {
		opacity: 0.55;
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
		font-weight: 600;
		color: var(--fg3);
		background: var(--grey-tint);
		border-radius: var(--radius-xl);
		padding: var(--space-1) var(--space-4);
		white-space: nowrap;
	}
	.menu {
		border: 0;
		background: transparent;
		color: var(--fg3);
		font-size: var(--text-md);
		cursor: pointer;
	}
	.menu:hover {
		color: var(--fg1);
	}
</style>
