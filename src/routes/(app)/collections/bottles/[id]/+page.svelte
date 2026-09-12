<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * One bottling, opened.
	 *
	 * Two columns, as the handoff draws it. On the left the things that happened
	 * to this bottle — the photograph somebody took of it, what it cost, and
	 * every time it was opened. On the right what it IS: the facts as a row of
	 * small tiles, how many are in the house, and the shape its tasting notes
	 * make.
	 */
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import TastingRadar from '$lib/charts/TastingRadar.svelte';
	import OwnershipRow from '$lib/life/collections/OwnershipRow.svelte';
	import TastingList from '$lib/life/collections/TastingList.svelte';
	import TastingDialog from '$lib/life/collections/TastingDialog.svelte';
	import BottleDialog from '$lib/life/collections/BottleDialog.svelte';
	import { drinkPhase, phaseHue, phaseWord } from '$lib/life/collections/drink-by';
	import { typeWord } from '$lib/life/collections/types';
	import { countryFlag, countryName } from '$lib/life/geo/countries';
	import { personHues } from '$lib/people';
	import { displayCurrency, formatMinor } from '$lib/money';

	let { data, form } = $props();

	const bottle = $derived(data.bottle);
	const year = $derived(Number(data.today.slice(0, 4)));
	const phase = $derived(drinkPhase(bottle, year));

	let logging = $state(false);
	let editing = $state(false);
	let changingPhoto = $state(false);

	$effect(() => {
		if (form?.on === 'tasting') logging = true;
		if (form?.on === 'bottle') editing = true;
		if (form?.on === 'photo') changingPhoto = true;
	});

	const hues = $derived(Object.fromEntries(personHues(data.people.map((one) => one.id)).entries()));

	const flag = $derived(bottle.country ? countryFlag(bottle.country) : '');

	/** Producer · region, with the flag where the country is known. */
	const subtitle = $derived(
		[bottle.producer, [bottle.region, flag].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
	);

	/**
	 * How many tastings mentioned each flavour word.
	 *
	 * Counted here rather than in SQL: the radar needs them normalised against
	 * each other, and the list is already loaded.
	 */
	const mentions = $derived.by(() => {
		const counts: Record<string, { count: number; series: string }> = {};
		for (const one of bottle.tastingList) {
			for (const flavour of one.notes) {
				const seen = counts[flavour.note];
				counts[flavour.note] = {
					count: (seen?.count ?? 0) + 1,
					series: seen?.series ?? flavour.series
				};
			}
		}
		return Object.entries(counts)
			.map(([note, { count, series }]) => ({ note, count, series }))
			.sort((a, b) => b.count - a.count || a.note.localeCompare(b.note));
	});

	/**
	 * The facts, as tiles. Only the ones this bottle actually has.
	 *
	 * An empty tile reading "—" is a question the screen is asking the household,
	 * and a bottle of gin has no vintage to answer with.
	 */
	const facts = $derived(
		[
			{ label: 'Type', value: typeWord(bottle.type), mono: false },
			{ label: 'Vintage', value: bottle.vintage ? String(bottle.vintage) : '', mono: true },
			{ label: 'Age', value: bottle.ageYears ? `${bottle.ageYears} years` : '', mono: true },
			{
				label: 'Region',
				value: [bottle.region, flag].filter(Boolean).join(' ') || countryName(bottle.country ?? ''),
				mono: false
			},
			{ label: 'Grape or cask', value: bottle.grapeOrCask, mono: false },
			{ label: 'ABV', value: bottle.abv ? `${bottle.abv} %` : '', mono: true },
			{ label: 'Size', value: bottle.sizeMl ? `${bottle.sizeMl} ml` : '', mono: true }
		].filter((fact) => fact.value.trim() !== '')
	);
</script>

<ScreenHeader title={bottle.name} caption={subtitle || typeWord(bottle.type)}>
	{#snippet actions()}
		<a class="btn" href="/collections">‹ Collections</a>
		<button class="btn" type="button" onclick={() => (editing = true)}>
			<Icon name="pencil" size={15} /> Edit
		</button>
		<form
			method="POST"
			action="?/delete"
			use:enhance={({ cancel }) => {
				if (!confirm(`Delete ${bottle.name}?`)) cancel();
				return async ({ update }) => update();
			}}
		>
			<button class="btn danger" type="submit" aria-label="Delete this bottle">
				<Icon name="plus" size={15} />
			</button>
		</form>
	{/snippet}
</ScreenHeader>

<div class="columns">
	<div class="stack">
		<!-- ONE photograph, shown WHOLE.
		     The crop the corners were dragged onto goes on the label plate in the
		     cellar; this is the frame it came out of. Cutting the neck off to fill
		     a box is exactly what the person did not photograph. -->
		<div class="card photo" class:empty={!bottle.photo && !changingPhoto}>
			{#if bottle.photo}
				<img src="/files/{bottle.photo}" alt="{bottle.name}, photographed" />
				<div class="over">
					{#if bottle.labelPhoto}
						<span class="cropped" title="The crop that goes on the label">
							<img src="/files/{bottle.labelPhoto}" alt="The label on {bottle.name}" />
						</span>
					{/if}
					<button
						class="btn"
						type="button"
						onclick={() => (changingPhoto = true)}
						aria-label="Photograph it again"
					>
						<Icon name="camera" size={14} />
					</button>
					<form method="POST" action="?/removePhoto" use:enhance>
						<button class="btn" type="submit">Remove</button>
					</form>
				</div>
			{:else if changingPhoto}
				<form class="drop" method="POST" action="?/photo" enctype="multipart/form-data" use:enhance>
					<ActionError message={form?.on === 'photo' ? form.message : null} />
					<UploadDropzone
						name="photo"
						accept=".png,.jpg,.jpeg,.webp,.heic"
						idleText="Drop it, or photograph the bottle"
						description="JPEG, PNG, WebP or HEIC"
						crop
						reportErrors={false}
					/>
					<div class="drop-actions">
						<button class="btn" type="button" onclick={() => (changingPhoto = false)}>Cancel</button
						>
						<button class="btn btn-primary" type="submit">Use it</button>
					</div>
				</form>
			{:else}
				<button class="slot" type="button" onclick={() => (changingPhoto = true)}>
					<Icon name="camera" size={26} />
					<span class="slot-text">
						Photo of the bottle
						<span class="slot-hint">
							Crop it to the label and the crop goes on the bottle in the cellar.
						</span>
					</span>
				</button>
			{/if}
		</div>

		{#if bottle.boughtOn || bottle.boughtWhere || bottle.boughtMinor !== null}
			<section class="card panel">
				<h2 class="label"><Icon name="receipt" size={13} /> Bought</h2>
				<p class="where">
					{#if bottle.boughtWhere}{bottle.boughtWhere}{/if}
					{#if bottle.boughtWhere && bottle.boughtOn}<span class="dot" aria-hidden="true">·</span
						>{/if}
					{#if bottle.boughtOn}<span class="mono">{bottle.boughtOn}</span>{/if}
				</p>
				{#if bottle.boughtMinor !== null && bottle.boughtCurrency}
					<p class="price">
						<span class="display">{formatMinor(bottle.boughtMinor, bottle.boughtCurrency)}</span>
						<span class="unit">{displayCurrency(bottle.boughtCurrency)}</span>
					</p>
				{/if}
				{#if bottle.transactionId}
					<a class="link" href="/money/transactions/{bottle.transactionId}">
						The transaction that paid for it →
					</a>
				{/if}
			</section>
		{/if}

		<section class="card panel">
			<div class="head">
				<h2 class="label"><Icon name="people" size={13} /> Tastings</h2>
				<button class="btn btn-primary" type="button" onclick={() => (logging = true)}>
					Log a tasting
				</button>
			</div>
			<TastingList tastings={bottle.tastingList} {hues} />
			{#if bottle.tastingList.length}
				<p class="footnote">Scores are the household's own, out of 100.</p>
			{/if}
		</section>
	</div>

	<div class="stack">
		<!-- Tiles rather than a list of rows: these are seven short facts read at
		     a glance, and a right-aligned column of them makes the eye travel the
		     width of the card for every one. -->
		<dl class="facts">
			{#each facts as fact (fact.label)}
				<div class="fact">
					<dt>{fact.label}</dt>
					<dd class:mono={fact.mono}>{fact.value}</dd>
				</div>
			{/each}
		</dl>

		<OwnershipRow owned={bottle.owned} opened={bottle.opened} />

		<section class="card panel">
			<h2 class="label"><Icon name="chart" size={13} /> Notes it keeps getting</h2>

			<div class="radar">
				<TastingRadar {mentions} size={280} />
			</div>

			<!-- The window at the foot of the card that shows what the household
			     said about it: the two facts belong together. A bottle with no
			     window says nothing at all rather than drawing an empty row. -->
			{#if phase !== 'keeps'}
				<div class="drink-by">
					<span class="when">
						<span class="tag">Drink by</span>
						<span class="mono">{bottle.drinkFrom ?? '…'} – {bottle.drinkTo ?? '…'}</span>
					</span>
					<span class="phase" style:--ink="var({phaseHue(phase)})">{phaseWord(phase)}</span>
				</div>
			{:else}
				<p class="keeps">Keeps. No drink-by window, so nothing here will tell you to open it.</p>
			{/if}
		</section>
	</div>
</div>

{#if logging}
	<TastingDialog
		people={data.people}
		today={data.today}
		knownFlavours={data.knownFlavours}
		opensOne={bottle.opened < bottle.owned}
		message={form?.on === 'tasting' ? form.message : null}
		onclose={() => (logging = false)}
	/>
{/if}

{#if editing}
	<BottleDialog
		{bottle}
		baseCurrency={data.baseCurrency}
		message={form?.on === 'bottle' ? form.message : null}
		onclose={() => (editing = false)}
	/>
{/if}

<style>
	.danger {
		color: var(--red);
	}
	/* The ✕ is the plus, turned. */
	.danger :global(svg) {
		transform: rotate(45deg);
	}
	.danger:hover {
		border-color: color-mix(in srgb, var(--red) 55%, transparent);
	}

	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--card-gap, 16px);
		align-items: start;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--card-gap, 16px);
		min-width: 0;
	}

	.photo {
		position: relative;
		display: grid;
		place-items: center;
		/* Wide, as the handoff draws it. Taller would give a portrait photograph
		   more height, but an empty slot half a screen deep is what somebody sees
		   first and it is not the point of the page. */
		aspect-ratio: 3 / 2;
		overflow: hidden;
	}
	/* Dashed while empty: it reads as a slot waiting for something rather than
	   as a card that failed to load. */
	.photo.empty {
		border-style: dashed;
		background: none;
	}
	/* `contain`, never `cover`. A photograph of a bottle is a tall thing in a
	   wide box, and cropping it to fill would cut off the neck — which is most of
	   what makes a bottle recognisable. */
	.photo img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	/* The controls float over the photograph, painted with an OPAQUE token:
	   `--card` is translucent in the dark theme, and a floating surface painted
	   with it looks right until somebody switches. */
	.over {
		position: absolute;
		right: var(--space-5);
		bottom: var(--space-5);
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-ctl);
		background: var(--bg2);
	}
	/* The crop, beside the frame it came out of: it says what the cellar will
	   show without being a second picture of the bottle. */
	.cropped {
		display: block;
		width: 34px;
		height: 34px;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.cropped img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.slot {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-5);
		width: 100%;
		height: 100%;
		min-height: auto;
		padding: var(--space-7);
		border: 0;
		background: none;
		color: var(--fg3);
	}
	.slot-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.slot-hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.drop {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		width: 100%;
		padding: 18px 20px;
	}
	.drop-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	.panel {
		padding: 18px 20px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		margin-bottom: var(--space-6);
	}
	.head .label {
		margin: 0;
	}
	.label {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0 0 var(--space-5);
		font-size: var(--text-xs);
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	.where {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.dot {
		margin: 0 var(--space-3);
	}
	.price {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		margin: var(--space-4) 0 0;
		font-size: var(--display-sm);
		color: var(--fg1);
	}
	.price .unit {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		min-height: auto;
		margin-top: var(--space-4);
		padding: 0;
		border: 0;
		background: none;
		font-size: var(--text-sm);
		color: var(--blue);
	}
	.link:hover {
		text-decoration: underline;
	}
	.footnote {
		margin: var(--space-6) 0 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
		gap: var(--space-4);
		margin: 0;
	}
	.fact {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-5) 14px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-ctl);
		background: var(--card);
		min-width: 0;
	}
	.fact dt {
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	.fact dd {
		margin: 0;
		min-width: 0;
		font-size: var(--text-md);
		color: var(--fg1);
	}

	.radar {
		display: flex;
		justify-content: center;
		padding: var(--space-4) 0 var(--space-7);
	}
	.drink-by {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		flex-wrap: wrap;
		padding-top: var(--space-6);
		border-top: 1px solid var(--bd);
	}
	.when {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-4);
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.tag {
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	.phase {
		padding: var(--space-2) var(--space-5);
		border: 1px solid color-mix(in srgb, var(--ink) 40%, transparent);
		border-radius: var(--radius-pill);
		color: color-mix(in srgb, var(--ink) 72%, var(--fg1));
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.keeps {
		margin: 0;
		padding-top: var(--space-6);
		border-top: 1px solid var(--bd);
		font-size: var(--text-sm);
		color: var(--fg3);
	}

	@media (max-width: 899px) {
		.columns {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
