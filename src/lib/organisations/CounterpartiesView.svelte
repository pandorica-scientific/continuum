<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// Income & Tax as counterparty cards: one per organisation, each holding
	// lanes, each lane holding cells.
	//
	// The shelf's failure is a payslip that never arrived — worth chasing,
	// because it is also the year-end tax base — and a list of forty slips looks
	// the same whether or not February is among them. So the lanes draw the
	// months whether or not anything filled them.
	//
	// A lane's cells are the Statements ribbon's arithmetic pointed at a
	// different question, and its EXPECTED count comes from the engagement
	// rather than from the paper: a year before the first filed document still
	// reads as missing, which is the whole reason role periods are recorded.
	import Icon from '$lib/components/Icon.svelte';
	import PeriodListing from '$lib/statements/PeriodListing.svelte';
	import type {
		CardLane,
		CounterpartiesPayload
	} from '$lib/server/organisations/counterparties-load';

	let {
		counterparties,
		onopen,
		onyear
	}: {
		counterparties: CounterpartiesPayload;
		onopen: (documentId: string) => void;
		onyear: (year: number) => void;
	} = $props();

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

	const canGoBack = $derived(counterparties.year > counterparties.firstYear);
	const canGoForward = $derived(counterparties.year < counterparties.lastYear);

	/** The period whose contents are listed, if any. */
	let open = $state<{ laneId: string; column: number } | null>(null);

	const isOpen = (laneId: string, column: number): boolean =>
		open?.laneId === laneId && open.column === column;

	function pressed(laneId: string, column: number, documentIds: string[]) {
		// One document opens; several list. A menu of one is not a choice.
		if (documentIds.length === 1) {
			onopen(documentIds[0]);
			return;
		}
		open = isOpen(laneId, column) ? null : { laneId, column };
	}

	/** A lane's column headings: months for the year, or years for the decade. */
	const headings = (lane: CardLane): string[] =>
		lane.cadence === 'monthly'
			? MONTHS
			: lane.boxes.map((_, i) => String(Math.floor(counterparties.year / 10) * 10 + i));

	const columnLabel = (lane: CardLane, column: number): string =>
		lane.cadence === 'monthly'
			? `${MONTHS[column]} ${counterparties.year}`
			: String(Math.floor(counterparties.year / 10) * 10 + column);

	const openLane = $derived(
		open
			? (counterparties.cards.flatMap((c) => c.lanes).find((l) => l.id === open!.laneId) ?? null)
			: null
	);
	const openDocuments = $derived(
		openLane && open
			? (openLane.boxes
					.find((b) => b.startMonth === open!.column)
					?.documentIds.map((id) => counterparties.documents[id])
					.filter(Boolean) ?? [])
			: []
	);
</script>

<section class="counterparties" aria-label="Income and tax by counterparty">
	<header>
		<div class="year">
			<button
				type="button"
				aria-label="Previous year"
				disabled={!canGoBack}
				onclick={() => onyear(counterparties.year - 1)}
			>
				<Icon name="chevronLeft" size={16} />
			</button>
			<span class="mono y">{counterparties.year}</span>
			<button
				type="button"
				aria-label="Next year"
				disabled={!canGoForward}
				onclick={() => onyear(counterparties.year + 1)}
			>
				<Icon name="chevronRight" size={16} />
			</button>
		</div>
		<span class="summary">
			{counterparties.cards.length}
			{counterparties.cards.length === 1 ? 'counterparty' : 'counterparties'}
		</span>
	</header>

	{#each counterparties.cards as card (card.id)}
		<article class="card">
			<div class="card-head">
				<span class="emoji" aria-hidden="true">{card.emoji}</span>
				<h3>{card.name}</h3>
				{#if card.kind !== 'other'}<span class="mono chip">{card.kind}</span>{/if}
				<span class="mono card-count">
					{card.documentCount}
					{card.documentCount === 1 ? 'document' : 'documents'}
				</span>
			</div>

			{#if card.role || card.since}
				<!-- The CURRENT role, and when the whole relationship began — which
				     after a promotion are two different years, and both matter: the
				     role says what somebody is, the date says what the lanes count
				     from. -->
				<p class="who">
					{#if card.role}<span class="role">{card.role}</span>{/if}
					{#if card.since}<span class="since">since {card.since.slice(0, 4)}</span>{/if}
				</p>
			{/if}

			{#each card.lanes as lane (lane.id)}
				<div class="lane">
					<div class="lane-head">
						<span class="lane-label">{lane.label}</span>
						{#if lane.cadence !== 'none'}
							<span class="mono lane-count" class:short={lane.filed < lane.expected}>
								{lane.filed}/{lane.expected}
							</span>
						{/if}
					</div>

					{#if lane.cadence === 'none'}
						<!-- No cells. Paper with no rhythm has nothing to be missing
						     from, and a grid over it would invent an expectation nobody
						     stated. -->
						{#if lane.documents.length === 0}
							<p class="quiet lane-empty">Nothing filed here yet.</p>
						{:else}
							<div class="loose">
								{#each lane.documents as doc (doc.id)}
									<button type="button" class="loose-row" onclick={() => onopen(doc.id)}>
										<span class="loose-name">{doc.name}</span>
										<span class="mono loose-date">{doc.addedOn}</span>
									</button>
								{/each}
							</div>
						{/if}
					{:else}
						<div class="scroll">
							<div class="cells" style:--columns={lane.boxes.length}>
								{#each headings(lane) as heading, i (heading)}
									<span class="mono cell-head" style:grid-column={i + 1}>{heading}</span>
								{/each}
								{#each lane.boxes as box (box.startMonth)}
									<div
										class="cell {box.state}"
										style:grid-column="{box.startMonth + 1} / span {box.months}"
									>
										{#if box.state === 'filed'}
											<button
												type="button"
												class="filled"
												class:open={isOpen(lane.id, box.startMonth)}
												onclick={() => pressed(lane.id, box.startMonth, box.documentIds)}
												aria-label="{box.documentIds.length > 1
													? `List the ${box.documentIds.length} documents for`
													: 'Open the document for'} {columnLabel(lane, box.startMonth)}"
											>
												{#if box.documentIds.length > 1}
													<span class="mono many">{box.documentIds.length}</span>
												{/if}
											</button>
										{:else if box.state === 'before-account'}
											<span class="faint" aria-label="Before this began"></span>
										{:else}
											<span
												class="empty"
												aria-label="{box.state === 'gap'
													? 'Missing'
													: 'Not arrived yet'}: {columnLabel(lane, box.startMonth)}"
											></span>
										{/if}
									</div>
								{/each}
							</div>
						</div>

						{#if open?.laneId === lane.id && openDocuments.length > 0}
							<PeriodListing
								title={columnLabel(lane, open.column)}
								subtitle={card.name}
								documents={openDocuments}
								{onopen}
								onclose={() => (open = null)}
							/>
						{/if}
					{/if}
				</div>
			{/each}

			{#if card.unclaimed.length > 0}
				<!-- Everything filed against this organisation is either drawn above
				     or counted here. An invisible document is worse than a missing
				     one, and no lane claiming it is a fact about the lanes. -->
				<div class="lane">
					<span class="lane-label quiet">
						{card.unclaimed.length} filed here that no lane claims
					</span>
					<div class="loose">
						{#each card.unclaimed as doc (doc.id)}
							<button type="button" class="loose-row" onclick={() => onopen(doc.id)}>
								<span class="loose-name">{doc.name}</span>
								<span class="mono loose-date">{doc.addedOn}</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</article>
	{/each}

	{#if counterparties.cards.length === 0}
		<p class="quiet none">
			Nothing is filed against an organisation yet. Add one from the rail, then link a payslip or a
			tax document to it.
		</p>
	{/if}
</section>

<style>
	.counterparties {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-6);
	}
	.year {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.year button {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--fg2);
		cursor: pointer;
	}
	.year button:hover:not(:disabled) {
		background: var(--card2);
		color: var(--fg1);
	}
	.year button:disabled {
		color: var(--fg3);
		cursor: default;
	}
	.y {
		font-size: var(--text-md);
		font-weight: 600;
		min-width: 4ch;
		text-align: center;
	}
	.summary {
		font-size: var(--text-sm);
		color: var(--fg3);
	}

	.card {
		border: 1px solid var(--bd);
		border-radius: var(--radius-xl);
		background: var(--card);
		overflow: hidden;
	}
	.card-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-5);
		padding: 12px 14px;
		border-bottom: 1px solid var(--bd);
	}
	.emoji {
		font-size: var(--text-xl);
	}
	h3 {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 600;
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
	.who {
		margin: 0;
		padding: 8px 14px 0;
		display: flex;
		gap: var(--space-5);
		font-size: var(--text-base);
	}
	.role {
		color: var(--fg1);
	}
	.since {
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
	.lane-count {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* Only when something is actually missing. A red "8/8" would be an alarm
	   about a lane that is complete. */
	.lane-count.short {
		color: var(--red);
	}
	.lane-empty {
		margin: 0;
		font-size: var(--text-sm);
	}

	/* Twelve months plus a label do not fit a phone, and squeezing them makes
	   every cell unreadable rather than making one row inconvenient. */
	.scroll {
		overflow-x: auto;
		overscroll-behavior: contain;
	}
	.cells {
		display: grid;
		grid-template-columns: repeat(var(--columns), minmax(44px, 1fr));
		gap: 3px;
		min-width: 520px;
	}
	.cell-head {
		font-size: var(--text-2xs);
		color: var(--fg3);
		text-align: center;
		padding-bottom: var(--space-2);
	}
	.cell {
		height: 28px;
	}
	.filled,
	.empty,
	.faint {
		display: grid;
		place-items: center;
		width: 100%;
		height: 28px;
		border-radius: var(--radius-sm);
	}
	.filled {
		border: 1px solid var(--bd2);
		background: var(--card3);
		color: var(--fg2);
		font-size: var(--text-2xs);
		cursor: pointer;
	}
	.filled:hover {
		background: var(--card2);
	}
	.filled.open {
		border-color: var(--fg3);
	}
	.many {
		line-height: 1;
	}
	/* A coloured border is for a traffic-light state, which is what a missing
	   period is: it should be there and is not. */
	.cell.gap .empty {
		border: 1px solid var(--red);
	}
	.cell.not-arrived .empty {
		border: 1px dashed var(--bd2);
	}
	.faint {
		border: 1px solid var(--bd);
		opacity: 0.35;
	}

	.loose {
		display: flex;
		flex-direction: column;
	}
	.loose-row {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		width: 100%;
		padding: 8px 0;
		border: 0;
		border-top: 1px solid var(--bd);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.loose-row:first-of-type {
		border-top: 0;
	}
	.loose-row:hover {
		background: var(--card2);
	}
	.loose-name {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.loose-date {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.none {
		margin: 0;
		font-size: var(--text-base);
	}
</style>
