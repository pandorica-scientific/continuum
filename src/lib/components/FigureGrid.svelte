<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * A row of figures where some can be corrected in place.
	 *
	 * NOT a `SummaryBand`, and the difference is the pencil. A summary tile is
	 * read; these are read AND written, because two of a property's figures — what
	 * it is worth and what was paid for it — are stored on the record rather than
	 * computed from the loans and the tenancy, and the place to correct a figure
	 * is where it is wrong. Forcing them through `MetricTile` would mean either
	 * losing the edit or giving every tile in the app a form it never uses.
	 *
	 * The geometry is `MetricTile`'s, to the pixel, so a screen carrying both
	 * kinds reads as one row.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';

	export interface Figure {
		label: string;
		value: string;
		note?: string;
		/** A token. Only where the figure is a state, never for decoration. */
		color?: string;
		/** Present on the figures the record actually stores. */
		edit?: { field: string; amount: string; valuedOn?: string | null };
	}

	let {
		figures,
		recordId,
		action,
		recordField = 'propertyId',
		onsaved
	}: {
		figures: Figure[];
		/** Posted as a hidden field so the action knows which record to write. */
		recordId: string;
		action: string;
		recordField?: string;
		onsaved?: SubmitFunction;
	} = $props();

	let editing = $state<string | null>(null);

	const saved: SubmitFunction = (input) => {
		const inner = onsaved?.(input);
		return async (result) => {
			editing = null;
			if (typeof inner === 'function') await inner(result);
			else await result.update();
		};
	};
</script>

<div class="figures">
	{#each figures as figure (figure.label)}
		<div class="figure">
			<span class="f-label">
				{figure.label}
				{#if figure.edit}
					<!-- Only on the figures the record actually stores. The rest are
					     computed, and a pencil on those would offer an edit the next
					     recompute discards. -->
					<button
						type="button"
						class="pencil"
						aria-label="Edit {figure.label}"
						onclick={() => (editing = editing === figure.label ? null : figure.label)}
					>
						✏️
					</button>
				{/if}
			</span>
			{#if figure.edit && editing === figure.label}
				<!-- Save and Cancel replace the value they are editing, which is where
				     the pencil was. -->
				<form method="POST" {action} use:enhance={saved} class="f-form">
					<input type="hidden" name={recordField} value={recordId} />
					<input type="hidden" name="field" value={figure.edit.field} />
					<input name="amount" inputmode="decimal" value={figure.edit.amount} />
					{#if figure.edit.valuedOn !== undefined}
						<input name="valuedOn" type="date" value={figure.edit.valuedOn ?? ''} />
					{/if}
					<div class="f-actions">
						<button type="submit" class="btn btn-primary">Save</button>
						<button type="button" class="btn" onclick={() => (editing = null)}>Cancel</button>
					</div>
				</form>
			{:else}
				<span class="mono f-value" style:color={figure.color}>{figure.value}</span>
			{/if}
			{#if figure.note}<span class="f-note">{figure.note}</span>{/if}
		</div>
	{/each}
</div>

<style>
	.figures {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: var(--space-6);
	}
	.figure {
		background: var(--card);
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		padding: var(--space-6) var(--space-7);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.f-label {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.f-value {
		font-size: var(--text-2xl);
		font-weight: 600;
	}
	.f-note {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.pencil {
		background: none;
		border: 0;
		padding: 0 0 0 4px;
		cursor: pointer;
		font-size: var(--text-2xs);
		opacity: 0.65;
	}
	.pencil:hover {
		opacity: 1;
	}
	.f-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: 4px 0;
	}
	.f-actions {
		display: flex;
		gap: var(--space-3);
	}
</style>
