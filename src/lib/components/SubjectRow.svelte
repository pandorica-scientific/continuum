<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// A sibling of `ShelfRow`, not a second set of props on it — a subject has
	// no drag order, unlike a shelf, but shares the same grid/height/badge/menu.
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
	<span class="tail">
		{#if subject.archived}
			<span class="mono badge">Archived</span>
		{/if}
		<button
			type="button"
			class="menu"
			aria-label="More for {subject.name}"
			onclick={() => onmenu?.()}>⋯</button
		>
	</span>
</div>

<style>
	.subject-row {
		display: grid;
		/* `ShelfRow`'s grid without its 18px handle column. */
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
	/* Opacity on the emoji since it has no colour of ours to quieten. */
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
