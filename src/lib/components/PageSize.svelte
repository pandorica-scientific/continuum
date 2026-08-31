<script module lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * How many rows a page holds.
	 *
	 * Five by default because the rows this pages are tall — a year that opens
	 * into its months, a rule carrying its conditions and its score. A table that
	 * fills the screen before anything is expanded has nowhere to put what
	 * expanding it produces. The larger sizes are for reading a whole list at
	 * once.
	 *
	 * Deliberately not the transactions screen's 10/25/50: a transaction is one
	 * line.
	 */
	export const LIST_PAGE_SIZES = [5, 25, 50] as const;
	export const DEFAULT_LIST_PAGE_SIZE = LIST_PAGE_SIZES[0];
</script>

<script lang="ts">
	// Above the rows it sizes, while the ‹ › nav sits beneath them — the same
	// split the transactions screen uses. How much to show is a decision you make
	// before reading; which page to read is one you make after.
	let {
		size = $bindable(),
		onchange,
		label
	}: {
		size: number;
		/**
		 * Called after the size changes, for the caller to reset its page.
		 *
		 * The page belongs to whoever is doing the paging, so it is reset there
		 * rather than reached into from here — but it MUST be reset: keeping the
		 * index would land you on a page that no longer exists at the new size,
		 * or scroll you somewhere you did not ask to be.
		 */
		onchange?: () => void;
		/** What a row is, plural, for the control's accessible name. */
		label: string;
	} = $props();
</script>

<span class="per-page" role="group" aria-label="{label} per page">
	{#each LIST_PAGE_SIZES as s (s)}
		<button
			type="button"
			class="per"
			class:active={s === size}
			aria-current={s === size ? 'true' : undefined}
			onclick={() => {
				size = s;
				onchange?.();
			}}
		>
			{s}
		</button>
	{/each}
</span>

<style>
	/* Same control as the transactions screen's rows-per-page. */
	.per-page {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		overflow: hidden;
	}
	.per {
		background: none;
		border: 0;
		cursor: pointer;
		font-size: var(--text-xs);
		color: var(--fg3);
		padding: 3px 9px;
	}
	.per + .per {
		border-left: 1px solid var(--bd);
	}
	.per:hover {
		color: var(--fg1);
	}
	.per.active {
		background: var(--card2);
		color: var(--fg1);
	}
</style>
