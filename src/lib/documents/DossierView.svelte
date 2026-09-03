<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// A dossier shelf: one card per unit, each holding lanes, each lane holding
	// cells — and, at the end, the paper with no rhythm.
	//
	// The shape came from Income & Tax, where the shelf's failure is a payslip
	// that never arrived and a list of forty slips looks the same whether or not
	// February is among them. A car's road tax and a flat's boiler inspection
	// fail the same way, so the same card draws all three.
	//
	// A lane's cells are the Statements ribbon's arithmetic pointed at a
	// different question, and what a lane EXPECTS comes from when the
	// relationship began rather than from the paper: a year before the first
	// filed document still reads as missing, which is the whole reason a card
	// carries a bound.
	import Icon from '$lib/components/Icon.svelte';
	import PeriodListing from '$lib/statements/PeriodListing.svelte';
	import { enhance } from '$app/forms';
	import type { DossierLane, DossierPayload } from '$lib/server/documents/dossier-load';
	import type { ProposalRow } from '$lib/server/organisations/proposals-load';

	let {
		dossier,
		proposals,
		closed,
		shelfKey,
		onopen,
		onyear,
		onclosed
	}: {
		dossier: DossierPayload;
		/** What the lanes think should be filed. Computed, never stored. */
		proposals: ProposalRow[];
		/** Card ids collapsed to one line, from the address. */
		closed: string[];
		shelfKey: string;
		onopen: (documentId: string) => void;
		onyear: (year: number) => void;
		onclosed: (ids: string[]) => void;
	} = $props();

	const canGoBack = $derived(dossier.year > dossier.firstYear);
	const canGoForward = $derived(dossier.year < dossier.lastYear);

	/** The cell whose contents are listed, if any. */
	let open = $state<{ laneId: string; key: string } | null>(null);
	/** The card whose "New card" form is showing. */
	let adding = $state(false);
	/** Which card's rename/archive menu is open. */
	let menuFor = $state<string | null>(null);

	const isOpen = (laneId: string, key: string): boolean =>
		open?.laneId === laneId && open.key === key;

	function pressed(laneId: string, key: string, documentIds: string[]) {
		// One document opens; several list. A menu of one is not a choice.
		if (documentIds.length === 1) {
			onopen(documentIds[0]);
			return;
		}
		open = isOpen(laneId, key) ? null : { laneId, key };
	}

	/** A card is collapsed to one line by its own header, kept in the address. */
	function toggle(cardId: string | null) {
		if (cardId === null) return;
		const next = closed.includes(cardId)
			? closed.filter((id) => id !== cardId)
			: [...closed, cardId];
		onclosed(next);
	}

	/** How often a lane expects paper, in words. */
	const cadencePhrase = (lane: DossierLane): string => {
		if (lane.cadence === 'none') return 'no rhythm';
		if (lane.cadence === 'once') return 'once';
		if (lane.cadence === 'monthly') return 'monthly';
		return lane.every === 1 ? 'yearly' : `every ${lane.every} years`;
	};

	/**
	 * Where each cell starts, 1-based, as a CSS grid column.
	 *
	 * The running sum of the spans before it — not the index. A lane running
	 * every two years has its second cell at column 3, and using the index put
	 * every cell after the first one column too far left, overlapping its
	 * neighbour.
	 */
	function columnStarts(lane: DossierLane): number[] {
		let at = 1;
		return lane.cells.map((cell) => {
			const start = at;
			at += cell.span;
			return start;
		});
	}

	/** How many columns the whole lane occupies. */
	const columnCount = (lane: DossierLane): number =>
		lane.cells.reduce((n, cell) => n + cell.span, 0);

	const columnLabel = (lane: DossierLane, key: string): string =>
		lane.cadence === 'monthly'
			? `${lane.cells.find((c) => c.key === key)?.label ?? ''} ${key.slice(0, 4)}`
			: (lane.cells.find((c) => c.key === key)?.label ?? key);

	const openLane = $derived(
		open ? (dossier.cards.flatMap((c) => c.lanes).find((l) => l.id === open!.laneId) ?? null) : null
	);
	/** Every document a card holds, by id, so an open cell can name its own. */
	const documentsById = $derived(
		new Map(
			dossier.cards
				.flatMap((c) => [...c.lanes.flatMap((l) => l.documents), ...c.history, c.pinned])
				.filter((d) => d !== null)
				.map((d) => [d.id, d])
		)
	);
	const openDocuments = $derived(
		openLane && open
			? (openLane.cells
					.find((c) => c.key === open!.key)
					?.documentIds.map((id) => documentsById.get(id))
					.filter((d) => d !== undefined) ?? [])
			: []
	);

	/** The worst thing a collapsed card is hiding, in one phrase. */
	function finding(card: DossierPayload['cards'][number]): string {
		if (card.findings === 0) return `${card.documentCount} filed`;
		const short = card.lanes.find((l) => l.gaps > 0);
		return short ? `${card.findings} missing · ${short.label}` : `${card.findings} missing`;
	}
</script>

<section class="dossier" aria-label="Cards on this shelf">
	<header>
		<div class="year">
			<button
				type="button"
				aria-label="Previous year"
				disabled={!canGoBack}
				onclick={() => onyear(dossier.year - 1)}
			>
				<Icon name="chevronLeft" size={16} />
			</button>
			<span class="mono y">{dossier.year}</span>
			<button
				type="button"
				aria-label="Next year"
				disabled={!canGoForward}
				onclick={() => onyear(dossier.year + 1)}
			>
				<Icon name="chevronRight" size={16} />
			</button>
		</div>
		<span class="summary">
			{dossier.cards.length}
			{dossier.cards.length === 1 ? 'card' : 'cards'}
		</span>
	</header>

	{#if proposals.length > 0}
		<!-- What the lanes THINK, above what is settled. Proposed and not filed:
		     a wrong link looks exactly like a right one and nobody re-reads it,
		     so the guess stays visible until somebody agrees with it.

		     Dismissing files nothing and costs the lane its standing — enough of
		     those and it stops proposing, without anybody having to find it. -->
		<div class="proposals">
			<div class="proposals-head">
				<span class="eyebrow">Not filed against anyone yet</span>
				<span class="mono proposals-count">{proposals.length}</span>
			</div>
			{#each proposals as proposal (proposal.documentId)}
				<div class="proposal">
					<button type="button" class="proposal-name" onclick={() => onopen(proposal.documentId)}>
						{proposal.documentName}
					</button>
					<span class="proposal-guess">
						{proposal.organisationEmoji}
						{proposal.organisationName}
						<span class="quiet">· {proposal.laneLabel}</span>
					</span>
					<form method="POST" action="?/acceptProposal" use:enhance class="proposal-act">
						<input type="hidden" name="documentId" value={proposal.documentId} />
						<input type="hidden" name="laneId" value={proposal.laneId} />
						<input type="hidden" name="organisationId" value={proposal.organisationId} />
						<button type="submit" class="btn small btn-primary">File it</button>
					</form>
					<form method="POST" action="?/dismissProposal" use:enhance>
						<input type="hidden" name="laneId" value={proposal.laneId} />
						<button type="submit" class="btn small">Not this one</button>
					</form>
				</div>
			{/each}
		</div>
	{/if}

	{#each dossier.cards as card (card.id ?? 'unassigned')}
		{@const shut = card.id !== null && closed.includes(card.id)}
		<article class="card" class:shut>
			<!-- The header is the collapse control. A card with a finding sorts to
			     the top and says what it is hiding even when it is one line. -->
			<div class="card-head">
				<span class="emoji" aria-hidden="true">{card.emoji}</span>
				{#if card.id === null}
					<h3>{card.name}</h3>
				{:else}
					<button
						type="button"
						class="card-toggle"
						aria-expanded={!shut}
						onclick={() => toggle(card.id)}
					>
						<h3>{card.name}</h3>
					</button>
				{/if}
				{#if card.kind !== 'other' && card.kind !== card.name.toLowerCase()}
					<span class="mono chip">{card.kind}</span>
				{/if}
				<span class="mono card-count" class:alert={card.findings > 0}>
					{shut
						? finding(card)
						: `${card.documentCount} ${card.documentCount === 1 ? 'document' : 'documents'}`}
				</span>
				{#if card.id !== null && dossier.canCreate}
					<!-- Rename and archive live on the card, which is where the thing
					     is. The rail used to carry them, one list away from the paper
					     they are about. -->
					<button
						type="button"
						class="card-chevron"
						aria-label="More for {card.name}"
						onclick={() => (menuFor = menuFor === card.id ? null : card.id)}
					>
						<Icon name="dots" size={16} />
					</button>
				{/if}
				{#if card.id !== null}
					<button
						type="button"
						class="card-chevron"
						aria-label="{shut ? 'Open' : 'Collapse'} {card.name}"
						onclick={() => toggle(card.id)}
					>
						<Icon name={shut ? 'chevronRight' : 'chevronDown'} size={16} />
					</button>
				{/if}

				{#if menuFor === card.id && card.id !== null}
					{@const cardId = card.id}
					<div class="card-menu">
						<form
							method="POST"
							action={dossier.unit === 'organisation' ? '?/renameOrganisation' : '?/renameSubject'}
							use:enhance={() =>
								async ({ update }) => {
									menuFor = null;
									await update();
								}}
						>
							<input type="hidden" name="id" value={cardId} />
							<input name="name" value={card.name} aria-label="Name" />
							<button type="submit" class="btn small btn-primary">Rename</button>
						</form>
						<form
							method="POST"
							action={dossier.unit === 'organisation' ? '?/deleteOrganisation' : '?/archiveSubject'}
							use:enhance={() =>
								async ({ update }) => {
									menuFor = null;
									await update();
								}}
						>
							<input type="hidden" name="id" value={cardId} />
							<button type="submit" class="btn small">
								{dossier.unit === 'organisation' ? 'Remove' : 'Archive'}
							</button>
						</form>
						<button type="button" class="btn small" onclick={() => (menuFor = null)}>Close</button>
					</div>
				{/if}
			</div>

			{#if !shut}
				{#if card.meta}
					<!-- The CURRENT role, and when the whole relationship began — which
					     after a promotion are two different years, and both matter: the
					     role says what somebody is, the date says what the lanes count
					     from. -->
					<p class="who">{card.meta}</p>
				{/if}

				{#if card.pinned}
					{@const pinned = card.pinned}
					<!-- The paper the relationship rests on: the contract, the lease,
					     the purchase. One click from every cell it explains. -->
					<button type="button" class="pinned" onclick={() => onopen(pinned.id)}>
						<Icon name="pin" size={14} />
						<span class="pinned-name">{pinned.name}</span>
						<span class="mono pinned-date">{pinned.periodOn ?? pinned.addedOn}</span>
					</button>
				{/if}

				{#each card.lanes as lane (lane.id)}
					<div class="lane">
						<div class="lane-head">
							<span class="lane-label">{lane.label}</span>
							{#if lane.personName}<span class="quiet lane-who">{lane.personName}</span>{/if}
							<span class="quiet lane-cadence">{cadencePhrase(lane)}</span>
							{#if lane.cadence !== 'none'}
								<span class="mono lane-count" class:short={lane.gaps > 0}>
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
											<span class="quiet loose-type">{doc.typeLabel}</span>
											<span class="mono loose-date">{doc.periodOn ?? doc.addedOn}</span>
										</button>
									{/each}
								</div>
							{/if}
						{:else if lane.cadence === 'once'}
							<!-- A slot. One cell carrying the lane's own name, because a
							     nameless square says nothing about which paper is missing. -->
							{#each lane.cells as cell (cell.key)}
								<div class="slot cell {cell.state}">
									{#if cell.state === 'filed'}
										<button
											type="button"
											class="filled slot-face"
											onclick={() => pressed(lane.id, cell.key, cell.documentIds)}
											aria-label="Open {lane.label}"
										>
											<span class="slot-name">{lane.label}</span>
											<span class="mono slot-date">
												{documentsById.get(cell.documentIds[0])?.periodOn ??
													documentsById.get(cell.documentIds[0])?.addedOn ??
													''}
											</span>
										</button>
									{:else}
										<span class="empty slot-face" aria-label="{lane.label} is not filed">
											<span class="slot-name">{lane.label}</span>
											<span class="quiet slot-date">not filed</span>
										</span>
									{/if}
								</div>
							{/each}
						{:else}
							<div class="scroll">
								<div class="cells" style:--columns={columnCount(lane)}>
									{#each lane.cells as cell, i (cell.key)}
										<span
											class="mono cell-head"
											style:grid-column="{columnStarts(lane)[i]} / span {cell.span}"
										>
											{cell.label}
										</span>
									{/each}
									{#each lane.cells as cell, i (cell.key)}
										<div
											class="cell {cell.state}"
											style:grid-column="{columnStarts(lane)[i]} / span {cell.span}"
										>
											{#if cell.state === 'filed'}
												<button
													type="button"
													class="filled"
													class:open={isOpen(lane.id, cell.key)}
													onclick={() => pressed(lane.id, cell.key, cell.documentIds)}
													aria-label="{cell.documentIds.length > 1
														? `List the ${cell.documentIds.length} documents for`
														: 'Open the document for'} {columnLabel(lane, cell.key)}"
												>
													{#if cell.documentIds.length > 1}
														<span class="mono many">{cell.documentIds.length}</span>
													{/if}
												</button>
											{:else if cell.state === 'before'}
												<span class="faint" aria-label="Before this began"></span>
											{:else}
												<span
													class="empty"
													aria-label="{cell.state === 'gap'
														? 'Missing'
														: 'Not arrived yet'}: {columnLabel(lane, cell.key)}"
												></span>
											{/if}
										</div>
									{/each}
								</div>
							</div>

							{#if open?.laneId === lane.id && openDocuments.length > 0}
								<PeriodListing
									title={columnLabel(lane, open.key)}
									subtitle={card.name}
									documents={openDocuments}
									{onopen}
									onclose={() => (open = null)}
								/>
							{/if}
						{/if}
					</div>
				{/each}

				{#if card.history.length > 0}
					<!-- Everything on the card is either in a lane above or here. An
					     invisible document is worse than a missing one. -->
					<div class="lane">
						<div class="lane-head">
							<span class="lane-label">
								{dossier.historyOrder === 'oldest' ? 'Records' : 'History'}
							</span>
							<span class="quiet lane-cadence">
								{dossier.historyOrder === 'oldest' ? 'oldest first' : 'no rhythm'}
							</span>
							<span class="mono lane-count">{card.history.length}</span>
						</div>
						<div class="loose">
							{#each card.history as doc (doc.id)}
								<button type="button" class="loose-row" onclick={() => onopen(doc.id)}>
									<span class="loose-name">{doc.name}</span>
									<span class="quiet loose-type">{doc.typeLabel}</span>
									<span class="mono loose-date">{doc.periodOn ?? doc.addedOn}</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if card.lanes.length === 0 && card.history.length === 0 && !card.pinned}
					<p class="quiet lane-empty pad">Nothing filed here yet.</p>
				{/if}
			{/if}
		</article>
	{/each}

	{#if dossier.canCreate}
		<!-- Only a subject or an organisation is made here. A person, an account
		     and a flat have screens of their own, and a card for each exists the
		     moment the record does. -->
		{#if adding}
			<form method="POST" action="?/addCard" use:enhance class="card new-form">
				<input type="hidden" name="shelf" value={shelfKey} />
				<label>
					<span class="eyebrow">Name</span>
					<input name="name" placeholder="Škoda Octavia" required />
				</label>
				<label class="narrow">
					<span class="eyebrow">Emoji</span>
					<input name="emoji" placeholder="🚗" maxlength="4" />
				</label>
				{#if dossier.unit === 'organisation'}
					<label class="narrow">
						<span class="eyebrow">What it is to you</span>
						<select name="kind">
							<option value="employer">Employer</option>
							<option value="authority">Authority</option>
							<option value="insurer">Insurer</option>
							<option value="other">Other</option>
						</select>
					</label>
				{/if}
				<div class="new-actions">
					<button type="submit" class="btn btn-primary">Add card</button>
					<button type="button" class="btn" onclick={() => (adding = false)}>Cancel</button>
				</div>
			</form>
		{:else}
			<button type="button" class="new-card" onclick={() => (adding = true)}>
				<Icon name="plus" size={15} />
				New card
			</button>
		{/if}
	{/if}

	{#if dossier.cards.length === 0 && !dossier.canCreate}
		<p class="quiet none">Nothing is on this shelf yet.</p>
	{/if}
</section>

<style>
	.dossier {
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

	.proposals {
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--surface);
		overflow: hidden;
	}
	.proposals-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-5);
		padding: 10px 14px;
		border-bottom: 1px solid var(--bd);
	}
	.eyebrow {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	.proposals-count {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.proposal {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
		padding: 8px 14px;
		border-top: 1px solid var(--bd);
	}
	.proposal:first-of-type {
		border-top: 0;
	}
	.proposal-name {
		border: 0;
		background: transparent;
		padding: 0;
		font-size: var(--text-md);
		color: var(--fg1);
		text-align: left;
		cursor: pointer;
	}
	.proposal-guess {
		font-size: var(--text-base);
		color: var(--fg2);
	}
	.proposal-act {
		margin-left: auto;
	}

	.card-toggle {
		border: 0;
		background: none;
		padding: 0;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}
	/* Under the header, not floating: a menu of two forms is content, and a
	   popover would need a shadow to say where the page stopped. */
	.card-menu {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
		padding: var(--space-5) var(--space-7);
		border-bottom: 1px solid var(--bd);
		background: var(--card2);
	}
	.card-menu form {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.card-chevron {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: 0;
		background: none;
		color: var(--fg3);
		cursor: pointer;
	}
	.card-chevron:hover {
		color: var(--fg1);
	}
	/* A collapsed card says what it is hiding. A dimmed one-line row that only
	   said its name would be a card you have to open to learn anything from. */
	.card-count.alert {
		color: var(--red);
	}
	.pinned {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		width: 100%;
		padding: 8px 14px;
		border: 0;
		border-bottom: 1px solid var(--bd);
		background: transparent;
		color: var(--fg1);
		font-size: var(--text-md);
		text-align: left;
		cursor: pointer;
	}
	.pinned:hover {
		background: var(--card2);
	}
	.pinned-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pinned-date {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.lane-who,
	.lane-cadence {
		font-size: var(--text-xs);
	}
	/* A slot is a cell with a name in it. A nameless square says nothing about
	   WHICH paper is missing, which is the only thing a slot is for. */
	.slot {
		height: auto;
	}
	.slot-face {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 1px;
		width: 100%;
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		text-align: left;
	}
	.slot-name {
		color: var(--fg1);
	}
	.slot .empty .slot-name {
		color: var(--red);
	}
	.slot-date {
		font-size: var(--text-2xs);
		color: var(--fg3);
	}
	.loose-type {
		font-size: var(--text-xs);
	}
	.lane-empty.pad {
		padding: 10px 14px;
	}
	.new-card {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		padding: var(--space-6);
		border: 1px dashed var(--bd2);
		border-radius: var(--radius-xl);
		background: transparent;
		color: var(--fg3);
		font-size: var(--text-md);
		cursor: pointer;
	}
	.new-card:hover {
		color: var(--fg1);
		background: var(--card);
	}
	.new-form {
		display: flex;
		align-items: flex-end;
		gap: var(--space-6);
		flex-wrap: wrap;
		padding: var(--space-7);
	}
	.new-form label {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		flex: 1 1 220px;
	}
	.new-form label.narrow {
		flex: 0 1 150px;
	}
	.new-actions {
		display: flex;
		gap: var(--space-4);
	}
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
	/* The card's own emoji in a 36px tile, the shape every other head on the
	   product uses — a bare glyph put the name at a different left edge on
	   every card, depending on how wide the emoji happened to render. */
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
	h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 650;
		letter-spacing: -0.01em;
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
