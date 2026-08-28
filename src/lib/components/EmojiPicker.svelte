<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	//
	// A fixed grid of the emoji a household actually files things under, plus a
	// two-character field for the twenty-fifth.
	//
	// No external picker — this ships self-hosted and must not depend on a CDN —
	// and no OS picker either: a Linux box may not have one reachable. The field
	// is what covers everything the grid does not, without shipping an emoji
	// database to render one character.
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

	let { value = $bindable('🗂️'), name }: { value?: string; name?: string } = $props();
</script>

{#if name}<input type="hidden" {name} {value} />{/if}

<div class="picker">
	<div class="grid">
		{#each CHOICES as choice (choice)}
			<button
				type="button"
				class="cell"
				class:active={value === choice}
				aria-label={choice}
				onclick={() => (value = choice)}
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
			placeholder="or paste any character"
		/>
		<button type="button" class="btn small" onclick={() => (value = '🗂️')}>Clear</button>
	</div>
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
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
		font-size: var(--text-md);
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
		width: 72px;
		height: var(--control-h);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--fg1);
		padding: 0 10px;
		font-size: var(--text-md);
		text-align: center;
	}
</style>
