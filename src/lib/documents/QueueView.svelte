<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// The Inbox: one document at a time, preview left, decision right.
	//
	// v0.7.x had this on a screen of its own that a link took you to, which made
	// the Inbox two things — a shelf that showed you unfiled paper, and a page
	// for doing something about it. The shelf could only show the problem.
	//
	// The decision is three steps because each narrows the next: the shelf
	// decides which cards exist, the card decides which lanes exist, and the
	// lane decides what the paper probably is. A rule proposal pre-answers all
	// three and stays visible until somebody agrees with it.
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import TagField from '$lib/components/TagField.svelte';
	import { documentFileHref } from '$lib/ui/file-viewer';
	import { ALL_TYPES, EXPIRY_VERBS, EXPIRY_VERB_MEANINGS, typeOptionsFor } from '$lib/documents';
	import { typeLabels } from '$lib/documents/view';
	import type { QueuePayload } from '$lib/server/documents/queue-load';

	let {
		queue,
		documentTypes,
		knownTags,
		isAdmin,
		onopen
	}: {
		queue: QueuePayload;
		documentTypes: { key: string; label: string; builtin: boolean }[];
		knownTags: string[];
		isAdmin: boolean;
		onopen: (documentId: string) => void;
	} = $props();

	const current = $derived(queue.waiting.find((d) => d.id === queue.current) ?? null);

	/** The three answers, in the order they narrow each other. */
	let shelfKey = $state('');
	let cardId = $state('');
	let newCardName = $state('');
	let laneId = $state('');
	let type = $state('');
	/** Widening is remembered for the session: somebody who needed all seventeen
	 *  once usually needs them again on the next document. */
	let allTypes = $state(false);
	let confirmingDelete = $state(false);
	/** How many the reviewer has passed over, so Skip can reach the next one. */
	let skipped = $state<string[]>([]);

	const labels = $derived(typeLabels(documentTypes));
	const shelf = $derived(queue.shelves.find((s) => s.key === shelfKey) ?? null);
	const cards = $derived(shelfKey ? (queue.cards[shelfKey] ?? []) : []);
	const lanes = $derived(cardId ? (queue.lanes[cardId] ?? []) : []);

	const typeOptions = $derived.by(() =>
		// The shelf's own list, which is what it offers first. Widening shows all
		// seventeen; nothing is ever refused.
		typeOptionsFor(shelf?.types ?? [], type, labels, allTypes)
	);

	// The proposal pre-answers all three, once, for the document it is about.
	// Re-running on every keystroke would fight the person correcting it.
	let answeredFor = $state<string | null>(null);
	$effect(() => {
		const doc = current?.id ?? null;
		if (doc === answeredFor) return;
		answeredFor = doc;
		confirmingDelete = false;
		const proposal = queue.proposal?.documentId === doc ? queue.proposal : null;
		if (proposal) {
			shelfKey = proposal.shelfKey;
			cardId = proposal.cardId;
			laneId = proposal.laneId;
		} else {
			// The shelf is carried forward; the card and the lane are not. A folder
			// of one employer's payslips files fast; a folder of everything does
			// not file the second document onto the first one's card.
			cardId = '';
			laneId = '';
		}
		newCardName = '';
	});

	// Choosing a lane answers the type question too, where the lane's rule names
	// one. Proposed, never imposed: the select below is still there.
	$effect(() => {
		const chosen = lanes.find((l) => l.id === laneId);
		if (chosen?.impliedType) type = chosen.impliedType;
	});

	/** How often a lane expects paper, in words. */
	const cadencePhrase = (lane: { cadence: string; every: number }): string => {
		if (lane.cadence === 'none') return 'no rhythm';
		if (lane.cadence === 'once') return 'once';
		if (lane.cadence === 'monthly') return 'monthly';
		return lane.every === 1 ? 'yearly' : `every ${lane.every} years`;
	};
</script>

{#if !current}
	<div class="clear">
		<p class="clear-line">Nothing is waiting.</p>
		<p class="quiet">
			An empty Inbox is the only good state for it. Anything captured, scanned or imported without a
			home lands here.
		</p>
	</div>
{:else}
	<section class="panes">
		<div class="preview">
			<div class="preview-head">
				<span class="preview-name">{current.name}</span>
				<span class="mono preview-meta">
					{current.ext} · waiting {current.waitingDays}
					{current.waitingDays === 1 ? 'day' : 'days'}
				</span>
				<span class="mono preview-count">{queue.index + 1} of {queue.waiting.length}</span>
			</div>
			{#if current.storedName}
				<!-- The preview IS the link: a click opens the same viewer the
				     inspector uses, rather than a second button beside it. -->
				<a class="sheet" href={documentFileHref(current.id)} target="_blank">
					<object data={documentFileHref(current.id)} type="application/pdf" title={current.name}>
						<span class="quiet">Open {current.name}</span>
					</object>
				</a>
			{:else}
				<div class="sheet empty">
					<span class="quiet">No file — this document is metadata only.</span>
				</div>
			{/if}
		</div>

		<form
			method="POST"
			action="?/fileFromQueue"
			class="decide"
			use:enhance={() =>
				async ({ update }) => {
					// Filed, so it leaves the queue and the next one takes its place.
					await update({ reset: false });
				}}
		>
			<input type="hidden" name="id" value={current.id} />

			{#if queue.proposal?.documentId === current.id}
				<p class="proposed">
					<Icon name="check" size={14} />
					<span>
						A rule matched: <b>{queue.proposal.cardName}</b> · {queue.proposal.laneLabel}
					</span>
				</p>
			{/if}

			<label class="field">
				<span class="eyebrow">Name</span>
				<input name="name" value={current.name} />
			</label>

			<div class="field">
				<span class="eyebrow">1 · Shelf</span>
				<div class="chips">
					{#each queue.shelves as s (s.key)}
						<label class="pick-chip">
							<input type="radio" name="shelf" value={s.key} bind:group={shelfKey} />
							<span>{s.emoji} {s.label}</span>
						</label>
					{/each}
				</div>
			</div>

			{#if shelf}
				<div class="field">
					<span class="eyebrow">2 · {shelf.unit === 'person' ? 'Who' : 'Which card'}</span>
					{#if cards.length === 0 && !shelf.canCreate}
						<p class="quiet">
							Nothing to file against on {shelf.label} yet.
						</p>
					{:else}
						<div class="chips">
							{#each cards as card (card.id)}
								<label class="pick-chip">
									<input type="radio" name="cardId" value={card.id} bind:group={cardId} />
									<span>{card.emoji} {card.name}</span>
								</label>
							{/each}
							{#if shelf.canCreate}
								<!-- Made on the way past: the moment a person knows the paper
								     is the Octavia's is the moment the shelf needs a card for
								     it, and sending them elsewhere loses the document. -->
								<label class="pick-chip new">
									<input type="radio" name="cardId" value="" bind:group={cardId} />
									<span>+ New card</span>
								</label>
							{/if}
						</div>
						{#if shelf.canCreate && !cardId}
							<input
								name="newCardName"
								class="new-card-name"
								placeholder="Name the new card, or leave blank for none"
								bind:value={newCardName}
							/>
						{/if}
					{/if}
				</div>

				{#if lanes.length > 0 && cardId}
					<div class="field">
						<span class="eyebrow">3 · Lane</span>
						<div class="lanes">
							<label class="lane-option">
								<input type="radio" name="laneId" value="" bind:group={laneId} />
								<span class="lane-name">History</span>
								<span class="quiet">paper with no rhythm</span>
							</label>
							{#each lanes as lane (lane.id)}
								<label class="lane-option">
									<input type="radio" name="laneId" value={lane.id} bind:group={laneId} />
									<span class="lane-name">{lane.label}</span>
									<span class="quiet">{cadencePhrase(lane)}</span>
								</label>
							{/each}
						</div>
					</div>
				{/if}
			{/if}

			<label class="field">
				<span class="eyebrow">Type</span>
				<select name="type" bind:value={type}>
					{#each typeOptions as [code, label] (code)}
						<option value={code}>{label}</option>
					{/each}
				</select>
				{#if !allTypes && typeOptions.length < Object.keys(labels).length}
					<button type="button" class="widen" onclick={() => (allTypes = true)}>
						{ALL_TYPES}
					</button>
				{/if}
			</label>

			<div class="field expiry">
				<span class="eyebrow">Expiry</span>
				<div class="expiry-row">
					<select name="expiryVerb" aria-label="What the date means">
						{#each EXPIRY_VERBS as verb (verb)}
							<option value={verb}>{verb} — {EXPIRY_VERB_MEANINGS[verb]}</option>
						{/each}
					</select>
					<input type="date" name="expiresOn" aria-label="Expiry date" />
				</div>
			</div>

			<div class="field">
				<span class="eyebrow">Tags</span>
				<TagField known={knownTags} />
			</div>

			<label class="field"><span class="eyebrow">Note</span><textarea name="note"></textarea></label
			>

			{#if isAdmin}
				<label class="restricted">
					<input type="checkbox" name="sensitivity" value="restricted" />
					<span>Restricted — only admins can see it exists</span>
				</label>
			{/if}

			<div class="foot">
				<button type="submit" class="btn btn-primary">File it</button>
				{#if queue.waiting.length > 1}
					<!-- Skip files nothing and deletes nothing: it moves the document
					     to the back of what this reviewer is looking at, and the queue
					     itself is unchanged. -->
					<button
						type="button"
						class="btn"
						onclick={() => {
							skipped = [...skipped, current.id];
							const next = queue.waiting.find(
								(d) => !skipped.includes(d.id) && d.id !== current.id
							);
							if (next) onopen(next.id);
						}}
					>
						Skip
					</button>
				{/if}
				{#if confirmingDelete}
					<button type="submit" class="btn danger" formaction="?/deleteDocument">
						Delete for good
					</button>
					<button type="button" class="btn" onclick={() => (confirmingDelete = false)}>
						Keep it
					</button>
				{:else}
					<button type="button" class="btn ghost-danger" onclick={() => (confirmingDelete = true)}>
						Delete
					</button>
				{/if}
			</div>
		</form>
	</section>
{/if}

<style>
	.panes {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 380px;
		gap: var(--space-8);
		align-items: start;
	}
	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}
	.preview-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.preview-name {
		font-size: var(--text-xl);
		font-weight: 600;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.preview-meta,
	.preview-count {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.preview-count {
		margin-left: auto;
	}
	/* Letterboxed, never cropped: a tall receipt cropped to a square is a
	   receipt with its total cut off. */
	/* Letterboxed, the way a sheet of paper sits on a desk: the gradient gives
	   the preview an edge without a second border inside the card's own. */
	.sheet {
		display: grid;
		place-items: center;
		min-height: 420px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: linear-gradient(160deg, var(--surface-3), var(--card));
		overflow: hidden;
	}
	.sheet object {
		width: 100%;
		height: 480px;
	}
	.decide {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		padding: var(--space-7);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--surface);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	/* What the rule thinks, above what is settled. It stays visible after the
	   fields are answered, because a guess that vanishes cannot be corrected. */
	.proposed {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin: 0;
		padding: var(--space-5) var(--space-6);
		border: 1px solid color-mix(in srgb, var(--blue) 45%, transparent);
		border-radius: var(--radius-tile);
		background: var(--blue-wash);
		font-size: var(--text-sm);
		color: var(--fg1);
	}
	.pick-chip.new {
		border-style: dashed;
	}
	.new-card-name {
		margin-top: var(--space-3);
	}
	.lanes {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.lane-option {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		font-size: var(--text-md);
		cursor: pointer;
	}
	.lane-option:has(input:checked) {
		border-color: var(--bd2);
		background: var(--card3);
	}
	.lane-name {
		color: var(--fg1);
	}
	.lane-option .quiet {
		margin-left: auto;
	}
	.expiry-row {
		display: flex;
		gap: var(--space-4);
	}
	.expiry-row select {
		flex: 1 1 auto;
		min-width: 0;
	}
	.widen {
		align-self: flex-start;
		border: 0;
		background: none;
		padding: 0;
		color: var(--fg3);
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.widen:hover {
		color: var(--fg1);
	}
	.restricted {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
		border-top: 1px solid var(--bd);
		padding-top: var(--space-6);
	}
	.danger {
		border-color: var(--red);
		color: var(--red);
	}
	.ghost-danger {
		margin-left: auto;
		border-color: transparent;
		color: var(--fg3);
	}
	.ghost-danger:hover {
		color: var(--red);
	}
	.clear {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-8);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--surface);
	}
	.clear-line {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: 600;
	}
	@media (max-width: 1100px) {
		.panes {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
