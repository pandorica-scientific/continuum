<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	//
	// A 36px button showing the chosen emoji, and behind it a fixed grid of the
	// emoji a household actually files things under plus a two-character field
	// for the twenty-fifth.
	//
	// A popover rather than an always-open grid: on the settings list the grid
	// lives in the row the shelf occupies, and an inline 24-cell grid under
	// every add or rename row turned a one-line control into a tall block.
	//
	// No external picker — this ships self-hosted and must not depend on a CDN —
	// and no OS picker either: a Linux box may not have one reachable. The field
	// covers everything the grid does not, without shipping an emoji database.
	//
	// 24 cells at 6 × 36px is 236px wide, so the grid never scrolls.
	const CHOICES = [
		'🗂️',
		'🏠',
		'🚗',
		'🏦',
		'🩺',
		'🪪',
		'🔧',
		'💼',
		'📄',
		'🧾',
		'📬',
		'🐕',
		'🎓',
		'✈️',
		'⚡',
		'💧',
		'🔥',
		'🌱',
		'👶',
		'🛡️',
		'📷',
		'🎟️',
		'🧰',
		'⚖️'
	];

	let {
		value = $bindable('🗂️'),
		name,
		dashed = false
	}: {
		value?: string;
		name?: string;
		/** The add row's empty state: a dashed square that reads as "pick one". */
		dashed?: boolean;
	} = $props();

	let open = $state(false);
</script>

{#if name}<input type="hidden" {name} {value} />{/if}

<div class="picker">
	<button
		type="button"
		class="trigger"
		class:dashed
		aria-label="Choose an emoji"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		{value}
	</button>

	{#if open}
		<div class="pop">
			<div class="grid">
				{#each CHOICES as choice (choice)}
					<button
						type="button"
						class="cell"
						class:active={value === choice}
						aria-label={choice}
						onclick={() => {
							value = choice;
							open = false;
						}}
					>
						{choice}
					</button>
				{/each}
			</div>
			<div class="own">
				<input
					maxlength="2"
					bind:value
					aria-label="Or paste any character"
					placeholder="or paste any"
				/>
				<button
					type="button"
					class="btn small"
					onclick={() => {
						value = '🗂️';
						open = false;
					}}>Clear</button
				>
			</div>
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		flex: none;
	}
	.trigger {
		width: 36px;
		height: var(--control-h);
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		background: var(--card);
		font-size: var(--text-xl);
		line-height: 1;
		cursor: pointer;
	}
	.trigger.dashed {
		border-style: dashed;
		border-color: var(--bd2);
	}
	.trigger:hover {
		background: var(--card2);
	}
	.pop {
		position: absolute;
		left: 0;
		top: 40px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-5);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-lg);
		background: var(--bg2);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(6, 36px);
		gap: var(--space-3);
	}
	.cell {
		width: 36px;
		height: var(--control-h);
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		background: var(--card);
		font-size: var(--text-xl);
		line-height: 1;
		cursor: pointer;
	}
	.cell:hover {
		background: var(--card2);
	}
	.cell.active {
		background: var(--card3);
		border-color: var(--bd2);
	}
	.own {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.own input {
		width: 120px;
		height: var(--control-h);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--fg1);
		padding: 0 10px;
		font-size: var(--text-md);
	}
</style>
