<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// What a shelf is for, how it is arranged, and whether it is complete.
	//
	// A shelf used to say its name and its count, which are the two things a
	// person can already see. The two it could not say are why they would open
	// it and whether anything is missing — and absence has no row, so a list can
	// never show it. That is what this is for.
	//
	// It decides nothing: the blurb comes off the profile and the three figures
	// off the server.
	//
	// Its height is FIXED rather than measured. Both the blurb and the stat
	// labels wrap to different line counts on different shelves, so a banner
	// that sized itself moved the toolbar and the list every time you changed
	// shelf — under the cursor you were about to click with.
	import { bannerStats, type BannerFacts } from '$lib/documents/banner';
	import { shelfProfile } from '$lib/shelf-profiles';

	let {
		shelfKey,
		label,
		emoji,
		system,
		facts,
		emptyHint
	}: {
		shelfKey: string;
		label: string;
		emoji: string;
		system: boolean;
		/**
		 * Everything the banner states, including the count in its header.
		 *
		 * The header used to take `data.total`, which is what the CURRENT FILTER
		 * leaves — so a shelf holding three statements announced "0 documents"
		 * beside a figure reading "3 statements". Two queries answering one
		 * question is two chances to be wrong; this is the one.
		 */
		facts: BannerFacts;
		/** Stands in as the blurb for a shelf the registry does not know. */
		emptyHint: string | null;
	} = $props();

	const profile = $derived(shelfProfile(shelfKey));
	const stats = $derived(bannerStats(shelfKey, facts));

	// A shelf somebody made has no prose written for it and never will, so it
	// borrows the one line that already names the paper that belongs there.
	const blurb = $derived(profile?.blurb ?? emptyHint ?? '');
	const answers = $derived(profile?.answers ?? 'what is filed here?');

	/**
	 * Only the FIGURE takes the hue, never the label beneath it.
	 *
	 * A coloured label reads as a category — a kind of thing — where a coloured
	 * number reads as a state. The pill in the list beside it works the same way.
	 */
	const TONE: Record<string, string> = {
		plain: 'var(--fg1)',
		note: 'var(--purple)',
		warn: 'var(--yellow)',
		alert: 'var(--red)'
	};
</script>

<section class="banner" aria-label="{label} shelf">
	<div class="top">
		<div class="identity">
			<span class="emoji" aria-hidden="true">{emoji}</span>
			<div class="naming">
				<div class="titleline">
					<h2>{label}</h2>
					{#if system}
						<span class="chip">System shelf</span>
					{/if}
					<span class="mono count">{facts.documents}</span><span class="count-label">
						{facts.documents === 1 ? 'document' : 'documents'}
					</span>
				</div>
				{#if blurb}<p class="blurb">{blurb}</p>{/if}
			</div>
		</div>

		<div class="stats">
			{#each stats as stat (stat.label)}
				<div class="stat">
					<span class="mono value" style:color={TONE[stat.tone]}>{stat.value}</span>
					<span class="stat-label">{stat.label}</span>
				</div>
			{/each}
		</div>
	</div>

	<div class="footer">
		<span class="answers">Answers · {answers}</span>
	</div>
</section>

<style>
	.banner {
		border: 1px solid var(--bd);
		border-radius: var(--radius-xl);
		background: var(--card);
		overflow: hidden;
	}
	.top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		padding: 16px 18px;
	}
	.identity {
		display: flex;
		gap: var(--space-6);
		min-width: 0;
	}
	.emoji {
		font-size: 26px;
		line-height: 1.2;
	}
	.naming {
		min-width: 0;
	}
	.titleline {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-5);
	}
	h2 {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.chip {
		font-size: var(--text-xs);
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 2px 8px;
	}
	.count {
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.count-label {
		font-size: var(--text-sm);
		color: var(--fg3);
		margin-left: -2px;
	}
	.blurb {
		margin: var(--space-4) 0 0;
		max-width: 62ch;
		font-size: var(--text-base);
		line-height: 1.5;
		color: var(--fg2);
		/* FOUR LINES, always. Not a floor — a fixed box.
		   The banner has to be one height across every shelf, or moving between
		   them shifts the toolbar and the list under the cursor. Matching the
		   copy lengths got them close and could not finish the job: at a given
		   width a 214-character blurb still wraps to four lines where a
		   191-character one wraps to three, and no amount of editing removes
		   that at EVERY width. So the space is reserved instead of measured.
		   `tests/unit/shelf-banner` keeps every blurb short enough to fit. */
		height: 6em;
		overflow: hidden;
	}
	.stats {
		display: flex;
		gap: var(--space-6);
		flex-shrink: 0;
	}
	.stat {
		min-width: 108px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.stat-label {
		/* The second thing that made the banner jump. "expired, 30-day window
		   running" wraps to two lines and "accounts" does not, so Identity's
		   tiles stood taller than Statements'. Two lines are reserved either
		   way, which also keeps the three tiles on one shelf equal to each
		   other. */
		height: 2.4em;
	}
	.value {
		font-size: var(--text-2xl);
		font-weight: 600;
		white-space: nowrap;
	}
	.stat-label {
		font-size: var(--text-xs);
		line-height: 1.2;
		color: var(--fg3);
	}
	.footer {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-3) var(--space-5);
		padding: 10px 18px;
		border-top: 1px solid var(--bd);
	}
	.answers {
		font-size: var(--text-base);
		color: var(--fg3);
	}
	@media (max-width: 1100px) {
		.top {
			flex-direction: column;
		}
		.stats {
			width: 100%;
		}
		.stat {
			flex: 1;
			min-width: 0;
		}
	}

	/* Below this the banner is competing with the archive rather than framing
	   it: the blurb was running to five lines of body text and the footer put
	   its two halves on separate rows. Everything steps down one size, the
	   figures stay legible because they are what a glance is for. */
	@media (max-width: 760px) {
		.top {
			gap: var(--space-6);
			padding: 14px;
		}
		.emoji {
			font-size: var(--text-3xl);
		}
		h2 {
			font-size: var(--text-xl);
		}
		.blurb {
			font-size: var(--text-sm);
			line-height: 1.45;
			/* More lines at a smaller size: the same reserved box, sized for a
			   width where every blurb wraps further. */
			height: 8.7em;
		}
		.stat {
			min-width: 0;
			padding: 10px;
		}
		.value {
			font-size: var(--text-xl);
		}
		.footer {
			padding: 10px 14px;
		}
	}
</style>
