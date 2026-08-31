<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// The Identity shelf as a wallet: one card per document, sectioned by whose
	// it is.
	//
	// The face is ARTWORK, never the scan. Seven scans of seven cards on white
	// A4 look alike, which is exactly the failure a wallet exists to avoid — a
	// person finds their own passport by recognising it, and a page of pale
	// rectangles is slower to read than the list this replaces. The document
	// itself is one click away in the inspector, where it is looked AT rather
	// than looked FOR.
	//
	// Everything else on the card comes from the record: the flag and the code
	// from `country`, the kind from `kind`, the date from the same
	// `expiryTreatment` the list uses. Nothing is painted into the artwork,
	// because artwork is picked by a fallback chain and would otherwise state
	// its own key rather than the document's.
	import EuMark from '$lib/components/EuMark.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PersonTag from '$lib/components/PersonTag.svelte';
	import { documentArtUrl } from '$lib/document-art';
	import { flagEmoji, isEuCountry } from '$lib/countries';
	import { identityKindLabel } from '$lib/documents';
	import { expiryTreatment, readableDate, typeLabel } from '$lib/documents-view';
	import { sectionsByPerson, type LayoutRow } from '$lib/documents-layouts';

	// No `isAdmin`. The lock is drawn on `restricted` alone, exactly as the list
	// row and the inspector draw it, because a member never receives a
	// restricted row to begin with: `visibleDocumentPredicate` removes it in
	// SQL, so `row.restricted` is only ever true for somebody allowed to know.
	// A second rule here would be a second place for the first one to drift.
	let {
		rows,
		people,
		labels,
		today,
		selectedId,
		onopen
	}: {
		rows: LayoutRow[];
		/** `householdPeople` from the layout: the colour is the household's. */
		people: { id: string; name: string; hue: string }[];
		/** What this household calls each type, including the ones it added. */
		labels: Record<string, string>;
		today: string;
		selectedId?: string;
		onopen: (id: string) => void;
	} = $props();

	// A person's colour is assigned over the whole household on the layout, so
	// the tag on a wallet section is the same colour as that person's tag on
	// Salary and on Tax. Looked up rather than derived here: a hue computed from
	// the people who happen to be on this shelf would be a different colour on
	// every screen, which is decoration rather than a tag.
	const hueOf = $derived(new Map(people.map((p) => [p.id, p.hue])));

	const sections = $derived(sectionsByPerson(rows));

	/**
	 * The five grounds every overlay element sits on.
	 *
	 * The ONE place in this repository where a colour is written rather than
	 * taken from a token, and it is deliberate: these are alpha over an unknown
	 * image, not theme colours. Flipping the ink per image was tried and
	 * dropped — the artwork has light and dark passages within a single card, so
	 * no single text colour is safe anywhere on it, and every element carries
	 * its own dark ground instead. There is no token for "readable over a
	 * photograph", and adding one to `app.css` would invite it to be used where
	 * a theme colour belongs.
	 */
	const SUPPORT = 'rgba(10, 13, 19, 0.62)';
	const PILL_GROUND = 'rgba(10, 13, 19, 0.78)';
	const INK = '#f2f5fa';
	const INK_STRONG = 'rgba(242, 245, 250, 0.86)';
	const INK_QUIET = 'rgba(242, 245, 250, 0.76)';

	/**
	 * What a card calls itself: the kind, and only the kind.
	 *
	 * Not the document's name. The section above it already says whose card this
	 * is, so a name reading `Passport · Petr Novák` under a heading reading
	 * `Petr Novák` says the person twice and the kind twice over two lines. A
	 * wallet is read by recognising the card, and `Passport` is what recognises
	 * it; the name the household gave it is in the inspector, one click away,
	 * where it is being read rather than scanned.
	 *
	 * An identity document says which kind of identity document it is; anything
	 * else filed on the shelf falls back to its type, so a birth certificate
	 * still names itself.
	 */
	function cardTitle(row: LayoutRow): string {
		// The kind when it names one — Passport, Driving licence. An identity
		// document whose kind is `other` falls back to its type, which reads
		// "Identity document": true, and better on a card than the word the
		// picker uses for that same choice.
		const kind = row.type === 'id_document' ? identityKindLabel(row.identity?.kind) : null;
		return kind ?? typeLabel(row.type, labels);
	}

	/**
	 * What the date pill says, and in what tone.
	 *
	 * Never empty. A document with date logic says what it does and when
	 * (`expires 4 Aug 2032`); one without — a birth certificate — falls back to
	 * the bare period date with no verb, because there is no behaviour to name.
	 * A slot that looks missing on most cards trains a reader to stop looking at
	 * it, which costs the one card where it was red.
	 */
	function dateChip(row: LayoutRow): { text: string; hue: string | null } | null {
		// `wide`, so the pill says what the date DOES as well as when: a card has
		// room for `expires 4 Aug 2033`, and a bare date leaves a reader to guess
		// whether it is an issue date, a renewal or the day it stops being valid.
		const treatment = expiryTreatment(row, row.subjectArchived, today, 'wide');
		// A pill carries a verb and a hue; the outline treatment the list uses for
		// "added …" does not belong on a card face, where the date that matters is
		// the one the document itself states.
		if (treatment?.kind === 'pill') return { text: treatment.text, hue: treatment.hue };
		const fallback = row.periodOn ?? row.addedOn;
		return fallback ? { text: readableDate(fallback), hue: null } : null;
	}
</script>

{#each sections as section (section.link?.id ?? 'nobody')}
	<section class="wallet-section">
		<h2 class="section-head">
			{#if section.link}
				<PersonTag name={section.label} hue={hueOf.get(section.link.id) ?? '--fg3'} />
			{:else}
				<!-- Nobody is not a person and takes no colour: a tag whose hue meant
				     "no hue" would be one more thing to learn. -->
				<span class="section-name">{section.label}</span>
			{/if}
			<span class="mono section-count">{section.items.length}</span>
			<span class="section-rule"></span>
		</h2>
		<div class="cards">
			{#each section.items as row (row.id)}
				{@const chip = dateChip(row)}
				<button
					type="button"
					class="card-face"
					class:selected={row.id === selectedId}
					style:background-image="url({documentArtUrl(
						row.identity?.country ?? null,
						row.identity?.kind ?? null
					)})"
					onclick={() => onopen(row.id)}
					aria-label="Open {row.name}"
				>
					<span class="overlay">
						{#if row.identity?.country}
							<span class="country" style:background={SUPPORT}>
								<span class="flag">{flagEmoji(row.identity.country)}</span>
								{#if isEuCountry(row.identity.country)}
									<!-- The code goes inside the Union's ring, as it does on the
									     document itself: an EU passport, licence or plate puts the
									     member state's letters in the middle of the twelve stars,
									     and a card that spelled them beside it instead would be
									     the only one in the wallet that did. -->
									<EuMark code={row.identity.country} size={24} />
								{:else}
									<span class="mono code" style:color={INK_STRONG}>{row.identity.country}</span>
								{/if}
							</span>
						{:else}
							<!-- Keeps the name at the foot of the card whether or not there
							     is a chip above it. -->
							<span class="country-gap"></span>
						{/if}

						<span class="foot">
							<span class="support" style:background={SUPPORT}>
								<span class="name-line">
									<span class="name" style:color={INK}>{cardTitle(row)}</span>
									{#if row.restricted}
										<span class="lock" style:color={INK_QUIET}>
											<Icon name="lock" size={11} label="Restricted — admins only" />
										</span>
									{/if}
								</span>
							</span>
							{#if chip}
								<span
									class="date mono"
									style:background={PILL_GROUND}
									style:color={chip.hue ? `var(--${chip.hue})` : INK_QUIET}
									style:border-color={chip.hue ? `var(--${chip.hue})` : 'transparent'}
								>
									{#if chip.hue}<span class="dot" style:background="var(--{chip.hue})"></span>{/if}
									{chip.text}
								</span>
							{/if}
						</span>
					</span>
				</button>
			{/each}
		</div>
	</section>
{/each}

<style>
	.wallet-section + .wallet-section {
		margin-top: var(--space-9);
	}
	.section-head {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--space-5);
		margin: 0 0 var(--space-6);
		font-weight: 500;
	}
	.section-name {
		font-size: var(--text-lg);
		color: var(--fg1);
	}
	.section-count {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.section-rule {
		flex: 1;
		height: 1px;
		background: var(--bd);
	}
	/* auto-fill rather than auto-fit: a wallet holding two cards keeps them
	   card-sized instead of stretching them across the column. */
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(268px, 292px));
		gap: var(--space-8);
	}
	.card-face {
		position: relative;
		/* ID-1, the shape every one of these documents actually is. */
		aspect-ratio: 85.6 / 54;
		overflow: hidden;
		padding: 0;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-xl);
		/* The artwork places its subject on the right and leaves the left quiet;
		   the overlay depends on that, so the crop keeps the right edge. */
		background-color: var(--card3);
		background-size: cover;
		background-position: right center;
		cursor: pointer;
		text-align: left;
	}
	.card-face:hover {
		border-color: var(--fg3);
	}
	.card-face.selected {
		border-color: var(--brand);
	}
	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: space-between;
		padding: 11px 12px 12px;
	}
	.country {
		align-self: flex-end;
		display: inline-flex;
		flex-direction: row;
		align-items: center;
		gap: 5px;
		/* Tighter on the right than the left, because the emblem is a disc and
		   the flag is a rectangle: equal padding reads as more space after it. */
		padding: 3px 5px 3px 7px;
		border-radius: var(--radius-pill);
	}
	.country-gap {
		height: 1px;
	}
	/* Sized against the EU disc beside it rather than against the text ramp's
	   idea of a label: a flag two steps smaller than the mark it sits next to
	   reads as an afterthought, and a flag emoji is wider than it is tall, so it
	   still comes out shorter than the 24px disc at this size. */
	.flag {
		font-size: var(--text-2xl);
		line-height: 1;
	}
	.code {
		font-size: var(--text-2xs);
		letter-spacing: 0.08em;
	}
	.foot {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		max-width: 100%;
	}
	/* A small panel, not a full-width bar: a bar would cover the one thing that
	   makes the card recognisable at a glance. */
	.support {
		display: flex;
		flex-direction: column;
		max-width: 100%;
		padding: 5px 9px 6px;
		border-radius: var(--radius-md);
	}
	.name-line {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 5px;
		min-width: 0;
	}
	.name {
		overflow: hidden;
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.25;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.lock {
		display: inline-flex;
		flex: none;
	}
	.date {
		display: inline-flex;
		flex-direction: row;
		align-items: center;
		gap: 5px;
		padding: 2px 9px;
		border: 1px solid;
		border-radius: var(--radius-pill);
		font-size: var(--text-2xs);
		white-space: nowrap;
	}
	.dot {
		width: 5px;
		height: 5px;
		border-radius: var(--radius-pill);
	}
</style>
