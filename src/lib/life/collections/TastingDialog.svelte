<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Writing down what a bottle tasted like.
	 *
	 * Logging this is what opens a bottle — the count rises here rather than
	 * behind a separate button, because nobody tastes a bottle they did not open
	 * and asking for two presses is how the counts end up wrong. The dialog says
	 * so out loud, so the number moving is not a surprise.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';

	interface Person {
		id: string;
		name: string;
	}

	let {
		people,
		today,
		/** Flavour words already used anywhere in the cellar, to type against. */
		knownFlavours,
		/** Whether anything sealed is left to open. */
		opensOne,
		message = null,
		onclose
	}: {
		people: Person[];
		today: string;
		knownFlavours: string[];
		opensOne: boolean;
		message?: string | null;
		onclose: () => void;
	} = $props();
</script>

<Modal title="Log a tasting" {onclose}>
	<form class="body" method="POST" action="?/logTasting">
		<ActionError {message} />

		<div class="row">
			<Field label="When">
				<input type="date" name="tastedOn" value={today} required />
			</Field>
			<Field label="Who">
				<select name="personId">
					<option value="">Nobody in particular</option>
					{#each people as one (one.id)}
						<option value={one.id}>{one.name}</option>
					{/each}
				</select>
			</Field>
			<Field label="Score">
				<!-- From 1, not 0: the scale the database holds is 1–100, and a
				     field that offers a number the row refuses is a form that
				     fails on submit. -->
				<input type="number" name="score" min="1" max="100" placeholder="91" />
				<span class="hint">Out of a hundred. Optional.</span>
			</Field>
		</div>

		<Field label="What it was like">
			<textarea
				name="note"
				rows="3"
				placeholder="Still tight when it was opened. Better an hour later."></textarea>
		</Field>

		<Field label="Flavours">
			<input name="flavours" list="cellar-flavours" placeholder="plum, oak, smoke" />
			<datalist id="cellar-flavours">
				{#each knownFlavours as flavour (flavour)}<option value={flavour}></option>{/each}
			</datalist>
			<span class="hint">
				Comma-separated. Three tastings' worth of these draws the shape above.
			</span>
		</Field>

		{#if opensOne}
			<p class="opens">Saving this opens one of the sealed bottles.</p>
		{/if}

		<div class="actions">
			<button class="btn" type="button" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" type="submit">Log it</button>
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
		grid-template-columns: 170px minmax(0, 1fr) 120px;
		align-items: start;
		gap: var(--space-6);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.opens {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--rose);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	@media (max-width: 719px) {
		.row {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
