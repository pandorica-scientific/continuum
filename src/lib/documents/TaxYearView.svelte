<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// The Tax years tab, two ways. HOUSEHOLD: one grid, years down, countries
	// across, everybody folded into each cell — the whole career reads as one
	// shape, and an empty column says at a glance where you never had to file.
	// PER PERSON: a card each, a lane per country on the same years, so the
	// hand-off from one country to the next reads as one lane ending where the
	// next begins.
	//
	// NOT a dossier. A card here is drawn rather than stored, so nothing can
	// point a `lane_id` at it; what puts a document on a cell is what the
	// document says — its type, its period, its country, and who it names. That
	// is also why a joint return fills two people's cells from one file.
	//
	// The parts are the dossier's own — emoji tile, chips, N/M count, 28px cells,
	// the pressed cell listing its paper — because two card shapes on one shelf
	// would read as two products.
	import { enhance } from '$app/forms';
	import { countryName, countryOptions, flagEmoji } from '$lib/countries';
	import { submitAction } from '$lib/actions/result';
	import Segmented from '$lib/components/Segmented.svelte';
	import PeriodListing from '$lib/statements/PeriodListing.svelte';
	import type { TaxYearCardPayload, TaxYearsPayload } from '$lib/server/documents/tax-years';

	let {
		years,
		view,
		thisYear,
		onopen,
		onview
	}: {
		years: TaxYearsPayload;
		view: 'household' | 'person';
		/** One reading of the current year, from the page, so a card and its form agree. */
		thisYear: number;
		onopen: (id: string) => void;
		onview: (view: 'household' | 'person') => void;
	} = $props();

	const cardAt = (year: number, country: string): TaxYearCardPayload | undefined =>
		years.cards.find((c) => c.year === year && c.country === country);

	/** What a filled household cell would list, for the count it carries. */
	function paperCount(card: TaxYearCardPayload | undefined): number {
		if (!card) return 0;
		const ids = new Set(card.rows.flatMap((r) => r.documents.map((d) => d.id)));
		return ids.size + card.supporting.length;
	}

	const initials = (name: string) =>
		name
			.split(/\s+/)
			.filter(Boolean)
			.map((w) => [...w][0]?.toUpperCase() ?? '')
			.join('')
			.slice(0, 2) || '?';

	const filedCount = $derived(years.grid.cells.filter((c) => c.state === 'filed').length);
	const missingCount = $derived(
		years.grid.cells.filter((c) => c.state === 'gap' || c.state === 'partial').length
	);

	// One pressed cell at a time, the way a dossier lane opens one period. The
	// key carries the person where the per-person view pressed it, so the panel
	// lists their paper and offers to take THEM off the return.
	let open = $state<{ year: number; country: string; personId: string | null } | null>(null);
	const isOpen = (year: number, country: string, personId: string | null = null) =>
		open?.year === year && open.country === country && open.personId === personId;
	function press(year: number, country: string, personId: string | null = null) {
		open = isOpen(year, country, personId) ? null : { year, country, personId };
	}
	const openCard = $derived(open ? cardAt(open.year, open.country) : undefined);
	const openDocuments = $derived.by(() => {
		if (!open || !openCard) return [];
		const who = open.personId;
		const rows = who ? openCard.rows.filter((r) => r.personId === who) : openCard.rows;
		// A joint return sits on two rows; list it once.
		const all = [...rows.flatMap((r) => r.documents), ...openCard.supporting];
		return all.filter((d, i) => all.findIndex((x) => x.id === d.id) === i);
	});
	const personName = (card: TaxYearCardPayload, personId: string | null) =>
		card.rows.find((r) => r.personId === personId)?.personName ?? '';

	// Drag-and-drop: DossierView's protocol exactly — the id travels as
	// `text/plain` and the drop posts a FormData through `submitAction`. A
	// household cell files a return for everyone who owes it, which is what a
	// joint return is; a person's cell files it for them alone.
	let overKey = $state<string | null>(null);
	const key = (year: number, country: string, personId: string | null = null) =>
		`${year}-${country}-${personId ?? 'all'}`;
	function dragOver(event: DragEvent, k: string) {
		if (!event.dataTransfer?.types.includes('text/plain')) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		overKey = k;
	}
	function dragLeave(k: string) {
		if (overKey === k) overKey = null;
	}
	async function drop(event: DragEvent, year: number, country: string, personIds: string[]) {
		event.preventDefault();
		const documentId = event.dataTransfer?.getData('text/plain');
		overKey = null;
		if (!documentId) return;
		const body = new FormData();
		body.set('documentId', documentId);
		body.set('year', String(year));
		body.set('country', country);
		for (const id of personIds) body.append('personId', id);
		await submitAction('/documents?/assignTaxYear', body);
	}

	/** Five words for five states. "not due yet" is not "not filed". */
	const STATE_WORD: Record<string, string> = {
		filed: 'filed',
		partial: 'partly filed',
		gap: 'not filed',
		open: 'not due yet',
		none: 'nothing owed'
	};
</script>

<div class="strip">
	<Segmented
		options={[
			{ value: 'household', label: 'Household' },
			{ value: 'person', label: 'Per person' }
		]}
		value={view}
		onchange={(value) => onview(value as 'household' | 'person')}
	/>
	{#if years.grid.countries.length > 0}
		<span class="quiet">
			{years.grid.countries.length}
			{years.grid.countries.length === 1 ? 'country' : 'countries'} · {filedCount} filed ·
			<span class:short={missingCount > 0}>{missingCount} missing</span>
		</span>
	{/if}
</div>

{#if years.unplacedOrganisations.length > 0}
	<!-- A role period the derivation cannot place. Said out loud, because the
	     alternative is silently drawing fewer cells than the household is owed
	     and letting a missing return look like nothing is missing. -->
	<p class="quiet unplaced">
		No country yet for
		{#each years.unplacedOrganisations as org, i (org.id)}{i > 0 ? ', ' : ''}<strong
				>{org.name}</strong
			>{/each}
		— set it on the employer's card (⋯ on the Employers tab) and its years appear here.
	</p>
{/if}

{#if years.cards.length === 0}
	<div class="empty">
		<p class="empty-title">No tax years yet.</p>
		<!-- Nothing is guessed. A default country would be wrong for anyone filing
		     in two, the same reason a payslip's currency is detected, not assumed. -->
		<p class="quiet">
			A year appears here once an employer says which country it is in, or once something is filed.
			Or add the first year by hand.
		</p>
		{@render addYear()}
	</div>
{:else if view === 'household'}
	<!-- One grid. A row per year, a column per country; the cell is everybody. -->
	<section class="card">
		<div class="card-head">
			<span class="emoji" aria-hidden="true">🏛️</span>
			<h3>Annual returns</h3>
			<span class="mono chip">household</span>
			<span class="mono card-count" class:alert={missingCount > 0}>
				{filedCount} filed · {missingCount} missing
			</span>
		</div>
		<div class="lane">
			<div class="scroll">
				<div class="grid" style:--columns={years.grid.countries.length}>
					<span></span>
					{#each years.grid.countries as country (country)}
						<span class="mono cell-head">
							<span aria-hidden="true">{flagEmoji(country)}</span>
							{countryName(country)}
						</span>
					{/each}
					{#each years.grid.years as year (year)}
						<span class="mono year">{year}</span>
						{#each years.grid.countries as country (country)}
							{@const cell = years.grid.cells.find((c) => c.year === year && c.country === country)}
							{@const card = cardAt(year, country)}
							{#if !cell || cell.state === 'none'}
								<span class="cell none" role="img" aria-label="Nothing owed: {year} {country}"
								></span>
							{:else}
								<div
									class="cell {cell.state}"
									role="group"
									class:over={overKey === key(year, country)}
									ondragover={(e) => dragOver(e, key(year, country))}
									ondragleave={() => dragLeave(key(year, country))}
									ondrop={(e) => drop(e, year, country, card?.rows.map((r) => r.personId) ?? [])}
								>
									<button
										type="button"
										class="face"
										class:open={isOpen(year, country)}
										onclick={() => press(year, country)}
										aria-label="{STATE_WORD[cell.state]}: {year} {countryName(country)}"
									>
										{#if cell.state === 'partial'}
											<span class="mono many">{cell.filed}/{cell.owed}</span>
										{:else if cell.state === 'filed' && paperCount(card) > 1}
											<span class="mono many">{paperCount(card)}</span>
										{/if}
									</button>
								</div>
							{/if}
						{/each}
					{/each}
				</div>
			</div>

			{#if open && !open.personId && openCard}
				{@render panel(openCard, null)}
			{/if}
		</div>
	</section>
	{@render addYear()}
{:else}
	<!-- A card per person, a lane per country, on one time axis. -->
	<div class="cards">
		{#each years.byPerson as person (person.personId)}
			<section class="card">
				<div class="card-head">
					<span class="emoji initials" aria-hidden="true">{initials(person.personName)}</span>
					<h3>{person.personName}</h3>
					<span class="mono chip">
						{person.lanes.length}
						{person.lanes.length === 1 ? 'country' : 'countries'}
					</span>
					<span class="mono card-count" class:alert={person.lanes.some((l) => l.gaps > 0)}>
						{person.lanes.reduce((n, l) => n + l.filed, 0)} filed ·
						{person.lanes.reduce((n, l) => n + l.gaps, 0)} missing
					</span>
				</div>
				{#each person.lanes as lane (lane.country)}
					<div class="lane">
						<div class="lane-head">
							<span class="lane-label">
								<span aria-hidden="true">{flagEmoji(lane.country)}</span>
								{countryName(lane.country)}
							</span>
							<span class="quiet lane-cadence">yearly</span>
							<span class="mono lane-count" class:short={lane.gaps > 0}>
								{lane.filed}/{lane.filed + lane.gaps}
							</span>
						</div>
						<div class="scroll">
							<div class="cells" style:--columns={lane.cells.length}>
								{#each lane.cells as cell (cell.year)}
									<span class="mono cell-head">{cell.year}</span>
								{/each}
								{#each lane.cells as cell (cell.year)}
									{#if cell.state === 'none'}
										<span class="cell none" role="img" aria-label="Nothing owed"></span>
									{:else}
										<div
											class="cell {cell.state}"
											role="group"
											class:over={overKey === key(cell.year, lane.country, person.personId)}
											ondragover={(e) => dragOver(e, key(cell.year, lane.country, person.personId))}
											ondragleave={() => dragLeave(key(cell.year, lane.country, person.personId))}
											ondrop={(e) => drop(e, cell.year, lane.country, [person.personId])}
										>
											<button
												type="button"
												class="face"
												class:open={isOpen(cell.year, lane.country, person.personId)}
												onclick={() => press(cell.year, lane.country, person.personId)}
												aria-label="{STATE_WORD[cell.state]}: {cell.year} {countryName(
													lane.country
												)}, {person.personName}"
											></button>
										</div>
									{/if}
								{/each}
							</div>
						</div>
						{#if open && open.personId === person.personId && open.country === lane.country && openCard}
							{@render panel(openCard, person.personId)}
						{/if}
					</div>
				{/each}
			</section>
		{/each}
	</div>
	{@render addYear()}
{/if}

{#snippet panel(card: TaxYearCardPayload, personId: string | null)}
	<!-- The pressed cell, opened: its paper, and the two corrections that belong
	     to exactly this year and country — never a button on every row. -->
	<div class="panel">
		{#if openDocuments.length > 0}
			<PeriodListing
				title="{card.year} · {countryName(card.country)}"
				subtitle={personId
					? personName(card, personId)
					: card.rows.map((r) => r.personName).join(', ')}
				documents={openDocuments}
				{onopen}
				onclose={() => (open = null)}
			/>
		{:else}
			<p class="quiet none-yet">
				Nothing filed for {card.year} · {countryName(card.country)}
				{personId ? `by ${personName(card, personId)}` : ''} yet. Drop the return on the cell, or the
				report behind it on the card.
			</p>
		{/if}
		<div class="corrections">
			<form method="POST" action="?/dismissTaxYear" use:enhance>
				<input type="hidden" name="year" value={card.year} />
				<input type="hidden" name="country" value={card.country} />
				{#if personId}
					<input type="hidden" name="personId" value={personId} />
					<button type="submit" class="btn small">
						{personName(card, personId)} is not on this return
					</button>
				{:else}
					<button type="submit" class="btn small">
						We do not file in {countryName(card.country)} for {card.year}
					</button>
				{/if}
			</form>
			<button type="button" class="btn small" onclick={() => (open = null)}>Close</button>
		</div>
	</div>
{/snippet}

{#snippet addYear()}
	<!-- The other half of "derive, then correct": a year for a country nothing
	     else points at. -->
	<form method="POST" action="?/addTaxYear" use:enhance class="add-year">
		<span class="eyebrow">Add a tax year</span>
		<input type="number" name="year" min="1900" max="2200" value={thisYear} aria-label="Year" />
		<select name="country" aria-label="Country">
			{#each countryOptions() as c (c.code)}
				<option value={c.code} selected={c.code === years.knownCountries[0]}>{c.name}</option>
			{/each}
		</select>
		<button type="submit" class="btn">Add</button>
	</form>
{/snippet}

<style>
	.strip {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		margin-bottom: var(--space-6);
	}
	.short,
	.card-count.alert {
		color: var(--red);
	}
	.unplaced {
		margin: 0 0 var(--space-6);
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	/* The dossier card's geometry, to the pixel. */
	.card {
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--surface);
		overflow: hidden;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-6) var(--space-7);
		border-bottom: 1px solid var(--bd);
	}
	.card-head h3 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
	}
	.emoji {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-lg);
		background: var(--surface-2);
		font-size: var(--text-xl);
		line-height: 1;
		flex: none;
	}
	.emoji.initials {
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--fg2);
	}
	.chip {
		font-size: var(--text-2xs);
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 1px 8px;
	}
	.card-count {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.lane {
		padding: 10px 14px;
		border-top: 1px solid var(--bd);
	}
	.lane:first-of-type {
		border-top: 0;
	}
	.lane-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-5);
		padding-bottom: var(--space-4);
	}
	.lane-label {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.lane-cadence {
		font-size: var(--text-xs);
	}
	.lane-count {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.lane-count.short {
		color: var(--red);
	}
	.scroll {
		overflow-x: auto;
		overscroll-behavior: contain;
	}
	/* The household grid: a year column, then one column per country. */
	.grid {
		display: grid;
		grid-template-columns: 56px repeat(var(--columns), minmax(120px, 1fr));
		gap: 3px 10px;
		align-items: center;
		min-width: 320px;
	}
	.cells {
		display: grid;
		grid-template-columns: repeat(var(--columns), minmax(44px, 1fr));
		gap: 3px;
		min-width: 320px;
	}
	.cell-head {
		font-size: var(--text-2xs);
		color: var(--fg3);
		text-align: center;
		padding-bottom: var(--space-2);
		white-space: nowrap;
	}
	.year {
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.cell {
		height: 28px;
	}
	.cell.over {
		outline: 2px solid var(--blue);
		outline-offset: 1px;
		border-radius: var(--radius-sm);
	}
	.face {
		display: grid;
		place-items: center;
		width: 100%;
		height: 28px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--fg2);
		font-size: var(--text-2xs);
		cursor: pointer;
	}
	.cell.filed .face {
		border-color: var(--bd2);
		background: var(--card3);
	}
	.cell.filed .face:hover {
		background: var(--card2);
	}
	.cell.partial .face {
		border-color: var(--yellow);
		background: color-mix(in srgb, var(--yellow) 10%, transparent);
	}
	.cell.gap .face {
		border-color: var(--red);
	}
	.cell.open .face {
		border: 1px dashed var(--bd2);
	}
	.face.open {
		border-color: var(--fg3);
	}
	.cell.none {
		display: block;
		height: 28px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-sm);
		opacity: 0.35;
	}
	.many {
		line-height: 1;
	}
	.panel {
		margin-top: var(--space-5);
	}
	.none-yet {
		margin: 0;
		padding: var(--space-4) 0;
	}
	.corrections {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
		padding-top: var(--space-4);
	}
	.add-year {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-top: var(--space-6);
	}
	.empty {
		padding: var(--space-8);
		text-align: center;
	}
	.empty-title {
		margin: 0 0 var(--space-5);
	}
</style>
