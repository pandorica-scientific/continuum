<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The ‹ › nav shared by every screen that pages a long list. `PageSize` is
	// the separate size control and sits above the rows, not beside this.
	//
	// Local state rather than the URL, matching the rest of these screens'
	// view state (open year, person filter) — mixing local and URL state would
	// make a shared link restore only half a view.
	let {
		page = $bindable(),
		pages,
		range,
		bare = false
	}: {
		page: number;
		pages: number;
		/** What the current page covers, e.g. "2019–2023" or "1–5 of 23". */
		range: string;
		/** Drop the top rule — for a list of cards, which has no table foot to seat it against. */
		bare?: boolean;
	} = $props();
</script>

<div class="pager" class:bare>
	<span class="nav">
		<button
			type="button"
			class="page-step"
			disabled={page === 0}
			aria-label="Previous page"
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
			aria-label="Next page"
			onclick={() => (page = Math.min(pages - 1, page + 1))}>›</button
		>
	</span>
</div>

<style>
	.pager {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: var(--space-4);
		padding: 10px var(--space-6);
		border-top: 1px solid var(--bd2);
	}
	.pager.bare {
		border-top: 0;
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
		padding: var(--space-2) var(--space-5);
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
</style>
