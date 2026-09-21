<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// One income source, opened in place under its row on the Timeline: the
	// positions held, the paper that arrives on a rhythm, and the paper that does
	// not.
	//
	// It replaces the Employers tab. The tab was a second screen for the same
	// counterparty — you read the years on one and the payslips on the other, and
	// nothing on either said that the first decided the second. Opened under its
	// own span, the record is read where the question was asked.
	//
	// Nothing here is new data. A card already carries its role periods and its
	// lanes; this draws them against twelve months instead of against a card.
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { countryName, countryOptions, flagEmoji } from '$lib/countries';
	import { ENUMS } from '$lib/enums';
	import { columnCount, columnStarts, MONTHS } from '$lib/documents/dossier-cells';
	import type { CardDocument, DossierCard, DossierLane } from '$lib/server/documents/dossier-load';

	let {
		card,
		year,
		firstYear,
		lastYear,
		people,
		hue,
		onopen,
		onyear
	}: {
		card: DossierCard;
		/** The year the months belong to — the shelf's own `?year=`. */
		year: number;
		firstYear: number;
		lastYear: number;
		/** Who a role period can be added for. */
		people: { id: string; name: string }[];
		/** The country's hue token, so the record reads as part of its own span. */
		hue: string;
		onopen: (id: string) => void;
		onyear: (year: number) => void;
	} = $props();

	/**
	 * Three shapes, one card.
	 *
	 * Only a MONTHLY lane belongs in the twelve-column grid — that is what the
	 * Jan…Dec header means. A yearly one (a broker's annual report, an office's
	 * filing) has one cell per year and would otherwise draw 2021 under "Jan",
	 * and a two-year window would overlap its neighbour. It gets a row scaled to
	 * its own cells instead. A lane with no rhythm has nothing to be missing from
	 * and is a list.
	 */
	const monthly = $derived(card.lanes.filter((lane) => lane.cadence === 'monthly'));
	const windowed = $derived(
		card.lanes.filter((lane) => lane.cadence === 'yearly' || lane.cadence === 'once')
	);
	const loose = $derived(card.lanes.filter((lane) => lane.cadence === 'none'));

	/**
	 * Where a role period sits across the twelve columns of THIS year.
	 *
	 * Null when it does not reach the year at all. A period with no start runs
	 * from January and a period with no end runs to December: undated does not
	 * mean absent, which is the same rule the span on the row above follows.
	 */
	function months(role: {
		startsOn: string | null;
		endsOn: string | null;
	}): [number, number] | null {
		const startYear = role.startsOn ? Number(role.startsOn.slice(0, 4)) : -Infinity;
		const endYear = role.endsOn ? Number(role.endsOn.slice(0, 4)) : Infinity;
		if (startYear > year || endYear < year) return null;
		const from = startYear === year ? Number(role.startsOn!.slice(5, 7)) : 1;
		const to = endYear === year ? Number(role.endsOn!.slice(5, 7)) : 12;
		return [from, to];
	}

	const inYear = $derived(
		card.roles.flatMap((role) => {
			const span = months(role);
			return span ? [{ role, span }] : [];
		})
	);

	/**
	 * Whether the card's own record is open — its name, emoji, kind and country.
	 *
	 * It lives here because the Employers tab it used to live on is gone, and a
	 * country is not cosmetic on this screen: an organisation with none raises no
	 * tax year at all, so the row that says "no country yet" has to be the row
	 * where that is fixed.
	 */
	let editing = $state(false);

	/**
	 * Close the open form and reload what it changed.
	 *
	 * Returning a callback from `enhance` REPLACES the default, so without the
	 * `update()` the write lands and the screen keeps showing what it wrote over.
	 */
	const closeAfter =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			doing = null;
			await update();
		};

	/** Which correction is open, at most one: the forms are alternatives, not a toolbar. */
	let doing = $state<{ id: string; what: 'end' | 'promote' | 'dates' } | null>(null);
	function toggle(id: string, what: 'end' | 'promote' | 'dates') {
		doing = doing?.id === id && doing.what === what ? null : { id, what };
	}

	/** Whether a role period is the one running now — the only one that can end or be promoted. */
	const open = (role: { endsOn: string | null }) => role.endsOn === null;

	/**
	 * What a no-rhythm lane has to show for itself, in one line.
	 *
	 * An empty one names the gesture rather than offering an Add button: paper
	 * arrives on this shelf by being dropped on the row, and a button that opened
	 * an upload dialog would be a second way in to the same thing.
	 */
	function looseSummary(lane: { documents: CardDocument[] }): string {
		if (lane.documents.length === 0) return 'nothing filed yet — drop one on the row above';
		const newest = lane.documents[0];
		const count = `${lane.documents.length} ${lane.documents.length === 1 ? 'filing' : 'filings'}`;
		return `${count} · ${newest.name}`;
	}

	/** The word an UNFILLED cell carries for a screen reader; a filled one says so itself. */
	const CELL_WORD: Record<string, string> = {
		gap: 'Missing',
		'not-arrived': 'Not due yet',
		before: 'Before this began'
	};
</script>

<div class="record" style:--hue="var({hue})">
	<div class="head">
		<span class="name">{card.name}</span>
		{#if card.country}
			<span class="mono chip" title={countryName(card.country)}>
				{flagEmoji(card.country)}
				{card.country}
			</span>
		{:else if card.id !== null}
			<button type="button" class="chip warn-chip" onclick={() => (editing = !editing)}>
				no country — set it
			</button>
		{/if}
		<span class="quiet">
			the record{monthly.length > 0 ? ' — month by month' : ''}
		</span>
		{#if card.id !== null}
			<button
				type="button"
				class="more"
				aria-expanded={editing}
				aria-label="More for {card.name}"
				onclick={() => (editing = !editing)}
			>
				<Icon name="dots" size={16} />
			</button>
		{/if}
		<div class="pager">
			<button
				type="button"
				aria-label="Previous year"
				disabled={year <= firstYear}
				onclick={() => onyear(year - 1)}
			>
				<Icon name="chevronLeft" size={13} />
			</button>
			<span class="mono">{year}</span>
			<button
				type="button"
				aria-label="Next year"
				disabled={year >= lastYear}
				onclick={() => onyear(year + 1)}
			>
				<Icon name="chevronRight" size={13} />
			</button>
		</div>
	</div>

	{#if editing && card.id !== null}
		<!-- Name, emoji, kind and country in one post, the way the rail's rename
		     row already does it. The KIND is here and not only on a settings screen
		     because it decides which band this row is read under: an employer earns,
		     a broker earns, a tax office does not. -->
		<form
			method="POST"
			action="?/renameOrganisation"
			use:enhance={() =>
				async ({ update }) => {
					editing = false;
					await update();
				}}
			class="correct"
		>
			<input type="hidden" name="id" value={card.id} />
			<input name="name" value={card.name} aria-label="Name" />
			<input name="emoji" value={card.emoji} aria-label="Emoji" class="emoji-input" />
			<select name="kind" aria-label="Kind" value={card.kind}>
				{#each ENUMS['organisation.kind'] as kind (kind)}<option value={kind}>{kind}</option>{/each}
			</select>
			<select name="country" aria-label="Country" value={card.country ?? ''}>
				<option value="">Country —</option>
				{#each countryOptions() as c (c.code)}<option value={c.code}>{c.name}</option>{/each}
			</select>
			<button type="submit" class="btn small btn-primary">Save</button>
			<button type="button" class="btn small" onclick={() => (editing = false)}>Cancel</button>
			<span class="quiet note">
				Without a country this raises no tax year at all — a quieter failure than a year in the
				wrong one, but a failure.
			</span>
		</form>
	{/if}

	<div class="scroll">
		{#if monthly.length > 0}
			<div class="months">
				<span></span>
				{#each MONTHS as month (month)}
					<span class="mono month-head">{month}</span>
				{/each}
			</div>
		{/if}

		<!-- POSITIONS. A promotion is a second period, never an edit to the first:
		     a lane counts expected filings from the earliest start, so overwriting
		     the title would move the beginning forward and erase the months before
		     it. So each period is its own bar. -->
		<div class="row">
			<span class="row-label">
				<span>Positions</span>
				<span class="mono quiet">{inYear.length}</span>
			</span>
			{#if inYear.length === 0}
				<span class="bar empty-bar" style:grid-column="2 / 14">
					<span class="quiet">No role period covers {year}.</span>
				</span>
			{:else}
				{#each inYear as { role, span } (role.id)}
					<span
						class="bar"
						class:undated={role.startsOn === null}
						style:grid-column="{span[0] + 1} / {span[1] + 2}"
					>
						<span class="role-name">{role.role ?? 'Role not recorded'}</span>
						{#if people.length > 1}<span class="quiet who">{role.personName}</span>{/if}
						{#if role.startsOn}
							<span class="mono quiet since">since {role.startsOn}</span>
						{:else}
							<button type="button" class="chip-btn" onclick={() => toggle(role.id, 'dates')}>
								no dates — set them
							</button>
						{/if}
						<span class="bar-actions">
							{#if open(role)}
								<span class="current">current</span>
								<button type="button" class="chip-btn" onclick={() => toggle(role.id, 'end')}>
									End it
								</button>
								<button type="button" class="chip-btn" onclick={() => toggle(role.id, 'promote')}>
									<Icon name="plus" size={11} />
									Promotion
								</button>
							{:else}
								<span class="mono quiet until">to {role.endsOn}</span>
							{/if}
						</span>
					</span>
				{/each}
			{/if}
		</div>

		{#each monthly as lane (lane.id)}
			<div class="row">
				{@render laneLabel(lane)}
				{@render laneCells(lane)}
			</div>
		{/each}
	</div>

	<!-- A yearly lane draws one cell per year, so it gets a grid of its own size
	     rather than being squeezed under twelve month headings. -->
	{#each windowed as lane (lane.id)}
		<div class="scroll">
			<div class="years" style:--columns={columnCount(lane.cells)}>
				<span></span>
				{#each lane.cells as cell, i (cell.key)}
					<span
						class="mono month-head"
						style:grid-column="{columnStarts(lane.cells)[i] + 1} / span {cell.span}"
					>
						{cell.label}
					</span>
				{/each}
			</div>
			<div class="years" style:--columns={columnCount(lane.cells)}>
				{@render laneLabel(lane)}
				{@render laneCells(lane)}
			</div>
		</div>
	{/each}

	<!-- The forms, under the row they correct rather than beside it: a date input
	     inside a 34px bar would push every month column out of line. -->
	{#if doing}
		{@const role = card.roles.find((r) => r.id === doing!.id)}
		{#if role}
			{#if doing.what === 'end'}
				<form method="POST" action="?/endEngagement" use:enhance={closeAfter} class="correct">
					<input type="hidden" name="id" value={role.id} />
					<span class="quiet">{role.role ?? 'This role'} ended on</span>
					<input type="date" name="endsOn" required aria-label="Last day of this role" />
					<button type="submit" class="btn small btn-primary">End it</button>
					<button type="button" class="btn small" onclick={() => (doing = null)}>Cancel</button>
				</form>
			{:else if doing.what === 'promote'}
				<form method="POST" action="?/promoteEngagement" use:enhance={closeAfter} class="correct">
					<input type="hidden" name="id" value={role.id} />
					<span class="quiet">Promoted to</span>
					<input name="role" placeholder="New title" aria-label="New title" />
					<span class="quiet">from</span>
					<input type="date" name="startsOn" required aria-label="First day of the new role" />
					<button type="submit" class="btn small btn-primary">Save</button>
					<button type="button" class="btn small" onclick={() => (doing = null)}>Cancel</button>
					<span class="quiet note">
						The role held closes the day before, so no payslip belongs to both.
					</span>
				</form>
			{:else}
				<form method="POST" action="?/updateEngagement" use:enhance={closeAfter} class="correct">
					<input type="hidden" name="id" value={role.id} />
					<span class="quiet">Title</span>
					<input name="role" value={role.role ?? ''} aria-label="Role" />
					<span class="quiet">started</span>
					<input type="date" name="startsOn" value={role.startsOn ?? ''} aria-label="Started on" />
					<button type="submit" class="btn small btn-primary">Save</button>
					<button type="button" class="btn small" onclick={() => (doing = null)}>Cancel</button>
					<span class="quiet note">
						Dated, its span stops being a guess from where its documents landed.
					</span>
				</form>
			{/if}
		{/if}
	{/if}

	<!-- Contract, annexes and HR have no rhythm, so they are a list and not a
	     grid: a grid over them would invent an expectation nobody stated. -->
	{#each loose as lane (lane.id)}
		<div class="loose-row">
			<span class="loose-label">{lane.label}</span>
			<span class="quiet">{looseSummary(lane)}</span>
			{#if lane.documents.length > 0}
				<button type="button" class="btn small" onclick={() => onopen(lane.documents[0].id)}>
					Open
				</button>
			{/if}
		</div>
	{/each}

	{#if card.roles.length === 0 && people.length > 0 && card.id !== null}
		<form method="POST" action="?/addEngagement" use:enhance class="correct">
			<input type="hidden" name="organisationId" value={card.id} />
			<span class="quiet">Nobody has a role period here yet.</span>
			<select name="personId" aria-label="Who">
				{#each people as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
			</select>
			<input name="role" placeholder="Role (optional)" aria-label="Role" />
			<input type="date" name="startsOn" aria-label="Started on" />
			<button type="submit" class="btn small btn-primary">Add</button>
		</form>
	{/if}
</div>

{#snippet laneLabel(lane: DossierLane)}
	<span class="row-label">
		<span>{lane.label}</span>
		<span class="mono quiet" class:short={lane.gaps > 0}>{lane.filed}/{lane.expected}</span>
	</span>
{/snippet}

{#snippet laneCells(lane: DossierLane)}
	<!-- Placed by the running sum of the spans before it, never by index: one
	     document covering three months is ONE cell three columns wide, and every
	     cell after it would be drawn three columns early. -->
	{#each lane.cells as cell, i (cell.key)}
		{@const start = columnStarts(lane.cells)[i] + 1}
		{#if cell.state === 'filed'}
			<button
				type="button"
				class="cell filed"
				style:grid-column="{start} / span {cell.span}"
				onclick={() => onopen(cell.documentIds[0])}
				aria-label="Filed: {cell.label}"
			>
				<Icon name="check" size={13} />
				{#if cell.documentIds.length > 1}
					<span class="mono many">{cell.documentIds.length}</span>
				{/if}
			</button>
		{:else}
			<span
				class="cell {cell.state}"
				style:grid-column="{start} / span {cell.span}"
				role="img"
				aria-label="{CELL_WORD[cell.state]}: {cell.label}"
			></span>
		{/if}
	{/each}
{/snippet}

<style>
	/* Hung off its own span by a rule in the source's hue, so the record reads as
	   belonging to the row above rather than as a panel that happens to follow. */
	.record {
		margin-left: 26px;
		border-left: 2px solid color-mix(in srgb, var(--hue) 45%, transparent);
		padding-left: var(--space-7);
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding-bottom: var(--space-5);
	}
	.name {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.chip {
		font-size: var(--text-2xs);
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 1px 8px;
		background: transparent;
	}
	.warn-chip {
		color: var(--yellow);
		border-color: color-mix(in srgb, var(--yellow) 45%, transparent);
		font-family: inherit;
		cursor: pointer;
	}
	.more {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--fg3);
		cursor: pointer;
	}
	.emoji-input {
		width: 56px;
		text-align: center;
	}
	.pager {
		margin-left: auto;
		display: flex;
		align-items: center;
		height: 28px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		background: var(--card);
		overflow: hidden;
	}
	.pager button {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border: 0;
		background: transparent;
		color: var(--fg2);
		cursor: pointer;
	}
	.pager button:disabled {
		color: var(--bd2);
		cursor: not-allowed;
	}
	.pager .mono {
		font-size: var(--text-sm);
		padding: 0 var(--space-3);
	}
	.scroll {
		overflow-x: auto;
		overscroll-behavior: contain;
	}
	/* One geometry for every row in here: the label column, then twelve months. */
	.months,
	.row {
		display: grid;
		grid-template-columns: 110px repeat(12, minmax(0, 1fr));
		gap: var(--space-2);
		min-width: 560px;
	}
	/* A yearly lane's own width: as many columns as it has years. */
	.years {
		display: grid;
		grid-template-columns: 110px repeat(var(--columns), minmax(44px, 1fr));
		gap: var(--space-2);
		align-items: center;
		min-width: 320px;
		padding-bottom: var(--space-2);
	}
	.row {
		align-items: center;
		padding-bottom: var(--space-2);
	}
	.month-head {
		font-size: var(--text-2xs);
		color: var(--fg3);
		text-align: center;
	}
	.row-label {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--fg2);
	}
	.short {
		color: var(--red);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		height: 34px;
		padding: 0 var(--space-5);
		box-sizing: border-box;
		border: 1px solid color-mix(in srgb, var(--hue) 60%, transparent);
		border-left: 3px solid var(--hue);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		background: color-mix(in srgb, var(--hue) 20%, transparent);
		overflow: hidden;
	}
	/* Dashed says the same thing here as on the span above: the dates are a guess
	   from where the paper landed, not something anybody recorded. */
	.bar.undated {
		border-style: dashed;
		border-left-style: dashed;
	}
	.bar.empty-bar {
		border: 1px dashed var(--bd2);
		border-left: 1px dashed var(--bd2);
		border-radius: var(--radius-md);
		background: transparent;
	}
	.role-name {
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.who,
	.since,
	.until {
		font-size: var(--text-2xs);
		white-space: nowrap;
	}
	.bar-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex: none;
	}
	.current {
		font-size: var(--text-2xs);
		color: var(--green);
	}
	.chip-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 22px;
		padding: 0 var(--space-4);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--fg2);
		font-family: inherit;
		font-size: var(--text-2xs);
		white-space: nowrap;
		cursor: pointer;
	}
	.chip-btn:hover {
		background: var(--card2);
	}
	.cell {
		display: grid;
		place-items: center;
		height: 34px;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background: transparent;
		color: var(--fg2);
		padding: 0;
	}
	.cell.filed {
		border-color: color-mix(in srgb, var(--hue) 45%, transparent);
		background: color-mix(in srgb, var(--hue) 16%, transparent);
		cursor: pointer;
	}
	.cell.filed:hover {
		background: color-mix(in srgb, var(--hue) 28%, transparent);
	}
	.cell.gap {
		border-color: var(--red);
		background: var(--red-wash);
	}
	.cell.not-arrived {
		border: 1px dashed var(--bd2);
	}
	.cell.before {
		border: 1px solid var(--bd);
		opacity: 0.35;
	}
	.many {
		font-size: var(--text-2xs);
	}
	.correct {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: var(--space-5) 0 var(--space-2);
	}
	.note {
		flex-basis: 100%;
	}
	.loose-row {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-3) 0;
	}
	.loose-label {
		width: 110px;
		flex: none;
		font-size: var(--text-xs);
		color: var(--fg2);
	}
	.loose-row .btn {
		margin-left: auto;
	}
</style>
