<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The ‹ › nav, shared by every screen that pages a long list — the Tax and
	// Salary tables and the Rules list — so they cannot drift apart. The size
	// control is `PageSize`, and sits ABOVE the rows rather than beside this.
	//
	// Unlike the transactions pager this is local state rather than the URL: the
	// rest of these screens' view — the open year, the person filter — is local
	// too, and putting one of them in the address bar and not the others would
	// make a shared link restore half a view.
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
		/**
		 * Drop the top rule.
		 *
		 * It exists to seat the pager at the foot of a bordered table. A list of
		 * separate cards has no such foot, and the line would double up with the
		 * card's own border.
		 */
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
</style>
