<script module lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/** Page sizes for tall rows (year/month, rule+score); not the transactions
	 *  screen's 10/25/50, since a transaction row is one line. */
	export const LIST_PAGE_SIZES = [5, 25, 50] as const;
	export const DEFAULT_LIST_PAGE_SIZE = LIST_PAGE_SIZES[0];
</script>

<script lang="ts">
	let {
		size = $bindable(),
		onchange,
		label
	}: {
		size: number;
		/** Called after size changes; caller must reset its page index, or it
		 *  may point past the new page count. */
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
