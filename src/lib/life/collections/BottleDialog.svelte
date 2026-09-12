<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Writing a bottle down.
	 *
	 * Typed, not scanned. The barcode column is in the schema from the first
	 * release because the camera is coming, but nothing here reads one — a
	 * half-working scanner in the middle of an add form is worse than no
	 * scanner.
	 *
	 * Everything below the name is optional. A household that knows only "a
	 * bottle of the Portuguese red" should be able to write that down and fill
	 * the rest in when it opens one.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import { ENUMS } from '$lib/enums';
	import { displayCurrency, toMajorString } from '$lib/money';
	import { typeWord } from '$lib/life/collections/types';
	import type { EnumValue } from '$lib/enums';

	interface Existing {
		id: string;
		type: EnumValue<'bottle.type'>;
		producer: string;
		name: string;
		vintage: number | null;
		ageYears: number | null;
		country: string | null;
		region: string;
		grapeOrCask: string;
		abv: string | null;
		sizeMl: number | null;
		drinkFrom: number | null;
		drinkTo: number | null;
		owned: number;
		boughtOn: string | null;
		boughtWhere: string;
		boughtMinor: bigint | null;
		boughtCurrency: string | null;
	}

	let {
		collectionId = null,
		/** Set to change a bottle; absent to write a new one. */
		bottle = null,
		/** What the household counts in, for a price with no currency named. */
		baseCurrency,
		message = null,
		onclose
	}: {
		collectionId?: string | null;
		bottle?: Existing | null;
		baseCurrency: string;
		message?: string | null;
		onclose: () => void;
	} = $props();

	/**
	 * The stored price, as a decimal to edit.
	 *
	 * Minor units are how it is held and not how anybody types it. Blank stays
	 * blank: a bottle whose price nobody recorded must not gain a nought.
	 */
	const price = $derived(
		bottle?.boughtMinor === null || bottle?.boughtMinor === undefined
			? ''
			: toMajorString(bottle.boughtMinor, bottle.boughtCurrency ?? baseCurrency)
	);
</script>

<Modal title={bottle ? `Edit ${bottle.name}` : 'Add a bottle'} {onclose}>
	<form class="body" method="POST" action={bottle ? '?/edit' : '?/newBottle'}>
		<ActionError {message} />
		{#if collectionId}<input type="hidden" name="collectionId" value={collectionId} />{/if}

		<div class="row identity">
			<Field label="Kind">
				<select name="type" value={bottle?.type ?? 'wine'} required>
					{#each ENUMS['bottle.type'] as type (type)}
						<option value={type}>{typeWord(type)}</option>
					{/each}
				</select>
			</Field>
			<Field label="Producer">
				<input name="producer" value={bottle?.producer ?? ''} placeholder="Quinta do Vale" />
			</Field>
			<Field label="Name">
				<input name="name" value={bottle?.name ?? ''} placeholder="Reserva Tinto" required />
			</Field>
		</div>

		<div class="row origin">
			<Field label="Country">
				<input
					name="country"
					value={bottle?.country ?? ''}
					placeholder="PT"
					maxlength="2"
					size="2"
				/>
				<span class="hint">Two letters.</span>
			</Field>
			<Field label="Region">
				<input name="region" value={bottle?.region ?? ''} placeholder="Douro" />
			</Field>
			<Field label="Grape or cask">
				<input
					name="grapeOrCask"
					value={bottle?.grapeOrCask ?? ''}
					placeholder="Touriga Nacional"
				/>
			</Field>
		</div>

		<div class="row numbers">
			<Field label="Vintage">
				<input type="number" name="vintage" value={bottle?.vintage ?? ''} min="1800" max="2200" />
			</Field>
			<Field label="Age">
				<input type="number" name="ageYears" value={bottle?.ageYears ?? ''} min="1" />
				<span class="hint">Years, for a bottle with no vintage.</span>
			</Field>
			<Field label="ABV">
				<input name="abv" value={bottle?.abv ?? ''} placeholder="14.0" />
			</Field>
			<Field label="Size">
				<input type="number" name="sizeMl" value={bottle?.sizeMl ?? ''} placeholder="750" />
				<span class="hint">Millilitres.</span>
			</Field>
		</div>

		<div class="row numbers">
			<Field label="Drink from">
				<input type="number" name="drinkFrom" value={bottle?.drinkFrom ?? ''} min="1800" />
			</Field>
			<Field label="Drink to">
				<input type="number" name="drinkTo" value={bottle?.drinkTo ?? ''} min="1800" />
			</Field>
			<Field label="How many">
				<input type="number" name="owned" value={bottle?.owned ?? 1} min="0" required />
			</Field>
		</div>
		<!-- Said once, here, because it is the rule the rest of the screen keeps:
		     a bottle with no window has no opinion about when to drink it. -->
		<span class="hint">
			Leave both years empty for anything that keeps — gin, rum, most spirits. Nothing will tell you
			to drink it.
		</span>

		<div class="row bought">
			<Field label="Bought on">
				<input type="date" name="boughtOn" value={bottle?.boughtOn ?? ''} />
			</Field>
			<Field label="Bought where">
				<input
					name="boughtWhere"
					value={bottle?.boughtWhere ?? ''}
					placeholder="Brought back from Porto"
				/>
			</Field>
			<Field label="Price">
				<input name="price" value={price} placeholder="620" />
				<span class="hint">In {displayCurrency(bottle?.boughtCurrency ?? baseCurrency)}.</span>
			</Field>
		</div>
		<!-- Carried through the form rather than assumed: a bottle bought abroad
		     keeps the currency it was paid for in, and an edit must not quietly
		     redenominate it into what the household counts in. -->
		<input type="hidden" name="boughtCurrency" value={bottle?.boughtCurrency ?? baseCurrency} />

		<div class="actions">
			<button class="btn" type="button" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" type="submit">{bottle ? 'Save' : 'Add it'}</button>
		</div>
	</form>
</Modal>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.row {
		display: grid;
		align-items: start;
		gap: var(--space-6);
	}
	.identity {
		grid-template-columns: 150px minmax(0, 1fr) minmax(0, 1fr);
	}
	.origin {
		grid-template-columns: 80px minmax(0, 1fr) minmax(0, 1fr);
	}
	.numbers {
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
	}
	.bought {
		grid-template-columns: 170px minmax(0, 1fr) 120px;
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	@media (max-width: 719px) {
		.identity,
		.origin,
		.bought {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
