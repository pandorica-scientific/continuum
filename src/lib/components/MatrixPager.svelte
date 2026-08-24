<script module lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	/**
	 * How many year-rows a page holds.
	 *
	 * Five by default because a year row opens into its months, and a table that
	 * fills the screen before anything is expanded has nowhere to put them. The
	 * larger sizes are for reading a whole record at once.
	 *
	 * Deliberately not the transactions screen's 10/25/50: a transaction is one
	 * line and a year is a row that grows.
	 */
	export const MATRIX_PAGE_SIZES = [5, 25, 50] as const;
	export const DEFAULT_MATRIX_PAGE_SIZE = MATRIX_PAGE_SIZES[0];
</script>

<script lang="ts">
	// Shared by the Tax and Salary matrices so the two cannot drift apart.
	//
	// Unlike the transactions pager this is local state rather than the URL: the
	// rest of these screens' view — the open year, the person filter — is local
	// too, and putting one of them in the address bar and not the others would
	// make a shared link restore half a view.
	let {
		page = $bindable(),
		pages,
		size = $bindable(),
		range,
		label
	}: {
		page: number;
		pages: number;
		size: number;
		/** The years the current page covers, e.g. "2019–2023". */
		range: string;
		/** What a row is, for the group's accessible name. */
		label: string;
	} = $props();
</script>

<div class="pager">
	<span class="side"></span>

	<span class="nav">
		<button
			type="button"
			class="page-step"
			disabled={page === 0}
			aria-label="Newer {label}"
			onclick={() => (page = Math.max(0, page - 1))}>‹</button
		>
		<span class="page-of">
			{page + 1} / {pages}
			<span class="page-range">{range}</span>
		</span>
		<button
			type="button"
			class="page-step"
			disabled={page >= pages - 1}
			aria-label="Older {label}"
			onclick={() => (page = Math.min(pages - 1, page + 1))}>›</button
		>
	</span>

	<span class="side end">
		<span class="per-page" role="group" aria-label="Rows per page">
			{#each MATRIX_PAGE_SIZES as s (s)}
				<button
					type="button"
					class="per"
					class:active={s === size}
					aria-current={s === size ? 'true' : undefined}
					onclick={() => {
						// Back to the first page: keeping the index would land you on a
						// page that no longer exists at the new size, or scroll you
						// somewhere you did not ask to be.
						size = s;
						page = 0;
					}}
				>
					{s}
				</button>
			{/each}
		</span>
	</span>
</div>

<style>
	.pager {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: var(--space-4);
		padding: 10px var(--space-6);
		border-top: 1px solid var(--bd2);
	}
	.side {
		min-width: 0;
	}
	/* The size switcher sits at the right edge while the page controls stay
	   centred on the table, which is what the 1fr sides are for. */
	.side.end {
		display: flex;
		justify-content: flex-end;
	}
	.nav {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.page-step {
		background: none;
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		color: var(--fg2);
		cursor: pointer;
		font-size: var(--text-md);
		line-height: 1;
		padding: 4px 10px;
	}
	.page-step:hover:not(:disabled) {
		border-color: var(--blue);
		color: var(--fg1);
	}
	.page-step:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.page-of {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg2);
		font-family: var(--font-mono);
	}
	.page-range {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
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
