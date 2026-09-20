<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// One obligation, opened: what produced it, and every way out of it.
	//
	// The screen this replaces listed the paper on the cell and offered one
	// button. That left the reader with a red square and no idea why the app
	// thought a return was owed — and the one correction that files nothing, end
	// the role period that raised it, was unreachable from the thing complaining.
	//
	// So the panel leads with the reason. A card is drawn, never stored, which
	// means the reason is always available: it is the very input the derivation
	// ran on.
	import { enhance } from '$app/forms';
	import { countryName, flagEmoji } from '$lib/countries';
	import PeriodListing from '$lib/statements/PeriodListing.svelte';
	import type { ResolvedResidence } from '$lib/documents/tax-years';
	import type { TaxYearCardPayload, TaxYearDocument } from '$lib/server/documents/tax-years';

	let {
		card,
		documents,
		residences,
		people,
		onopen,
		onclose
	}: {
		card: TaxYearCardPayload;
		/** The paper already on this cell, deduplicated by the caller. */
		documents: TaxYearDocument[];
		/** Everybody's residence for THIS year — what makes the year ambiguous or not. */
		residences: ResolvedResidence[];
		people: { id: string; name: string }[];
		onopen: (id: string) => void;
		onclose: () => void;
	} = $props();

	const nameOf = (id: string | null) =>
		id === null ? '' : (people.find((p) => p.id === id)?.name ?? '');

	/** The state word for the header chip. The same five words the cells carry. */
	const stateWord = $derived.by(() => {
		if (card.rows.length === 0) return 'nothing owed';
		if (card.rows.every((r) => r.state === 'filed')) return 'filed';
		if (card.rows.some((r) => r.state === 'filed')) return 'partly filed';
		return card.rows.some((r) => r.state === 'open') ? 'not due yet' : 'never filed';
	});

	/**
	 * The reason worth acting on, if there is one.
	 *
	 * A role period is the only reason a household can withdraw without filing
	 * anything, so it leads — the derivation already sorts reasons that way, and
	 * this reads the first of them rather than searching for a favourite.
	 */
	const lead = $derived(card.reasons[0]);

	/** The other reasons, so a card held up by three things does not claim one. */
	const rest = $derived(card.reasons.slice(1));

	/** Every country this year is torn between, so the choice can name them. */
	const candidates = $derived([
		...new Set(residences.flatMap((r) => (r.residence.ambiguous ? r.residence.candidates : [])))
	]);

	/**
	 * The year somebody MOVED: two countries from one tier and nothing filed.
	 *
	 * This is where the circularity bites — the rule reads residence off a filed
	 * statement, and a year with no statement has none — so the panel says it out
	 * loud instead of picking a country.
	 *
	 * A year with NO evidence at all is a different thing and gets a different
	 * sentence below: there is no move to date and no other country to file a nil
	 * return in, so offering that choice would be offering nothing.
	 */
	const torn = $derived(candidates.length > 1);

	/** Nothing anywhere says where they lived — the question, not the contest. */
	const blank = $derived(
		residences.length > 0 && residences.every((r) => r.residence.periods.length === 0)
	);

	/** The other country in play, for "a nil return on the other". */
	const other = $derived(candidates.find((code) => code !== card.country) ?? null);

	/** Whose year this is. One person needs no picker; a household does. */
	const whose = $derived(
		card.rows.length > 0 ? card.rows.map((r) => r.personId) : people.map((p) => p.id)
	);

	/** Which of the two ways out is open. Neither, until somebody asks. */
	let choosing = $state<'split' | 'one' | null>(null);

	const REASON_WORD: Record<string, string> = {
		engagement: 'a role period',
		// Not "already filed": the paper that raises a card is often the REPORT
		// behind a return rather than the return, and this sentence sits directly
		// under a cell reading "never filed".
		filing: 'paper on record for this year and country',
		residence: 'having lived here',
		added: 'somebody adding the year by hand'
	};

	/** How the residence tier knows, in the tier's own words. */
	const EVIDENCE_WORD: Record<string, string> = {
		declared: 'you said so',
		statement: 'the filed statement',
		employment: 'where you worked',
		citizenship: 'citizenship'
	};
</script>

<div class="panel">
	<div class="head">
		<span class="title">{card.year} · {countryName(card.country)}</span>
		<span class="mono chip" class:alert={stateWord === 'never filed'}>{stateWord}</span>
		<button
			type="button"
			class="close"
			aria-label="Close {card.year} {countryName(card.country)}"
			onclick={onclose}
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				aria-hidden="true"><path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" /></svg
			>
		</button>
	</div>

	<!-- WHY. The reason first, and where it is a role period, the way out that
	     files nothing: end the period and the obligation goes on its own. -->
	{#if lead}
		<div class="why">
			<span class="quiet">Owed because of</span>
			{#if lead.source === 'engagement' && lead.organisationName}
				<span class="reason">
					<span aria-hidden="true">💼</span>
					{lead.organisationName}
					<span class="quiet">
						{lead.organisationKind ?? 'organisation'} · {lead.country}
						{#if people.length > 1 && lead.personId}· {nameOf(lead.personId)}{/if}
					</span>
				</span>
				<span class="quiet">
					— end that role period before {card.year} and this obligation disappears on its own.
				</span>
			{:else if lead.source === 'residence'}
				<span class="reason">
					<span aria-hidden="true">{flagEmoji(card.country)}</span>
					having lived here
					<span class="quiet">
						from {EVIDENCE_WORD[lead.evidence ?? 'citizenship']}
						{#if people.length > 1 && lead.personId}· {nameOf(lead.personId)}{/if}
					</span>
				</span>
				<span class="quiet">
					— a return is owed for having been resident, even in a year with nothing earned.
				</span>
			{:else}
				<span class="reason">{REASON_WORD[lead.source]}</span>
			{/if}
			{#if rest.length > 0}
				<span class="quiet also">
					also {[...new Set(rest.map((r) => REASON_WORD[r.source]))].join(' and ')}
				</span>
			{/if}
		</div>
	{/if}

	<!-- The circularity, said where it bites. Setting the move date splits the
	     year; it does not choose a winner, and both sides still owe something. -->
	{#if blank}
		<!-- No tier answered at all. There is no move to date here, so the panel
		     asks the question rather than offering a choice between two countries
		     it cannot name. -->
		<div class="warn">
			<span class="warn-icon" aria-hidden="true">
				<svg
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					><circle cx="8" cy="8" r="5.5" /><path d="M8 5.2v3.4M8 10.8v.1" /></svg
				>
			</span>
			<span>
				Nothing on record says where anybody lived in {card.year}, so this cannot yet say whether
				{countryName(card.country)}'s is the return you owed for living there or a second one it
				wanted. Say it on the residence row above, or record citizenship in the household.
			</span>
		</div>
	{:else if torn}
		<div class="warn">
			<span class="warn-icon" aria-hidden="true">
				<svg
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					><circle cx="8" cy="8" r="5.5" /><path d="M8 5.2v3.4M8 10.8v.1" /></svg
				>
			</span>
			<span>
				{#if other}
					{card.year} has {countryName(other)}'s return outstanding too, and neither settles which
					country you were resident in.
				{:else}
					Nothing on record settles which country you were resident in for {card.year}.
				{/if}
				Setting the move date splits the year and leaves <strong>both</strong> countries owing something;
				it does not pick one. Each side is then a full return or a nil return, and that is your choice,
				not the app's.
			</span>
		</div>

		<div class="choice">
			<span class="quiet">This year will be</span>
			<button
				type="button"
				class="btn small"
				class:btn-primary={choosing === 'split'}
				aria-expanded={choosing === 'split'}
				onclick={() => (choosing = choosing === 'split' ? null : 'split')}
			>
				two returns, one per country
			</button>
			<button
				type="button"
				class="btn small"
				class:btn-primary={choosing === 'one'}
				aria-expanded={choosing === 'one'}
				onclick={() => (choosing = choosing === 'one' ? null : 'one')}
			>
				everything on one, a nil return on the other
			</button>
		</div>

		{#if choosing === 'split' && other}
			<!-- Two rows, one gesture: the day is the only thing a derivation cannot
			     work out, and everything else follows from it. -->
			<form
				method="POST"
				action="?/splitResidence"
				use:enhance={() =>
					async ({ update }) => {
						choosing = null;
						await update();
					}}
				class="ask"
			>
				{#if whose.length === 1}
					<input type="hidden" name="personId" value={whose[0]} />
				{:else}
					<select name="personId" aria-label="Who moved" required>
						{#each whose as id (id)}<option value={id}>{nameOf(id)}</option>{/each}
					</select>
				{/if}
				<input type="hidden" name="year" value={card.year} />
				<span class="quiet">Lived in</span>
				<select name="fromCountry" aria-label="Where the year started" required>
					{#each candidates as code (code)}
						<option value={code} selected={code === other}>{countryName(code)}</option>
					{/each}
				</select>
				<span class="quiet">until</span>
				<input type="date" name="movedOn" required aria-label="First day in the new country" />
				<span class="quiet">, then</span>
				<select name="toCountry" aria-label="Where the year ended" required>
					{#each candidates as code (code)}
						<option value={code} selected={code === card.country}>{countryName(code)}</option>
					{/each}
				</select>
				<button type="submit" class="btn small btn-primary">Save</button>
				<span class="quiet note">
					The date is the first day in the new country; the half before it ends the day before.
				</span>
			</form>
		{:else if choosing === 'one'}
			<form
				method="POST"
				action="?/setResidence"
				use:enhance={() =>
					async ({ update }) => {
						choosing = null;
						await update();
					}}
				class="ask"
			>
				{#if whose.length === 1}
					<input type="hidden" name="personId" value={whose[0]} />
				{:else}
					<select name="personId" aria-label="Who" required>
						{#each whose as id (id)}<option value={id}>{nameOf(id)}</option>{/each}
					</select>
				{/if}
				<input type="hidden" name="year" value={card.year} />
				<input type="hidden" name="country" value={card.country} />
				<span class="quiet">
					Resident in {countryName(card.country)} for the whole of {card.year}
					{#if other}
						— {countryName(other)} then wants a nil return rather than none at all.
					{/if}
				</span>
				<button type="submit" class="btn small btn-primary">Save</button>
			</form>
		{/if}
	{/if}

	<!-- The paper, or the two ways to put some there. -->
	{#if documents.length > 0}
		<PeriodListing
			title="{card.year} · {countryName(card.country)}"
			subtitle={card.rows.map((r) => r.personName).join(', ')}
			{documents}
			{onopen}
			onclose={() => onclose()}
		/>
	{/if}

	<div class="actions">
		<!-- A return is a statement with figures on it, and the Tax screen is where
		     those are recorded — so this opens that form already on this year and
		     country rather than asking the reader to find the year again. -->
		<a class="btn small btn-primary" href="/tax?add=1&year={card.year}&country={card.country}">
			Add the {card.year} return
		</a>
		{#if documents.length === 0}
			<span class="quiet">or drag one from the Inbox onto the cell</span>
		{/if}
		<form method="POST" action="?/dismissTaxYear" use:enhance class="dismiss">
			<input type="hidden" name="year" value={card.year} />
			<input type="hidden" name="country" value={card.country} />
			<button type="submit" class="btn small">
				We do not file in {countryName(card.country)} for {card.year}
			</button>
		</form>
	</div>
</div>

<style>
	/* Hung off the lane it belongs to, in the colour of the state that opened it:
	   a panel that floated free would not say which cell it answers. */
	.panel {
		margin-left: 26px;
		border-left: 2px solid color-mix(in srgb, var(--red) 45%, transparent);
		padding-left: var(--space-7);
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding-bottom: var(--space-5);
	}
	.title {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.chip {
		font-size: var(--text-2xs);
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 2px 8px;
	}
	.chip.alert {
		color: var(--red);
		border-color: transparent;
		background: var(--red-tint);
	}
	.close {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--fg3);
		cursor: pointer;
	}
	.why {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
		padding-bottom: var(--space-5);
	}
	.reason {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		padding: var(--space-2) var(--space-5);
		background: var(--card2);
	}
	.also {
		flex-basis: 100%;
	}
	.warn {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border: 1px solid color-mix(in srgb, var(--yellow) 35%, transparent);
		border-radius: var(--radius-md);
		background: var(--yellow-wash);
		font-size: var(--text-xs);
		color: var(--fg2);
	}
	.warn-icon {
		display: inline-flex;
		flex: none;
		color: var(--yellow);
	}
	.choice,
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
		padding-top: var(--space-5);
	}
	.ask {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
		padding-top: var(--space-5);
	}
	.note {
		flex-basis: 100%;
	}
	.dismiss {
		margin-left: auto;
	}
</style>
