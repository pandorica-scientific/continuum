<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// Income & Tax, as one shape: what earned, and what it made you owe.
	//
	// The two tabs this replaces asked one question each and never met. You read
	// the employers on one and the years on the other, and nothing on either said
	// that the first DECIDES the second — so a missing Czech return looked like a
	// fact about Czechia rather than a consequence of a role period somebody could
	// simply close. One axis, income above and tax below, says the derivation by
	// being drawn that way.
	//
	// THE AXIS IS SHARED. Years run across, every band uses the same columns, and
	// a span is placed with `grid-column`. That is the whole trick: a lane ending
	// where the next begins is then a fact about the picture rather than something
	// the reader has to hold in their head.
	//
	// Nothing here loads anything new. The income half is the dossier payload this
	// shelf already had; the tax half is the tax-year payload. What is new is that
	// they are on one screen, in one colour scheme, keyed by country.
	import { enhance } from '$app/forms';
	import { countryName, countryOptions, flagEmoji } from '$lib/countries';
	import { hueTokens } from '$lib/tax-hues';
	import { submitAction } from '$lib/actions/result';
	import EmploymentRecord from '$lib/documents/EmploymentRecord.svelte';
	import ObligationPanel from '$lib/documents/ObligationPanel.svelte';
	import type { DossierCard, DossierPayload } from '$lib/server/documents/dossier-load';
	import type { TaxYearCardPayload, TaxYearsPayload } from '$lib/server/documents/tax-years';

	let {
		dossier,
		years,
		people,
		thisYear,
		onopen,
		onyear
	}: {
		dossier: DossierPayload;
		years: TaxYearsPayload;
		people: { id: string; name: string }[];
		thisYear: number;
		onopen: (id: string) => void;
		onyear: (year: number) => void;
	} = $props();

	// ---- The one axis ----

	/**
	 * Every year the screen draws, oldest first.
	 *
	 * The tax half's years, widened by any year a role period covers: an employer
	 * whose country nobody has set raises no tax card, and its span would
	 * otherwise fall off the left of a grid that only knows about returns.
	 */
	const axis = $derived.by(() => {
		const known = unique([...years.grid.years, ...dossier.cards.flatMap(spanYears)]);
		return known.length > 0 ? known : [thisYear];
	});

	/** Distinct years, oldest first. Every span on this screen is built from it. */
	function unique(years_: number[]): number[] {
		return [...new Set(years_)].sort((a, b) => a - b);
	}
	const column = (year: number) => axis.indexOf(year) + 2;

	/** One hue per country, assigned by the palette that already serves the Tax screen. */
	const hues = $derived(hueTokens([...years.grid.countries, ...countriesOnCards()]));
	const hueFor = (country: string | null) => (country && hues.get(country)) || '--series-r10';

	function countriesOnCards(): string[] {
		return dossier.cards
			.map((card) => card.country)
			.filter((code): code is string => code !== null);
	}

	// ---- The income half ----

	/**
	 * The years a card's span covers, from its role periods, or failing those from
	 * where its paper landed.
	 *
	 * A relationship nobody dated still happened, and the documents prove roughly
	 * when — so the span is drawn from them and marked as a guess, rather than the
	 * row appearing with no span at all.
	 */
	function spanYears(card: DossierCard): number[] {
		const dated = card.roles.flatMap((role) => {
			if (role.startsOn === null) return [];
			const from = Number(role.startsOn.slice(0, 4));
			const to = role.endsOn ? Number(role.endsOn.slice(0, 4)) : thisYear;
			const run: number[] = [];
			for (let year = from; year <= to; year++) run.push(year);
			return run;
		});
		if (dated.length > 0) return unique(dated);
		return unique(paperDays(card).map((day) => Number(day.slice(0, 4))));
	}

	/** Every dated piece of paper on a card, whichever lane holds it. */
	function paperDays(card: DossierCard): string[] {
		return [...card.lanes.flatMap((lane) => lane.documents), ...card.history]
			.map((doc) => doc.periodOn ?? doc.addedOn)
			.filter((day): day is string => day !== null);
	}

	/** Whether any role period is still open. "Ongoing" is a fact about the paper still coming. */
	const ongoing = (card: DossierCard) =>
		card.roles.length > 0 && card.roles.some((role) => role.endsOn === null);

	/** Whether the span is a guess: no role period carries a start date. */
	const undated = (card: DossierCard) => card.roles.every((role) => role.startsOn === null);

	/** "Czechia · from Oct 2025", or "Spain · 2021–2023" once it has closed. */
	function spanWords(card: DossierCard): string {
		const place = card.country ? countryName(card.country) : 'no country set';
		const starts = card.roles
			.map((role) => role.startsOn)
			.filter((day): day is string => day !== null)
			.sort();
		if (starts.length === 0) return place;
		const MONTHS = [
			'Jan',
			'Feb',
			'Mar',
			'Apr',
			'May',
			'Jun',
			'Jul',
			'Aug',
			'Sep',
			'Oct',
			'Nov',
			'Dec'
		];
		const first = starts[0];
		const month = MONTHS[Number(first.slice(5, 7)) - 1];
		if (ongoing(card)) return `${place} · from ${month} ${first.slice(0, 4)}`;
		const span = spanYears(card);
		const last = span[span.length - 1];
		return `${place} · ${span[0]}${last === span[0] ? '' : `–${last}`}`;
	}

	/**
	 * The three bands the design names, in that order.
	 *
	 * Employers earn, brokers earn, a let property earns. Everything else on the
	 * shelf — a tax office, an insurer — is not income and gets a band of its own
	 * below the tax half, rather than being filed under a heading that would be a
	 * lie about it.
	 */
	const employment = $derived(dossier.cards.filter((c) => c.kind === 'employer'));
	const brokerage = $derived(dossier.cards.filter((c) => c.kind === 'broker'));
	const elsewhere = $derived(
		dossier.cards.filter((c) => c.id !== null && c.kind !== 'employer' && c.kind !== 'broker')
	);
	/** The implicit "Not assigned yet" card, which is a pile and not a counterparty. */
	const unassigned = $derived(dossier.cards.find((c) => c.id === null) ?? null);

	/**
	 * Nothing earns and nothing is owed.
	 *
	 * Not "no tax years": an employer with no country raises no year either, and
	 * drawing an axis over that would say the household has no history when what
	 * it has is a card nobody has finished. Both halves have to be empty.
	 */
	const bare = $derived(dossier.cards.length === 0 && years.cards.length === 0);

	/** Which record is open, at most one — the whole point of opening it in place. */
	let opened = $state<string | null>(null);
	const toggleCard = (id: string) => (opened = opened === id ? null : id);

	// ---- The tax half ----

	const cardAt = (year: number, country: string): TaxYearCardPayload | undefined =>
		years.cards.find((c) => c.year === year && c.country === country);

	/** What a filled cell would list, for the count it carries. */
	function paperCount(card: TaxYearCardPayload | undefined): number {
		if (!card) return 0;
		const ids = new Set(card.rows.flatMap((r) => r.documents.map((d) => d.id)));
		return ids.size + card.supporting.length;
	}

	/**
	 * Residence for one year, folded across the household.
	 *
	 * Two people resident in two countries is a couple living apart, not a
	 * question: only a tier that could not choose makes a year unsettled.
	 */
	type Mark = {
		countries: string[];
		state: 'proved' | 'inferred' | 'unsettled';
		words: string;
	};
	function residenceMark(year: number): Mark {
		const rows = years.residences.filter((r) => r.year === year);
		// A tier that offered a CHOICE is the year somebody moved. A person with no
		// evidence at all offered nothing, which is not the same thing — and
		// folding the two together made one person with an empty record turn every
		// settled year in the household amber.
		const torn = [
			...new Set(
				rows.flatMap((r) =>
					r.residence.ambiguous && r.residence.candidates.length > 1 ? r.residence.candidates : []
				)
			)
		].sort();
		if (torn.length > 1)
			return { countries: torn, state: 'unsettled', words: 'both owe something' };

		// Only the people something is known about can settle the year; the rest
		// are silent rather than contradicting.
		const known = rows.filter((r) => r.residence.periods.length > 0);
		const countries = [
			...new Set(known.flatMap((r) => r.residence.periods.map((p) => p.country)))
		].sort();
		if (countries.length === 0)
			return { countries: [], state: 'unsettled', words: 'nothing on record' };

		// The weakest tier standing decides the word: a year proved for one person
		// and guessed for another is still a guess about the household.
		const tiers = known.map((r) => r.residence.evidence);
		// Short enough to survive a year-wide column — about seventeen characters at
		// six years across. A caption clipped to "citizenship · pro…" tells a reader
		// less than three true words, and the nudge to prove it is carried by the
		// "N unproved" chip beside the label rather than repeated in every cell.
		const words = tiers.includes('citizenship')
			? 'from citizenship'
			: tiers.includes('employment')
				? 'from work'
				: tiers.includes('statement')
					? 'from the return'
					: 'you said so';
		const proved = !tiers.includes('employment') && !tiers.includes('citizenship');
		return { countries, state: proved ? 'proved' : 'inferred', words };
	}

	const unproved = $derived(axis.filter((year) => residenceMark(year).state !== 'proved').length);

	/** The year whose residence form is open, at most one. */
	let declaring = $state<number | null>(null);
	const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '—';

	/** The declarations standing for a year — the only tier that can be withdrawn. */
	function declaredFor(year: number) {
		return years.residences
			.filter((r) => r.year === year && r.residence.evidence === 'declared')
			.flatMap((r) =>
				r.residence.periods.map((p) => ({
					personId: r.personId,
					country: p.country,
					span:
						p.fromOn || p.toOn
							? ` · ${p.fromOn ?? 'start of year'} → ${p.toOn ?? 'end of year'}`
							: ''
				}))
			);
	}

	const filedCount = $derived(years.grid.cells.filter((c) => c.state === 'filed').length);
	const missingCount = $derived(
		years.grid.cells.filter((c) => c.state === 'gap' || c.state === 'partial').length
	);

	/** One pressed cell at a time, the way a record opens one employer. */
	let open = $state<{ year: number; country: string } | null>(null);
	const isOpen = (year: number, country: string) => open?.year === year && open.country === country;
	function press(year: number, country: string) {
		open = isOpen(year, country) ? null : { year, country };
	}
	const openCard = $derived(open ? cardAt(open.year, open.country) : undefined);
	const openDocuments = $derived.by(() => {
		if (!openCard) return [];
		// A joint return sits on two rows; list it once.
		const all = [...openCard.rows.flatMap((r) => r.documents), ...openCard.supporting];
		return all.filter((d, i) => all.findIndex((x) => x.id === d.id) === i);
	});

	/** What kind of return a cell is short of, under the state word. */
	const KIND_WORD: Record<string, string> = {
		residence: 'residence return',
		unclear: 'residence unclear',
		// Nothing, on purpose: a household that has recorded no residence anywhere
		// would otherwise read the same alarm on every cell it owns.
		unknown: ''
	};
	function kindWords(card: TaxYearCardPayload | undefined): string {
		if (!card) return '';
		// Just "second return": the lane it sits in is already labelled with the
		// country, so naming it again only costs the characters that made this clip.
		if (card.returnKind === 'source') return 'second return';
		return KIND_WORD[card.returnKind];
	}

	/** Five words for five states. "not due yet" is not "never filed". */
	const STATE_WORD: Record<string, string> = {
		filed: 'filed',
		partial: 'partly filed',
		gap: 'never filed',
		open: 'not due yet',
		none: 'nothing owed'
	};

	// ---- Dropping paper ----
	//
	// Two targets, two meanings, one protocol: the id travels as `text/plain` and
	// the drop posts through `submitAction`. On an income row the paper belongs to
	// that counterparty and its lanes place it; on a tax cell it IS the return for
	// that year and country.
	let overKey = $state<string | null>(null);
	function dragOver(event: DragEvent, key: string) {
		if (!event.dataTransfer?.types.includes('text/plain')) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		overKey = key;
	}
	const dragLeave = (key: string) => {
		if (overKey === key) overKey = null;
	};
	async function dropOnCard(event: DragEvent, cardId: string) {
		event.preventDefault();
		const documentId = event.dataTransfer?.getData('text/plain');
		overKey = null;
		if (!documentId) return;
		const body = new FormData();
		body.set('documentId', documentId);
		body.set('targetId', cardId);
		await submitAction('/documents?/attachToCard', body);
	}
	async function dropOnYear(event: DragEvent, year: number, country: string, personIds: string[]) {
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
</script>

<div class="strip">
	{#if years.grid.countries.length > 0}
		<span class="quiet">
			{years.grid.countries.length}
			{years.grid.countries.length === 1 ? 'country' : 'countries'} · {filedCount} filed ·
			<span class:short={missingCount > 0}>{missingCount} missing</span>
		</span>
	{/if}
	{#if missingCount > 0}
		<span class="never">
			<span class="dot" aria-hidden="true"></span>
			{missingCount} never filed
		</span>
	{/if}
</div>

{#if years.unplacedOrganisations.length > 0}
	<!-- A role period the derivation cannot place. Said out loud, because the
	     alternative is drawing fewer cells than the household is owed and letting
	     a missing return look like nothing is missing. -->
	<p class="quiet unplaced">
		No country yet for
		{#each years.unplacedOrganisations as org, i (org.id)}{i > 0 ? ', ' : ''}<strong
				>{org.name}</strong
			>{/each}
		— open its row below and set the country there. Until it has one it raises no tax year at all, which
		is a quieter failure than a year in the wrong country.
	</p>
{/if}

{#if bare}
	<!-- Nothing earns and nothing is owed. An axis drawn over that is six empty
	     columns pretending to be an answer, so the screen says what would fill it
	     instead. Nothing is guessed: a default country would be wrong for anyone
	     filing in two. -->
	<div class="bare">
		<p class="bare-title">Nothing on this shelf yet.</p>
		<p class="quiet">
			A row appears here once somebody has a role period with an employer or a broker, and the tax
			half below it fills itself from where those are — a Czech employer makes a Czech year. A year
			also appears the moment something is filed for one. Or add the first by hand.
		</p>
	</div>
{:else}
	<section class="board" style:--years={axis.length}>
		<div class="axis-head">
			<span class="mono range">
				{axis[0]} → {axis[axis.length - 1]}
			</span>
			<span class="quiet">what earned, and what it made you owe</span>
		</div>

		<div class="scroll">
			<div class="grid">
				<span></span>
				{#each axis as year (year)}
					<span class="mono year-head">{year}</span>
				{/each}
			</div>

			<!-- ── INCOME ───────────────────────────────────────────────────── -->
			<div class="band">
				<span class="band-name">INCOME</span>
				<span class="quiet band-note">employment · brokerage · property</span>
				<span class="rule"></span>
			</div>

			{#each [{ label: 'EMPLOYMENT', cards: employment }, { label: 'BROKERAGE', cards: brokerage }] as group (group.label)}
				{#if group.cards.length > 0}
					<span class="eyebrow group">{group.label}</span>
					{#each group.cards as card (card.id)}
						{@render incomeRow(card)}
					{/each}
				{/if}
			{/each}

			<span class="eyebrow group">PROPERTY</span>
			<!-- A let property has no model yet, so the row says what would fill it
		     rather than pretending the band does not exist. -->
			<div class="grid row">
				<span class="row-head indent">
					<span class="tile quiet-tile" aria-hidden="true">🏠</span>
					<span class="quiet row-name">Rental income</span>
				</span>
				<span class="span idle" style:grid-column="2 / {axis.length + 2}">
					<span class="quiet">
						No property is letting yet — a let property adds a lane here, and its years flow into
						the tax below.
					</span>
				</span>
			</div>

			<!-- ── The derivation, stated once ───────────────────────────────── -->
			<div class="derivation">
				<span class="rule"></span>
				<span class="arrow">
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"><path d="M8 3v10M4.5 9.5 8 13l3.5-3.5" /></svg
					>
					everything above decides everything below
				</span>
				<span class="rule"></span>
			</div>

			<div class="band">
				<span class="band-name">TAX</span>
				<span class="quiet band-note">
					a filed statement's country is the strongest evidence of residence — where nothing is
					filed, it is proposed from the employment above
				</span>
				<span class="rule"></span>
			</div>

			<!-- Residence decides which return is THE return, so it is read before the
		     lanes and left correctable — including the year it cannot call. -->
			<div class="grid row">
				<span class="row-head indent">
					<span class="row-name">Tax residence</span>
					{#if unproved > 0}
						<span class="mono unproved">{unproved} unproved</span>
					{/if}
				</span>
				{#each axis as year (year)}
					{@const mark = residenceMark(year)}
					<button
						type="button"
						class="tall res {mark.state}"
						style:--hue="var({hueFor(mark.countries[0] ?? null)})"
						aria-expanded={declaring === year}
						aria-label="Tax residence for {year}"
						onclick={() => (declaring = declaring === year ? null : year)}
					>
						{#if mark.countries.length === 0}
							<span class="cell-word">set it</span>
						{:else if mark.state === 'unsettled' && mark.countries.length > 1}
							<span class="cell-word warnword">
								{#each mark.countries as code, i (code)}{i > 0 ? ' → ' : ''}<span aria-hidden="true"
										>{flagEmoji(code)}</span
									>{/each} · moved when?
							</span>
						{:else}
							<span class="cell-word">
								{#each mark.countries as code (code)}<span aria-hidden="true"
										>{flagEmoji(code)}</span
									>{/each}
								{mark.countries.map(countryName).join(' · ')}
							</span>
						{/if}
						<span class="cell-note">{mark.words}</span>
					</button>
				{/each}
			</div>

			{#if declaring !== null}
				{@render residence(declaring)}
			{/if}

			<!-- The circularity, said out loud where it bites: the rule reads residence
		     off a filed statement, and the years in question have none. -->
			<div class="note">
				<span class="note-icon" aria-hidden="true">
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						><circle cx="8" cy="8" r="5.5" /><path d="M8 7.4v3.4M8 5.2v.1" /></svg
					>
				</span>
				<span class="note-body">
					<span>
						A return is owed because you were <strong>resident</strong>, not because you earned. A
						year with no work, no investments and no rent still owes one where you lived — as a nil
						return.
					</span>
					<span class="tiers">
						<span class="quiet">Every year stands on its own evidence — nothing carries over:</span>
						<span class="tier"
							><span class="swatch solid" aria-hidden="true"></span>a filed statement</span
						>
						<span class="quiet" aria-hidden="true">→</span>
						<span class="tier"
							><span class="swatch dashed" aria-hidden="true"></span>where you worked</span
						>
						<span class="quiet" aria-hidden="true">→</span>
						<span class="tier">
							<span class="swatch dotted" aria-hidden="true"></span>
							citizenship · <a href="/settings">set it in the household</a>
						</span>
					</span>
				</span>
			</div>

			{#each years.grid.countries as country (country)}
				{@const cells = years.grid.cells.filter((c) => c.country === country)}
				{@const filed = cells.filter((c) => c.state === 'filed').length}
				{@const owed = cells.filter((c) => c.state !== 'none').length}
				<div class="grid row">
					<span class="row-head indent">
						<span aria-hidden="true">{flagEmoji(country)}</span>
						<span class="row-name">{countryName(country)}</span>
						<span class="mono count" class:short={filed < owed}>{filed}/{owed}</span>
					</span>
					{#each axis as year (year)}
						{@const cell = cells.find((c) => c.year === year)}
						{@const card = cardAt(year, country)}
						{#if !cell || cell.state === 'none'}
							<span class="tall nothing" role="img" aria-label="Nothing owed: {year} {country}">
								<span class="dash"></span>
							</span>
						{:else if cell.state === 'open'}
							<span class="tall later" role="img" aria-label="Not due yet: {year} {country}">
								not due yet
							</span>
						{:else}
							<button
								type="button"
								class="tall due {cell.state}"
								class:pressed={isOpen(year, country)}
								class:over={overKey === `y${year}-${country}`}
								style:--hue="var({hueFor(country)})"
								aria-expanded={isOpen(year, country)}
								ondragover={(e) => dragOver(e, `y${year}-${country}`)}
								ondragleave={() => dragLeave(`y${year}-${country}`)}
								ondrop={(e) =>
									dropOnYear(e, year, country, card?.rows.map((r) => r.personId) ?? [])}
								onclick={() => press(year, country)}
								aria-label="{STATE_WORD[cell.state]}: {year} {countryName(country)}"
							>
								<span class="cell-word">
									{#if cell.state === 'filed'}
										<svg
											width="13"
											height="13"
											viewBox="0 0 16 16"
											fill="none"
											stroke="currentColor"
											stroke-width="1.8"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg
										>
										filed{paperCount(card) > 1 ? ` · ${paperCount(card)}` : ''}
									{:else if cell.state === 'partial'}
										{cell.filed}/{cell.owed} filed
									{:else}
										never filed
									{/if}
								</span>
								<span class="cell-note" class:warnword={card?.returnKind === 'unclear'}>
									{kindWords(card)}
								</span>
							</button>
						{/if}
					{/each}
				</div>
				{#if open && open.country === country && openCard}
					<ObligationPanel
						card={openCard}
						documents={openDocuments}
						residences={years.residences.filter((r) => r.year === open!.year)}
						{people}
						{onopen}
						onclose={() => (open = null)}
					/>
				{/if}
			{/each}
		</div>

		<p class="quiet foot">
			A dashed span has no role-period dates recorded — its years are inferred from where its
			documents landed. Open it to set them.
		</p>
	</section>
{/if}

<!-- Everything on this shelf that is not a source of income: the tax office, an
     insurer, the pile nothing has been filed against yet. They keep their paper
     and their lanes; they just do not belong under a heading about earning. -->
{#if elsewhere.length > 0 || unassigned}
	<section class="board">
		<div class="band">
			<span class="band-name">ELSEWHERE ON THIS SHELF</span>
			<span class="quiet band-note">counterparties that are not a source of income</span>
			<span class="rule"></span>
		</div>
		{#each elsewhere as card (card.id)}
			{@render plainRow(card)}
		{/each}
		{#if unassigned}
			{@render plainRow(unassigned)}
		{/if}
	</section>
{/if}

{@render addYear()}

{#snippet incomeRow(card: DossierCard)}
	{@const span = spanYears(card)}
	<div
		class="grid row"
		class:over={overKey === card.id}
		role="group"
		ondragover={card.id ? (e) => dragOver(e, card.id!) : undefined}
		ondragleave={card.id ? () => dragLeave(card.id!) : undefined}
		ondrop={card.id ? (e) => dropOnCard(e, card.id!) : undefined}
	>
		<span class="row-head">
			<button
				type="button"
				class="chev"
				class:on={opened === card.id}
				aria-expanded={opened === card.id}
				aria-label="{opened === card.id ? 'Collapse' : 'Expand'} {card.name}"
				onclick={() => card.id && toggleCard(card.id)}
			>
				{#if opened === card.id}
					<svg
						width="13"
						height="13"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						aria-hidden="true"><path d="M4 6.5 8 10.5 12 6.5" /></svg
					>
				{:else}
					<svg
						width="13"
						height="13"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						aria-hidden="true"><path d="M6.5 4l4 4-4 4" /></svg
					>
				{/if}
			</button>
			<span class="tile" style:--hue="var({hueFor(card.country)})" aria-hidden="true">
				{card.emoji}
			</span>
			<span class="row-name" class:strong={opened === card.id}>{card.name}</span>
			<span class="mono count quiet">{card.documentCount}</span>
		</span>
		{#if span.length === 0}
			<span class="span idle" style:grid-column="2 / {axis.length + 2}">
				<span class="quiet">No dates and no dated paper yet — open it to say when this began.</span>
			</span>
		{:else}
			<span
				class="span"
				class:guess={undated(card)}
				class:live={ongoing(card)}
				style:--hue="var({hueFor(card.country)})"
				style:grid-column="{column(span[0])} / {column(span[span.length - 1]) + 1}"
			>
				<span class="span-words">{spanWords(card)}</span>
				{#if undated(card)}
					<span class="mono span-end quiet">dates?</span>
				{:else if ongoing(card)}
					<!-- The colour rides on the dot, not on the words: 10px green text on
					     the span's own tint misses AA in the light theme, while a dot is a
					     graphic and answers to the gentler 3:1 threshold. -->
					<span class="span-end live-end">
						<span class="live-dot" aria-hidden="true"></span>
						ongoing →
					</span>
				{/if}
			</span>
		{/if}
	</div>
	{#if opened === card.id}
		<EmploymentRecord
			{card}
			year={dossier.year}
			firstYear={dossier.firstYear}
			lastYear={dossier.lastYear}
			{people}
			hue={hueFor(card.country)}
			{onopen}
			{onyear}
		/>
	{/if}
{/snippet}

{#snippet plainRow(card: DossierCard)}
	<div class="plain">
		<button
			type="button"
			class="chev"
			class:on={opened === (card.id ?? 'unassigned')}
			aria-expanded={opened === (card.id ?? 'unassigned')}
			aria-label="{opened === (card.id ?? 'unassigned') ? 'Collapse' : 'Expand'} {card.name}"
			onclick={() => toggleCard(card.id ?? 'unassigned')}
		>
			{#if opened === (card.id ?? 'unassigned')}
				<svg
					width="13"
					height="13"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					aria-hidden="true"><path d="M4 6.5 8 10.5 12 6.5" /></svg
				>
			{:else}
				<svg
					width="13"
					height="13"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					aria-hidden="true"><path d="M6.5 4l4 4-4 4" /></svg
				>
			{/if}
		</button>
		<span class="tile" style:--hue="var({hueFor(card.country)})" aria-hidden="true"
			>{card.emoji}</span
		>
		<span class="row-name">{card.name}</span>
		{#if card.country}<span class="quiet">{countryName(card.country)}</span>{/if}
		<span class="mono count quiet">{card.documentCount}</span>
	</div>
	{#if opened === (card.id ?? 'unassigned')}
		<EmploymentRecord
			{card}
			year={dossier.year}
			firstYear={dossier.firstYear}
			lastYear={dossier.lastYear}
			people={card.id === null ? [] : people}
			hue={hueFor(card.country)}
			{onopen}
			{onyear}
		/>
	{/if}
{/snippet}

{#snippet residence(year: number)}
	<!-- Stating residence does not choose BETWEEN countries: a year somebody moved
	     in is two of these, and both halves owe a return. So the form states one
	     side at a time and says so, rather than offering a picker that quietly
	     makes the other country wrong. -->
	<div class="res-panel">
		<div class="res-head">
			<span class="res-title">Where did you live in {year}?</span>
			<span class="quiet">
				A filed statement answers this on its own. Say it by hand where none was, and add a second
				for the other half of a year you moved in.
			</span>
		</div>
		<form method="POST" action="?/setResidence" use:enhance class="res-form">
			<input type="hidden" name="year" value={year} />
			<select name="personId" aria-label="Who" required>
				{#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
			<select name="country" aria-label="Country" required>
				{#each countryOptions() as c (c.code)}
					<option value={c.code} selected={c.code === years.knownCountries[0]}>{c.name}</option>
				{/each}
			</select>
			<label class="res-span">
				<span class="quiet">from</span>
				<input type="date" name="fromOn" aria-label="Resident from" />
			</label>
			<label class="res-span">
				<span class="quiet">to</span>
				<input type="date" name="toOn" aria-label="Resident until" />
			</label>
			<button type="submit" class="btn small btn-primary">Save</button>
		</form>
		{#each declaredFor(year) as said (said.personId + said.country)}
			<form method="POST" action="?/clearResidence" use:enhance class="res-said">
				<input type="hidden" name="personId" value={said.personId} />
				<input type="hidden" name="year" value={year} />
				<input type="hidden" name="country" value={said.country} />
				<span class="quiet">
					{nameOf(said.personId)} · {countryName(said.country)}{said.span}
				</span>
				<button type="submit" class="btn small">Withdraw</button>
			</form>
		{/each}
		<div class="res-foot">
			<span class="quiet">Leave both dates blank for the whole year.</span>
			<button type="button" class="btn small" onclick={() => (declaring = null)}>Close</button>
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
	.short {
		color: var(--red);
	}
	.never {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--red);
		background: var(--red-tint);
		border-radius: var(--radius-pill);
		padding: 5px 11px;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-pill);
		background: var(--red);
	}
	.unplaced {
		margin: 0 0 var(--space-6);
	}
	.bare {
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--surface);
		padding: var(--space-8);
		text-align: center;
		margin-bottom: var(--space-6);
	}
	.bare-title {
		margin: 0 0 var(--space-5);
	}
	.board {
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--surface);
		padding: var(--space-8);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		margin-bottom: var(--space-6);
	}
	.axis-head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
	}
	.range {
		font-size: var(--text-lg);
		font-weight: 500;
	}
	.scroll {
		overflow-x: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	/* THE one geometry: a 250px stub, then a column per year. Every band uses it,
	   which is what makes a span mean the same thing in all of them. */
	.grid {
		display: grid;
		grid-template-columns: 250px repeat(var(--years), minmax(0, 1fr));
		gap: var(--space-4);
		min-width: 700px;
	}
	.row {
		align-items: center;
	}
	.row.over {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
		border-radius: var(--radius-md);
	}
	.year-head {
		font-size: var(--text-sm);
		color: var(--fg3);
		text-align: center;
	}
	.band {
		display: flex;
		align-items: center;
		gap: var(--space-5);
	}
	.band-name {
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
	}
	.band-note {
		font-size: var(--text-xs);
	}
	.rule {
		flex-grow: 1;
		height: 1px;
		background: var(--bd);
	}
	.group {
		padding-left: 25px;
	}
	.row-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.row-head.indent {
		padding-left: 25px;
	}
	.row-name {
		font-size: var(--text-sm);
		color: var(--fg2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-name.strong {
		color: var(--fg1);
		font-weight: 600;
	}
	.count {
		margin-left: auto;
		font-size: var(--text-2xs);
		flex: none;
	}
	.chev {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border: 0;
		border-radius: var(--radius-xs);
		background: transparent;
		color: var(--fg3);
		cursor: pointer;
		flex: none;
	}
	.chev.on {
		background: var(--card3);
		color: var(--fg1);
	}
	.tile {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--hue) 16%, transparent);
		font-size: var(--text-sm);
		line-height: 1;
		flex: none;
	}
	.quiet-tile {
		background: var(--surface-2);
	}
	/* A span is the row: solid while the paper is still coming, dashed while its
	   dates are a guess from where the documents landed. */
	.span {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		height: 30px;
		padding: 0 var(--space-5);
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--hue) 60%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--hue) 16%, transparent);
		overflow: hidden;
	}
	.span.guess {
		border-style: dashed;
	}
	.span.live {
		background: color-mix(in srgb, var(--hue) 28%, transparent);
		/* A ring, not a lift: the live span is outlined in its own colour so it
		   reads as the one still running, and nothing here floats. */
		outline: 2px solid color-mix(in srgb, var(--hue) 25%, transparent);
	}
	.span.idle {
		border: 1px dashed var(--bd2);
		background: transparent;
	}
	.span-words {
		font-size: var(--text-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.span-end {
		margin-left: auto;
		font-size: var(--text-2xs);
		flex: none;
	}
	.live-end {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		color: var(--fg1);
	}
	.live-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-pill);
		background: var(--green);
		flex: none;
	}
	.derivation {
		display: flex;
		align-items: center;
		gap: var(--space-5);
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
	/* Every cell in the tax half is this tall and says two things: what the state
	   is, and which return it is about. One without the other sends somebody
	   chasing the wrong form. */
	.tall {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		height: 44px;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background: transparent;
		font-family: inherit;
		padding: 0 var(--space-2);
		box-sizing: border-box;
	}
	.cell-word {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--fg2);
		white-space: nowrap;
	}
	.cell-note {
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
	/* Residence: border, not colour. A guess is not a warning, and the hues here
	   already mean "owed" — solid said so, dashed worked it out, amber could not. */
	.res {
		cursor: pointer;
	}
	.res.proved {
		border-color: color-mix(in srgb, var(--hue) 60%, transparent);
		background: color-mix(in srgb, var(--hue) 16%, transparent);
	}
	.res.inferred {
		border: 1px dashed color-mix(in srgb, var(--hue) 45%, transparent);
		background: color-mix(in srgb, var(--hue) 7%, transparent);
	}
	.res.unsettled {
		border-color: var(--yellow);
		background: var(--yellow-wash);
	}
	.res.unsettled .cell-word {
		color: var(--yellow);
		font-weight: 600;
	}
	.unproved {
		margin-left: auto;
		font-size: var(--text-2xs);
		color: var(--yellow);
		border: 1px solid color-mix(in srgb, var(--yellow) 45%, transparent);
		border-radius: var(--radius-pill);
		padding: 1px 7px;
		flex: none;
	}
	.due {
		cursor: pointer;
	}
	.due.gap,
	.due.partial {
		border-color: var(--red);
		background: var(--red-wash);
	}
	.due.gap .cell-word,
	.due.partial .cell-word {
		color: var(--red);
		font-weight: 600;
	}
	.due.filed {
		border-color: color-mix(in srgb, var(--hue) 60%, transparent);
		background: color-mix(in srgb, var(--hue) 16%, transparent);
	}
	.due.filed .cell-word {
		color: var(--fg1);
	}
	.due.pressed {
		outline: 2px solid color-mix(in srgb, var(--red) 22%, transparent);
	}
	.due.over {
		outline: 2px solid var(--blue);
		outline-offset: 1px;
	}
	.later {
		border: 1px dashed var(--bd2);
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.nothing {
		border: 0;
	}
	.dash {
		width: 8px;
		height: 1px;
		background: var(--bd2);
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		margin-left: 25px;
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		background: var(--card);
	}
	.note-icon {
		display: inline-flex;
		flex: none;
		color: var(--fg3);
	}
	.note-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--fg2);
	}
	.tiers {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.tier {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-2xs);
	}
	.swatch {
		width: 14px;
		height: 10px;
		border-radius: 3px;
	}
	.swatch.solid {
		border: 1px solid rgb(255 255 255 / 0.6);
	}
	.swatch.dashed {
		border: 1px dashed var(--bd2);
	}
	.swatch.dotted {
		border: 1px dotted rgb(255 255 255 / 0.35);
	}
	.foot {
		margin: 0;
	}
	.plain {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.res-panel {
		margin-left: 25px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		padding: var(--space-6) var(--space-7);
	}
	.res-head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-bottom: var(--space-5);
	}
	.res-title {
		font-size: var(--text-md);
		font-weight: 600;
	}
	.res-form,
	.res-said,
	.res-foot {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
	}
	.res-said,
	.res-foot {
		padding-top: var(--space-4);
	}
	.add-year {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
	}
</style>
