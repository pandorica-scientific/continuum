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
	import Icon from '$lib/components/Icon.svelte';
	import { countryName, countryOptions, flagEmoji } from '$lib/countries';
	import { countryHues } from '$lib/tax-hues';
	import {
		householdResidence,
		type HouseholdResidence,
		type ResidenceEvidence
	} from '$lib/tax-residence';
	import { submitAction } from '$lib/actions/result';
	import {
		cardPaper,
		paperCount,
		returnKindWords,
		STATE_WORDS,
		yearsOf
	} from '$lib/documents/tax-years';
	import { MONTHS } from '$lib/documents/dossier-cells';
	import { INCOME_KINDS } from '$lib/documents/templates';
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
	const hueFor = $derived(
		countryHues([...years.grid.countries, ...dossier.cards.map((card) => card.country)])
	);

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
		// `yearsOf` is the rule the tax cards are counted from, so a span and the
		// years it raises cannot disagree about where a role period reaches.
		const dated = card.roles
			.filter((role) => role.startsOn !== null)
			.flatMap((role) => yearsOf(role, thisYear, thisYear));
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
		dossier.cards.filter((c) => c.id !== null && !INCOME_KINDS.has(c.kind))
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

	/**
	 * Which record is open, at most one — the whole point of opening it in place.
	 *
	 * The pile of unfiled paper has no id, so it keys on a word. One rule for both
	 * rows, rather than each snippet keying itself and the first one guarding
	 * against a null the second one handles.
	 */
	let opened = $state<string | null>(null);
	const keyOf = (card: DossierCard) => card.id ?? 'unassigned';
	const toggleCard = (card: DossierCard) => (opened = opened === keyOf(card) ? null : keyOf(card));

	// ---- The tax half ----

	const cardAt = (year: number, country: string): TaxYearCardPayload | undefined =>
		years.cards.find((c) => c.year === year && c.country === country);

	/**
	 * Residence for every year, folded across the household once.
	 *
	 * The fold itself lives beside the per-person rule it sits on, so the Year
	 * dossier reads the same answer rather than a second opinion. Computed into a
	 * map here because the unproved count and the markup both want every year's.
	 */
	const marks = $derived(
		new Map(
			axis.map((year) => [
				year,
				householdResidence(years.residences.filter((r) => r.year === year).map((r) => r.residence))
			])
		)
	);

	/**
	 * What the tier that answered is called, in the cell's own width.
	 *
	 * Short enough to survive a year-wide column — about seventeen characters at
	 * six years across. A caption clipped to "citizenship · pro…" tells a reader
	 * less than three true words, and the nudge to prove it is carried by the
	 * "N unproved" chip beside the label rather than repeated in every cell.
	 */
	const EVIDENCE_WORDS: Record<ResidenceEvidence, string> = {
		citizenship: 'from citizenship',
		employment: 'from work',
		statement: 'from the return',
		declared: 'you said so'
	};

	function markWords(mark: HouseholdResidence): string {
		if (mark.evidence) return EVIDENCE_WORDS[mark.evidence];
		if (mark.countries.length < 2) return 'nothing on record';
		// The count, not "both": a household torn between three candidates owes a
		// return in each of the three, and "both" counts one of them out. It is
		// also four characters shorter than the sentence it replaces, which is
		// what lets the caption finish inside a year-wide column.
		return `${mark.countries.length} returns owed`;
	}

	/**
	 * What a residence cell says to a screen reader.
	 *
	 * The cell draws flags, which are `aria-hidden` — so the countries have to
	 * arrive here in words, or the only thing announced is the year.
	 */
	function markLabel(year: number, names: string, mark: HouseholdResidence): string {
		const how = markWords(mark);
		return `Tax residence for ${year}: ${names ? `${names} — ${how}` : how}`;
	}

	const unproved = $derived([...marks.values()].filter((m) => m.state !== 'proved').length);

	/** The year whose residence form is open, at most one. */
	let declaring = $state<number | null>(null);
	/** Whether the "why a return is owed" note is open. Its button is the only way to open or close it. */
	let noteOpen = $state(false);
	/**
	 * Whether the open residence form is stating PART of a year.
	 *
	 * Whole year is the common answer and the one the blank dates already meant,
	 * so the form starts there and the two date fields appear only when somebody
	 * says the year was split. Reset whenever another year is opened: a tick left
	 * over from the year before is a date pair nobody asked for.
	 */
	let partial = $state(false);
	// Bound only so each date can be required while the other is empty: a
	// ticked "only part of" with neither date is a split nobody dated, and
	// saving it as the whole year would contradict the tick.
	let partFrom = $state('');
	let partTo = $state('');
	/** Who and where the open form states. Bound, so a save can move `where` on. */
	let who = $state('');
	let where = $state('');
	function declare(year: number): void {
		declaring = declaring === year ? null : year;
		partial = false;
		partFrom = '';
		partTo = '';
		who = people[0]?.id ?? '';
		where = declaring === null ? '' : suggestCountry(declaring, who);
	}
	const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '—';

	/**
	 * The open form's year and what it reads, or undefined once that year is gone.
	 *
	 * Looked up rather than assumed. Dismissing a year's only card, or withdrawing
	 * the declaration that raised it, takes the year off the axis while its form
	 * is still open — and a lookup asserted non-null then threw on the next render
	 * and took the screen with it. The form now closes with its year.
	 */
	const declaringMark = $derived(declaring === null ? undefined : marks.get(declaring));

	/**
	 * The country the form offers for this person and year.
	 *
	 * The year's own countries first — what its evidence reads, then the countries
	 * it has cards in — skipping any this person has ALREADY declared for it. A
	 * move year takes two answers, and after the first the evidence reads only the
	 * country just declared: offering it again made "save the second half" an
	 * upsert over the first, since the store keys a declaration on
	 * (person, year, country), with nothing on screen to say so.
	 */
	function suggestCountry(year: number, personId: string): string {
		const said = new Set(
			declaredFor(year)
				.filter((d) => d.personId === personId)
				.map((d) => d.country)
		);
		const offered = [
			...(marks.get(year)?.countries ?? []),
			...years.cards.filter((c) => c.year === year).map((c) => c.country),
			...years.knownCountries
		];
		return offered.find((code) => !said.has(code)) ?? offered[0] ?? '';
	}

	/**
	 * The declaration a save would overwrite, if any.
	 *
	 * Still possible on purpose — correcting a declaration's dates is the same
	 * gesture as making it — but said before the click rather than discovered
	 * after it.
	 */
	const replacing = $derived(
		declaring === null
			? undefined
			: declaredFor(declaring).find((d) => d.personId === who && d.country === where)
	);

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
	const openDocuments = $derived(openCard ? cardPaper(openCard) : []);

	/** What kind of return a cell is short of, under the state word. */
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
			{@render yearHeads()}

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
					<Icon name="arrowDown" size={14} />
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

			<!-- The years again. One axis does not mean one label for it: by the time
			     the reader is down here the heading is several hundred pixels above,
			     and a cell that says "never filed" without saying WHEN is a cell you
			     have to click to read. Same columns, same row, stated twice — from one
			     snippet, so the two can never disagree about what a heading is. -->
			{@render yearHeads()}

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
					{@const mark = marks.get(year)!}
					{@const names = mark.countries.map(countryName).join(' · ')}
					{@const label = markLabel(year, names, mark)}
					<!-- The flags carry the countries and the names do not: three of them
					     never fit a year-wide column, and a cell that paints over its
					     neighbour says less than a clipped one. The spelling-out lives in
					     the label, the hover and the country rows below. No arrow between
					     them either — the candidates are sorted, so an arrow would assert a
					     direction of travel nobody has stated yet. -->
					<button
						type="button"
						class="tall res {mark.state}"
						style:--hue="var({hueFor(mark.countries[0] ?? null)})"
						aria-expanded={declaring === year}
						aria-label={label}
						title={label}
						onclick={() => declare(year)}
					>
						<span class="cell-word">
							{#if mark.countries.length === 0}
								<span class="word">set it</span>
							{:else}
								<span class="flags" aria-hidden="true">
									{#each mark.countries as code (code)}<span>{flagEmoji(code)}</span>{/each}
								</span>
								{#if mark.countries.length === 1}
									<span class="word">{names}</span>
								{:else if mark.state === 'unsettled'}
									<span class="word">moved?</span>
								{/if}
							{/if}
						</span>
						<span class="cell-note">{markWords(mark)}</span>
					</button>
				{/each}
			</div>

			{#if declaring !== null && declaringMark}
				{@render residence(declaring, declaringMark)}
			{/if}

			<!-- The circularity, said out loud where it bites: the rule reads residence
		     off a filed statement, and the years in question have none.

		     Folded away, because it is read once and then in the way: a paragraph
		     and a legend sat permanently between the residence row and the returns
		     it decides. The button alone opens and closes it: opening on hover or
		     focus as well kept it open under the very click meant to close it, and
		     left aria-expanded saying closed over a note plainly on screen. -->
			<div class="note" class:open={noteOpen}>
				<button
					type="button"
					class="note-trigger"
					aria-expanded={noteOpen}
					onclick={() => (noteOpen = !noteOpen)}
				>
					<span class="note-icon" aria-hidden="true">
						<Icon name="info" size={14} />
					</span>
					why a return is owed at all
				</button>
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
								aria-label="{STATE_WORDS[cell.state]}: {year} {countryName(country)}"
							>
								<span class="cell-word">
									{#if cell.state === 'filed'}
										{@const held = card ? paperCount(card) : 0}
										<Icon name="check" size={13} />
										<span class="word">filed{held > 1 ? ` · ${held}` : ''}</span>
									{:else if cell.state === 'partial'}
										<span class="word">{cell.filed}/{cell.owed} filed</span>
									{:else}
										<span class="word">never filed</span>
									{/if}
								</span>
								<span class="cell-note" class:warnword={card?.returnKind === 'unclear'}>
									{returnKindWords(card?.returnKind)}
								</span>
							</button>
						{/if}
					{/each}
				</div>
				{#if open && open.country === country && openCard}
					<ObligationPanel
						card={openCard}
						documents={openDocuments}
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

{#snippet chevron(card: DossierCard)}
	<button
		type="button"
		class="chev"
		class:on={opened === keyOf(card)}
		aria-expanded={opened === keyOf(card)}
		aria-label="{opened === keyOf(card) ? 'Collapse' : 'Expand'} {card.name}"
		onclick={() => toggleCard(card)}
	>
		<Icon name={opened === keyOf(card) ? 'chevronDown' : 'chevronRight'} size={13} />
	</button>
{/snippet}

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
			{@render chevron(card)}
			<span class="tile" style:--hue="var({hueFor(card.country)})" aria-hidden="true">
				{card.emoji}
			</span>
			<span class="row-name" class:strong={opened === keyOf(card)}>{card.name}</span>
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
	{#if opened === keyOf(card)}
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
		{@render chevron(card)}
		<span class="tile" style:--hue="var({hueFor(card.country)})" aria-hidden="true"
			>{card.emoji}</span
		>
		<span class="row-name">{card.name}</span>
		{#if card.country}<span class="quiet">{countryName(card.country)}</span>{/if}
		<span class="mono count quiet">{card.documentCount}</span>
	</div>
	{#if opened === keyOf(card)}
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

{#snippet yearHeads()}
	<div class="grid">
		<span></span>
		{#each axis as year (year)}
			<span class="mono year-head">{year}</span>
		{/each}
	</div>
{/snippet}

{#snippet residence(year: number, mark: HouseholdResidence)}
	<!-- Stating residence does not choose BETWEEN countries: a year somebody moved
	     in is two of these, and both halves owe a return. So the form states one
	     side at a time and says so, rather than offering a picker that quietly
	     makes the other country wrong. -->
	{@const proposed = mark.countries}
	<div class="res-panel">
		<div class="res-head">
			<span class="res-title">Where did you live in {year}?</span>
			<span class="quiet">
				{#if proposed.length > 0}
					As it stands, {year} reads
					<strong>{proposed.map(countryName).join(' · ')}</strong> — {markWords(mark)}.
				{/if}
				A filed statement answers this on its own. Say it by hand where none was, and take two answers
				for a year somebody moved in — one per country.
			</span>
		</div>
		<!-- Not reset after a save: the person stays chosen for the other half of
		     a move, and the country moves on to one they have not answered yet —
		     see `suggestCountry`. A default reset put the select back on the
		     country just saved, one click from overwriting it. -->
		<form
			method="POST"
			action="?/setResidence"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					if (result.type !== 'success') return;
					partFrom = '';
					partTo = '';
					where = suggestCountry(year, who);
				}}
			class="res-form"
		>
			<input type="hidden" name="year" value={year} />
			<select name="personId" aria-label="Who" required bind:value={who}>
				{#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
			<!-- THE YEAR'S OWN CANDIDATES FIRST, and one of them chosen. The default
			     here was `knownCountries[0]` — the household's alphabetically first
			     country, the same suggestion for every year on the axis, which for a
			     year spent somewhere else is a wrong answer one click from being
			     saved. What this year's evidence proposes is the only sensible
			     default, and a move year puts both halves at the top of the list. -->
			<select name="country" aria-label="Country for {year}" required bind:value={where}>
				{#if proposed.length > 0}
					<optgroup label="{year} reads">
						{#each proposed as code (code)}
							<option value={code}>{countryName(code)}</option>
						{/each}
					</optgroup>
				{/if}
				<optgroup label={proposed.length > 0 ? 'Somewhere else' : 'Country'}>
					{#each countryOptions().filter((c) => !proposed.includes(c.code)) as c (c.code)}
						<option value={c.code}>{c.name}</option>
					{/each}
				</optgroup>
			</select>
			<!-- "Leave both dates blank for the whole year" was a convention stated in
			     a footnote under the fields it governed, which is the wrong order to
			     read it in. The whole year is now the answer the form starts on, and
			     the dates exist only once somebody says the year was split. Bounded
			     to the year too: the picker opened on today and offered a date the
			     action then refused for not being in {year}. -->
			<label class="res-part">
				<input type="checkbox" bind:checked={partial} />
				<span>only part of {year}</span>
			</label>
			{#if partial}
				<input type="hidden" name="partial" value="1" />
				<!-- The pair travels together, so a narrow panel does not wrap "to"
				     onto the next line away from "from". -->
				<span class="res-dates">
					<label class="res-span">
						<span class="quiet">from</span>
						<input
							type="date"
							name="fromOn"
							aria-label="Resident from"
							min="{year}-01-01"
							max="{year}-12-31"
							bind:value={partFrom}
							required={!partTo}
						/>
					</label>
					<label class="res-span">
						<span class="quiet">to</span>
						<input
							type="date"
							name="toOn"
							aria-label="Resident until"
							min="{year}-01-01"
							max="{year}-12-31"
							bind:value={partTo}
							required={!partFrom}
						/>
					</label>
				</span>
			{/if}
			<button type="submit" class="btn small btn-primary">{replacing ? 'Replace' : 'Save'}</button>
		</form>
		{#if replacing}
			<p class="quiet res-hint">
				{nameOf(who)} already said {countryName(where)}{replacing.span} for {year}. Saving replaces
				that answer — for the other half of a move, choose the other country.
			</p>
		{/if}
		{#if partial}
			<p class="quiet res-hint">
				Give at least one date. The other may be left empty — a date in <em>from</em> alone means
				from that day to the end of {year}.
			</p>
		{/if}
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
	   which is what makes a span mean the same thing in all of them.

	   The floor is per COLUMN, not per grid: `minmax(0, 1fr)` under one whole-grid
	   minimum let a seventh year shave every cell instead of widening the board,
	   and the cells then wrote over each other. 96px holds the widest thing a
	   cell has to say — "residence unclear" at 9px measures 76 and the flags with
	   "moved?" 73, both inside the 88px the cell's padding leaves — so a column
	   is never narrower than its words and the board scrolls instead of shaving
	   them. Six years still fit a laptop window without scrolling, which is why
	   this is 96 and not a round 100. The whole-grid minimum stays for the other
	   end: two columns and a stub still fill a narrow window. */
	.grid {
		--cell: 96px;
		display: grid;
		grid-template-columns: 250px repeat(var(--years), minmax(var(--cell), 1fr));
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
		/* A cell is a box its own width. Both lines below clamp themselves, and
		   this is the backstop for anything that one day forgets to. */
		overflow: hidden;
		min-width: 0;
	}
	.cell-word {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		max-width: 100%;
		min-width: 0;
		font-size: var(--text-xs);
		color: var(--fg2);
		white-space: nowrap;
		overflow: hidden;
	}
	/* Flags keep their width and the words give way: a cell narrowed past its
	   content should lose the end of a country name, not which countries. */
	.flags {
		display: inline-flex;
		gap: var(--space-1);
		flex: none;
	}
	.word {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
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
	/* One line until it is wanted. The border stays so the row still reads as a
	   thing you can open, rather than a stray sentence. */
	.note {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-4);
		margin-left: 25px;
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		background: var(--card);
		width: fit-content;
		max-width: 100%;
	}
	.note-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
		border: 0;
		padding: 0;
		background: transparent;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--fg2);
		cursor: pointer;
	}
	.note-trigger:hover {
		color: var(--fg1);
	}
	.note-icon {
		display: inline-flex;
		flex: none;
		color: var(--fg3);
	}
	/* Open only while the button says so. `display: none` and not height: the
	   tier legend wraps, so there is no height to animate to that would not be
	   wrong at some width. */
	.note-body {
		display: none;
		flex-direction: column;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--fg2);
	}
	.note.open .note-body {
		display: flex;
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
	.res-part {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.res-dates {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
	}
	.res-hint {
		margin: var(--space-4) 0 0;
		font-size: var(--text-xs);
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
