<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Past trips, as a shelf of years read left to right.
	 *
	 * Each year is a spine standing on its end, and the open one widens between
	 * the years before it and the years after it — so the wall keeps its whole
	 * span visible and a reader can see, without scrolling, how many years there
	 * are and which one they are looking into. A stack of collapsing rows could
	 * not do that: the years below an open one are pushed off the screen by
	 * exactly the content somebody is reading.
	 *
	 * One year open at a time, on purpose. Two open years is two panels sharing
	 * the width, which is two years neither of which can show its stamps.
	 *
	 * **Below 720px it stacks.** Three spines and a panel do not fit across a
	 * phone, and a horizontal accordion squeezed to 400px is a worse version of
	 * the ordinary list it replaced.
	 */
	import TripStamp from '$lib/life/trips/TripStamp.svelte';

	interface Trip {
		id: string;
		name: string;
		emoji: string;
		startsOn: string;
		stamp: { svg: string; hue: string | null } | null;
	}

	let {
		years,
		/** Which year opens first. The newest, unless a household says otherwise. */
		initial
	}: {
		years: [year: number, trips: Trip[]][];
		initial?: number;
	} = $props();

	let open = $state<number | null>(null);
	const current = $derived(open ?? initial ?? years[0]?.[0] ?? null);

	const monthOf = (iso: string): string =>
		new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
</script>

<div class="wall">
	{#each years as [year, trips] (year)}
		{@const isOpen = year === current}
		<section class="year" class:open={isOpen}>
			<button
				class="spine"
				class:lit={isOpen}
				type="button"
				aria-expanded={isOpen}
				onclick={() => (open = isOpen ? null : year)}
			>
				<!-- The count in a pill at the top, the ordinary way round; the year
				     turned on its side down the middle, which is how a spine on a
				     shelf is written. Two rotated columns side by side was a thing to
				     decipher rather than a label. -->
				<span class="pill mono">{trips.length}</span>
				<span class="year-label mono">{year}</span>
			</button>

			{#if isOpen}
				<div class="stamps">
					{#each trips as trip (trip.id)}
						<TripStamp
							href="/trips/{trip.id}"
							name={trip.name}
							month={monthOf(trip.startsOn)}
							emoji={trip.emoji}
							art={trip.stamp}
						/>
					{/each}
				</div>
			{/if}
		</section>
	{/each}
</div>

<style>
	.wall {
		display: flex;
		align-items: stretch;
		gap: var(--space-4);
		min-height: 250px;
	}
	.year {
		display: flex;
		align-items: stretch;
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--card);
		overflow: hidden;
		flex: 0 0 auto;
		min-width: 0;
	}
	/* Wide enough for its stamps and no wider.
	   `0 1 auto`, not `1 1 auto`: growing to fill pushed the remaining years to
	   the far edge of the screen, with a stretch of empty panel between them and
	   the last stamp. Sized to content, the closed years sit just past wherever
	   the open year actually ends — and the panel still shrinks and wraps when
	   there are more stamps than the row can hold. */
	.year.open {
		flex: 0 1 auto;
	}
	/* The spine: the year standing on its end, reading bottom to top, which is
	   the way a spine on a shelf is written. */
	.spine {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-5);
		width: 52px;
		min-height: auto;
		flex: none;
		padding: var(--space-5) var(--space-3);
		border: 0;
		border-radius: 0;
		background: none;
		color: var(--fg3);
		transition:
			background-color var(--dur) var(--ease),
			color var(--dur) var(--ease);
	}
	.spine:hover {
		background: var(--surface-2);
		color: var(--fg1);
	}
	.spine.lit {
		background: var(--rose-tint);
		color: var(--rose);
	}
	/* How many trips, in a pill at the top. Horizontal: one or two digits read
	   instantly the right way up and not at all on their side. */
	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		flex: none;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-pill);
		background: var(--grey-tint);
		font-size: var(--text-2xs);
		font-weight: 600;
	}
	.spine.lit .pill {
		background: var(--rose-tint);
		color: var(--rose);
	}
	/* The year down the middle of the bar, reading bottom to top. `flex: 1` and
	   centred, so it sits in the middle of whatever height the wall has rather
	   than just under the pill. */
	.year-label {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.1em;
		writing-mode: vertical-rl;
		transform: rotate(180deg);
	}
	/* No caret. Inside a spine that is itself rotated, a chevron points in a
	   direction nobody can predict — and the lit spine already says which year
	   is open, which is one answer rather than two. */
	.stamps {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		gap: 22px 18px;
		padding: var(--space-6) 18px;
		min-width: 0;
		/* Wide content scrolls inside its own container, and a year with twenty
		   stamps is wide content. */
		overflow-y: auto;
		overscroll-behavior: contain;
		max-height: 520px;
	}

	/* A phone gets the ordinary stack: three spines and a panel do not fit
	   across 400px, and the shelf metaphor costs more there than it pays. */
	@media (max-width: 719px) {
		.wall {
			flex-direction: column;
			min-height: 0;
		}
		.year,
		.year.open {
			flex: none;
		}
		.spine {
			flex-direction: row;
			width: 100%;
			justify-content: flex-start;
			gap: var(--space-5);
			padding: var(--space-5) 14px;
		}
		.pill {
			order: 2;
			margin-left: auto;
			font-size: var(--text-xs);
		}
		/* Flat on a phone: the bar is a row, so there is nothing to stand on. */
		.year-label {
			flex: none;
			writing-mode: horizontal-tb;
			transform: none;
		}
		.stamps {
			max-height: none;
			overflow: visible;
		}
	}
</style>
