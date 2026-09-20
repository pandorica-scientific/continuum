<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// The same shelf, read one year at a time.
	//
	// The Timeline answers "how did this career move"; this answers "what about
	// 2024". They are two readings of one derivation, not two features: every card
	// here puts the income that year on the left and the returns it produced on
	// the right, so the arrow the Timeline draws once is restated on every row.
	//
	// The recent years stand open because they are the ones still actionable. The
	// older ones collapse to a line that says what is missing and nothing else —
	// a shelf of identical expanded cards is a wall, and a household looking for
	// 2021 is looking for one fact about it.
	import Icon from '$lib/components/Icon.svelte';
	import { countryName, flagEmoji } from '$lib/countries';
	import { countryHues } from '$lib/tax-hues';
	import { householdResidence } from '$lib/tax-residence';
	import { MONTHS } from '$lib/documents/dossier-cells';
	import { INCOME_KINDS } from '$lib/documents/templates';
	import { cardPaper, cardState, paperCount, returnKindWords } from '$lib/documents/tax-years';
	import ObligationPanel from '$lib/documents/ObligationPanel.svelte';
	import type { DossierCard, DossierPayload } from '$lib/server/documents/dossier-load';
	import type { TaxYearCardPayload, TaxYearsPayload } from '$lib/server/documents/tax-years';

	let {
		dossier,
		years,
		people,
		thisYear,
		onopen
	}: {
		dossier: DossierPayload;
		years: TaxYearsPayload;
		people: { id: string; name: string }[];
		thisYear: number;
		onopen: (id: string) => void;
	} = $props();

	/** How many years stand open before the rest become lines. */
	const OPEN_YEARS = 4;

	/**
	 * Every year, newest first — the SAME span the Timeline draws.
	 *
	 * Widened past the years that owe a return by any year a role period covers,
	 * because a year still running owes nothing yet and would otherwise drop out
	 * of a screen whose whole job is to show what is still open.
	 */
	const axis = $derived.by(() => {
		const worked = dossier.cards.flatMap((card) =>
			card.roles.flatMap((role) => {
				if (role.startsOn === null) return [];
				const from = Number(role.startsOn.slice(0, 4));
				const to = Math.min(role.endsOn ? Number(role.endsOn.slice(0, 4)) : thisYear, thisYear);
				const run: number[] = [];
				for (let year = from; year <= to; year++) run.push(year);
				return run;
			})
		);
		const known = [...new Set([...years.grid.years, ...worked])].sort((a, b) => b - a);
		return known.length > 0 ? known : [thisYear];
	});

	const hueFor = $derived(
		countryHues([...years.grid.countries, ...dossier.cards.map((c) => c.country)])
	);

	/** Nothing earns and nothing is owed — the same test the Timeline makes. */
	const bare = $derived(dossier.cards.length === 0 && years.cards.length === 0);

	/** Which collapsed years the reader has opened by hand. */
	let unfolded = $state<number[]>([]);
	const isOpen = (year: number, index: number) => index < OPEN_YEARS || unfolded.includes(year);
	const unfold = (year: number) => (unfolded = [...unfolded, year]);

	// ---- What earned, that year ----

	/** Whether a role period on this card covered any part of the year. */
	function covered(card: DossierCard, year: number): boolean {
		return card.roles.some((role) => {
			const from = role.startsOn ? Number(role.startsOn.slice(0, 4)) : null;
			const to = role.endsOn ? Number(role.endsOn.slice(0, 4)) : thisYear;
			return from !== null && from <= year && year <= to;
		});
	}

	/**
	 * Cards with dated periods over the year, and cards with none at all.
	 *
	 * The second group is the honest half: an employer whose dates nobody recorded
	 * may well have been the whole year, and the card says so as a dashed chip
	 * rather than being left out and making the year look emptier than it was.
	 */
	const sources = $derived(
		dossier.cards.filter((card) => card.id !== null && INCOME_KINDS.has(card.kind))
	);
	/** Year-independent, so worked out once rather than per card. */
	const undatedSources = $derived(
		sources.filter((card) => card.roles.every((role) => role.startsOn === null))
	);

	function earning(year: number): { dated: DossierCard[]; undated: DossierCard[] } {
		return { dated: sources.filter((card) => covered(card, year)), undated: undatedSources };
	}

	/** "from Oct" where a role period started inside the year; nothing where it ran through. */
	function startedIn(card: DossierCard, year: number): string | null {
		const inside = card.roles
			.map((role) => role.startsOn)
			.filter((day): day is string => day !== null && Number(day.slice(0, 4)) === year)
			.sort();
		if (inside.length === 0) return null;
		return `from ${MONTHS[Number(inside[0].slice(5, 7)) - 1]}`;
	}

	/**
	 * The months of a year no dated role period covers.
	 *
	 * Where something undated is also in play, this is what it probably filled —
	 * and naming the months is what turns "dates missing" into a question somebody
	 * can answer.
	 */
	function uncovered(year: number): string | null {
		const held = dossier.cards.flatMap((card) =>
			card.roles.flatMap((role) => {
				if (role.startsOn === null) return [];
				const from = Number(role.startsOn.slice(0, 4));
				const to = role.endsOn ? Number(role.endsOn.slice(0, 4)) : thisYear;
				if (from > year || to < year) return [];
				const first = from === year ? Number(role.startsOn.slice(5, 7)) : 1;
				const last = role.endsOn && to === year ? Number(role.endsOn.slice(5, 7)) : 12;
				const run: number[] = [];
				for (let month = first; month <= last; month++) run.push(month);
				return run;
			})
		);
		const free = [...Array(12).keys()].map((i) => i + 1).filter((m) => !held.includes(m));
		// All twelve free is a year nothing dated touches, which the dashed chip
		// beside it already says; none free is a year fully accounted for.
		if (free.length === 0 || free.length === 12) return null;
		return `${MONTHS[free[0] - 1]}–${MONTHS[free[free.length - 1] - 1]}`;
	}

	/** Payslips filed of months expected, for the one year the shelf loaded months for. */
	function payslips(year: number): string | null {
		if (year !== dossier.year) return null;
		const lanes = sources.flatMap((card) => card.lanes.filter((l) => l.cadence === 'monthly'));
		if (lanes.length === 0) return null;
		const expected = lanes.reduce((n, lane) => n + lane.expected, 0);
		if (expected === 0) return null;
		return `payslips ${lanes.reduce((n, lane) => n + lane.filed, 0)} of ${expected}`;
	}

	// ---- What it made you owe ----

	const cardsFor = (year: number) => years.cards.filter((card) => card.year === year);

	/**
	 * What a year amounts to, in one pass: the spine's word and, for a folded
	 * year, what is missing and where. `verdict` and `line` asked the same
	 * question with the same filter and were called together on every row.
	 */
	function verdict(cards: TaxYearCardPayload[]) {
		const missing = cards.filter((card) => card.rows.some((r) => r.state === 'gap'));
		const where = missing.map((card) => countryName(card.country));
		if (cards.length === 0) return { word: 'nothing owed', tone: 'quiet', missing: 0, where };
		if (missing.length > 0)
			return {
				word: `${missing.length} never filed`,
				tone: 'bad',
				missing: missing.length,
				where
			};
		if (cards.some((card) => card.rows.some((r) => r.state === 'open')))
			return { word: 'in progress', tone: 'quiet', missing: 0, where };
		return { word: 'all filed', tone: 'good', missing: 0, where };
	}

	/** The residence chip: where they lived, or the question nothing settles. */
	function residence(year: number) {
		// The same fold the Timeline draws, from the module that owns the rule.
		return householdResidence(
			years.residences.filter((r) => r.year === year).map((r) => r.residence)
		);
	}

	/** One pressed return at a time, across every year. */
	let pressed = $state<{ year: number; country: string } | null>(null);
	const isPressed = (year: number, country: string) =>
		pressed?.year === year && pressed.country === country;
	function press(year: number, country: string) {
		pressed = isPressed(year, country) ? null : { year, country };
	}
	const openCard = $derived(
		pressed
			? years.cards.find((c) => c.year === pressed!.year && c.country === pressed!.country)
			: undefined
	);
	const openDocuments = $derived(openCard ? cardPaper(openCard) : []);
</script>

<!-- The derivation, restated once here: the left half of every card produces the
     right half. -->
{#if bare}
	<!-- The same empty shelf the Timeline describes, in this view's words: a card
	     per year over no years would be one card saying nothing owed, which reads
	     as an answer rather than as an absence. -->
	<div class="bare">
		<p class="bare-title">Nothing on this shelf yet.</p>
		<p class="quiet">
			A year appears here once somebody has a role period with an employer or a broker — its country
			decides which return is owed — or the moment something is filed for one. Add the first by hand
			on the Timeline if nothing points at one yet.
		</p>
	</div>
{:else}
	<div class="derivation">
		<span class="arrow">
			<Icon name="arrowRight" size={14} />
			the income on the left produces the return on the right — one where you were resident, plus any
			country that wants its own
		</span>
		<span class="rule"></span>
	</div>

	<div class="years">
		{#each axis as year, index (year)}
			{@const returns = cardsFor(year)}
			{@const said = verdict(returns)}
			{@const lived = residence(year)}
			{#if isOpen(year, index)}
				{@const earned = earning(year)}
				{@const months = uncovered(year)}
				{@const slips = payslips(year)}
				<section class="card" class:short={said.tone === 'bad'}>
					<div class="spine">
						<span class="mono year">{year}</span>
						<span class="verdict {said.tone}">{said.word}</span>
						{#if lived.countries.length > 0}
							<span class="res" class:unsettled={lived.state === 'unsettled'}>
								{#each lived.countries as code, i (code)}{i > 0 ? ' → ' : ''}<span
										aria-hidden="true">{flagEmoji(code)}</span
									>{/each}
								{lived.state === 'unsettled' ? 'residence?' : 'resident'}
							</span>
						{/if}
					</div>

					<div class="half income">
						<span class="eyebrow">Income that year</span>
						<div class="chips">
							{#each earned.dated as card (card.id)}
								<span class="chip" style:--hue="var({hueFor(card.country)})">
									<span aria-hidden="true">{card.emoji}</span>
									{card.name}
									<span class="quiet">{startedIn(card, year) ?? card.kind}</span>
								</span>
							{/each}
							{#each earned.undated as card (card.id)}
								<span class="chip guess">
									<span aria-hidden="true">{card.emoji}</span>
									{card.name}
									<span class="quiet">dates not recorded</span>
								</span>
							{/each}
							{#if earned.dated.length === 0 && earned.undated.length === 0}
								<span class="quiet">Nothing on record earned anything this year.</span>
							{:else if months && earned.undated.length > 0}
								<span class="chip guess">{months} · role dates not recorded</span>
							{/if}
							{#if slips}<span class="quiet">· {slips}</span>{/if}
						</div>
					</div>

					<div class="half returns">
						<span class="eyebrow">Tax returns</span>
						<div class="cells">
							{#each returns as card (card.country)}
								{@const state = cardState(card)}
								{#if state === 'open'}
									<span class="ret later">
										<span aria-hidden="true">{flagEmoji(card.country)}</span>
										not due yet
									</span>
								{:else}
									<button
										type="button"
										class="ret {state}"
										class:pressed={isPressed(year, card.country)}
										style:--hue="var({hueFor(card.country)})"
										aria-expanded={isPressed(year, card.country)}
										onclick={() => press(year, card.country)}
									>
										<span class="ret-word">
											<span aria-hidden="true">{flagEmoji(card.country)}</span>
											{#if state === 'filed'}
												{@const held = paperCount(card)}filed{held > 1 ? ` · ${held}` : ''}
											{:else if state === 'partial'}
												partly filed
											{:else}
												never filed
											{/if}
										</span>
										<span class="ret-note" class:warnword={card.returnKind === 'unclear'}>
											{returnKindWords(card.returnKind)}
										</span>
									</button>
								{/if}
							{/each}
							{#if returns.length === 0}
								<span class="quiet">Nothing owed anywhere this year.</span>
							{/if}
						</div>
					</div>
				</section>
				{#if pressed?.year === year && openCard}
					<ObligationPanel
						card={openCard}
						documents={openDocuments}
						{people}
						{onopen}
						onclose={() => (pressed = null)}
					/>
				{/if}
			{:else}
				<div class="folded">
					<span class="mono fold-year">{year}</span>
					{#if said.missing > 0}
						<span class="fold-word">
							<span class="dot" aria-hidden="true"></span>
							{said.missing}
							{said.missing === 1 ? 'return' : 'returns'} never filed
							<span class="quiet">· {said.where.join(', ')}</span>
						</span>
					{:else}
						<span class="quiet">{said.word}</span>
					{/if}
					<button
						type="button"
						class="fold-open"
						aria-label="Open {year}"
						onclick={() => unfold(year)}
					>
						<Icon name="chevronRight" size={16} />
					</button>
				</div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.derivation {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		margin-bottom: var(--space-6);
	}
	.arrow {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
		font-size: var(--text-xs);
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: var(--space-2) var(--space-6);
		background: var(--card);
	}
	.rule {
		flex-grow: 1;
		height: 1px;
		background: var(--bd);
	}
	.bare {
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--surface);
		padding: var(--space-8);
		text-align: center;
	}
	.bare-title {
		margin: 0 0 var(--space-5);
	}
	.years {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	/* Three panels in one card: the year, what earned, what it owes. The spine is
	   fixed and the returns are fixed, so the middle carries the variable width —
	   a long employer name must not squeeze the answer off the right. */
	.card {
		display: flex;
		align-items: stretch;
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--surface);
		overflow: hidden;
	}
	.card.short {
		border-color: color-mix(in srgb, var(--red) 30%, var(--bd));
	}
	.spine {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--space-2);
		width: 132px;
		flex: none;
		padding: var(--space-8);
		border-right: 1px solid var(--bd);
	}
	.year {
		font-size: 26px;
		font-weight: 500;
		letter-spacing: -0.02em;
	}
	.verdict {
		font-size: var(--text-xs);
	}
	.verdict.good {
		color: var(--green);
	}
	.verdict.bad {
		color: var(--red);
	}
	.verdict.quiet {
		color: var(--fg3);
	}
	.res {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		align-self: flex-start;
		font-size: var(--text-2xs);
		color: var(--fg2);
		background: var(--card3);
		border-radius: var(--radius-pill);
		padding: 2px 8px;
	}
	.res.unsettled {
		color: var(--yellow);
		background: var(--yellow-wash);
	}
	.half {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--space-4);
		padding: var(--space-7) var(--space-8);
		min-width: 0;
	}
	.income {
		flex-grow: 1;
	}
	.returns {
		width: 400px;
		flex: none;
		border-left: 1px solid var(--bd);
	}
	.chips,
	.cells {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		border: 1px solid color-mix(in srgb, var(--hue) 45%, transparent);
		background: color-mix(in srgb, var(--hue) 16%, transparent);
		border-radius: var(--radius-pill);
		padding: var(--space-2) 11px;
	}
	/* Dashed says the same thing it says on the Timeline: nobody recorded when. */
	.chip.guess {
		border: 1px dashed var(--bd2);
		background: transparent;
		color: var(--fg3);
	}
	.cells {
		flex-wrap: nowrap;
	}
	.ret {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		flex-grow: 1;
		min-width: 0;
		height: 42px;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		font-family: inherit;
		cursor: pointer;
	}
	.ret-word {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--fg1);
		white-space: nowrap;
	}
	.ret-note {
		font-size: 9px;
		color: var(--fg3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	.warnword {
		color: var(--yellow);
	}
	.ret.filed {
		border-color: color-mix(in srgb, var(--hue) 60%, transparent);
		background: color-mix(in srgb, var(--hue) 16%, transparent);
	}
	.ret.gap,
	.ret.partial {
		border-color: var(--red);
		background: var(--red-wash);
	}
	.ret.gap .ret-word,
	.ret.partial .ret-word {
		color: var(--red);
		font-weight: 600;
	}
	.ret.pressed {
		/* A ring, not a lift: nothing in this flow floats above its card. */
		outline: 2px solid color-mix(in srgb, var(--red) 22%, transparent);
	}
	.ret.later {
		border: 1px dashed var(--bd2);
		height: 34px;
		font-size: var(--text-xs);
		color: var(--fg3);
		display: flex;
		flex-direction: row;
		gap: var(--space-3);
		flex-grow: 1;
		align-items: center;
		justify-content: center;
	}
	/* A closed year says the one thing somebody looking for it wants to know. */
	.folded {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		height: 52px;
		padding: 0 var(--space-8);
		border: 1px solid var(--bd);
		border-radius: var(--radius-xl);
		background: var(--card);
	}
	.fold-year {
		font-size: 15px;
		color: var(--fg2);
		width: 44px;
	}
	.fold-word {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--red);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-pill);
		background: var(--red);
	}
	.fold-open {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--fg3);
		cursor: pointer;
	}
</style>
