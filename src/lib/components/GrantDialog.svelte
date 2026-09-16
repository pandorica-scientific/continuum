<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// A grant of restricted stock units, entered once: who, from which job, how
	// many, and the schedule they vest on. The expanded tranches are shown before
	// saving so a typo in the count is seen here, not on the chart.
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { messageFromActionResult, shouldCloseAfterAction } from '$lib/actions/result';
	import ActionError from '$lib/components/ActionError.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import { expandSchedule, type Schedule, type ScheduleInterval } from '$lib/equity';

	let {
		people,
		engagements,
		currencies,
		defaultPersonId,
		editing = null,
		onclose
	}: {
		people: { id: string; name: string }[];
		engagements: {
			id: string;
			personId: string;
			employer: string;
			role: string | null;
			endsOn: string | null;
		}[];
		/** Every currency this instance can convert. */
		currencies: string[];
		defaultPersonId: string;
		/** When set, the dialog rewrites this grant's schedule instead of creating one. */
		editing: { id: string; ticker: string; totalUnits: string; currency: string } | null;
		onclose: () => void;
	} = $props();

	let personId = $state(untrack(() => defaultPersonId));
	let mode = $state<'even' | 'cliff' | 'list'>('even');
	let totalUnits = $state(untrack(() => editing?.totalUnits ?? ''));
	let firstVestOn = $state('');
	let cliffOn = $state('');
	let cliffPercent = $state('25');
	let count = $state('4');
	let interval = $state<ScheduleInterval>('yearly');
	let list = $state<{ vestsOn: string; units: string }[]>([{ vestsOn: '', units: '' }]);
	let error = $state<string | null>(null);

	const myEngagements = $derived(engagements.filter((e) => e.personId === personId));

	const MODES = [
		{ value: 'even', label: 'Even' },
		{ value: 'cliff', label: 'Cliff then even' },
		{ value: 'list', label: 'List' }
	];

	// The same expansion the server runs, so what is previewed is what is saved.
	const preview = $derived.by(() => {
		const total = Number(totalUnits);
		if (!(total > 0)) return { rows: [], problem: null as string | null };
		if ((mode === 'even' && !firstVestOn) || (mode === 'cliff' && !cliffOn)) {
			return { rows: [], problem: null };
		}
		let schedule: Schedule;
		if (mode === 'even') schedule = { mode, firstVestOn, count: Number(count), interval };
		else if (mode === 'cliff') {
			schedule = {
				mode,
				cliffOn,
				cliffFraction: Number(cliffPercent) / 100,
				count: Number(count),
				interval
			};
		} else {
			schedule = {
				mode,
				tranches: list
					.filter((t) => t.vestsOn && t.units)
					.map((t) => ({ vestsOn: t.vestsOn, units: Number(t.units) }))
			};
			if (schedule.tranches.length === 0) return { rows: [], problem: null };
		}
		try {
			return { rows: expandSchedule(total, schedule), problem: null };
		} catch (err) {
			return { rows: [], problem: (err as Error).message };
		}
	});
</script>

<Modal title={editing ? `Edit schedule · ${editing.ticker}` : 'Add grant'} {onclose}>
	<form
		method="POST"
		action={editing ? '/salary?/editSchedule' : '/salary?/addGrant'}
		use:enhance={() =>
			async ({ result, update }) => {
				error = messageFromActionResult(result);
				if (shouldCloseAfterAction(result.type)) onclose();
				await update({ reset: false });
			}}
	>
		<input type="hidden" name="mode" value={mode} />
		{#if editing}
			<input type="hidden" name="grantId" value={editing.id} />
			<p class="quiet">
				Tranches that have settled stay as they are; the rest are replaced by this schedule.
			</p>
		{:else}
			<div class="grid">
				<label>
					<span>Whose grant</span>
					<select name="personId" bind:value={personId}>
						{#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
				</label>
				<label>
					<span>Employer</span>
					<select name="engagementId">
						<option value="">—</option>
						{#each myEngagements as e (e.id)}
							<option value={e.id}
								>{e.employer}{e.role ? ` · ${e.role}` : ''}{e.endsOn
									? ` (to ${e.endsOn})`
									: ''}</option
							>
						{/each}
					</select>
				</label>
				<label>
					<span>Ticker</span>
					<input name="ticker" placeholder="ACME.US" required />
				</label>
				<label>
					<span>Currency</span>
					<select name="currency" required>
						{#each currencies as c (c)}<option value={c}>{c}</option>{/each}
					</select>
				</label>
				<label>
					<span>Granted on</span>
					<input type="date" name="grantedOn" required />
				</label>
				<label>
					<span>Label</span>
					<input name="label" placeholder="2026 annual grant" />
				</label>
			</div>
		{/if}

		<div class="grid">
			<label>
				<span>Units granted</span>
				<input name="totalUnits" inputmode="decimal" bind:value={totalUnits} required />
			</label>
		</div>

		<div class="modes">
			<Segmented options={MODES} bind:value={mode} />
		</div>

		<div class="grid">
			{#if mode === 'even'}
				<label>
					<span>First vest</span>
					<input type="date" name="firstVestOn" bind:value={firstVestOn} required />
				</label>
			{:else if mode === 'cliff'}
				<label>
					<span>Cliff date</span>
					<input type="date" name="cliffOn" bind:value={cliffOn} required />
				</label>
				<label>
					<span>Cliff share, %</span>
					<input name="cliffPercent" inputmode="numeric" bind:value={cliffPercent} />
				</label>
			{/if}
			{#if mode !== 'list'}
				<label>
					<span>{mode === 'cliff' ? 'Tranches after the cliff' : 'Tranches'}</span>
					<input name="count" inputmode="numeric" bind:value={count} required />
				</label>
				<label>
					<span>Every</span>
					<select name="interval" bind:value={interval}>
						<option value="monthly">month</option>
						<option value="quarterly">quarter</option>
						<option value="yearly">year</option>
					</select>
				</label>
			{/if}
		</div>

		{#if mode === 'list'}
			<div class="list">
				{#each list as t, i (i)}
					<div class="row">
						<input
							type="date"
							name="trancheDate"
							bind:value={t.vestsOn}
							aria-label="Vests on"
							required
						/>
						<input
							name="trancheUnits"
							inputmode="decimal"
							bind:value={t.units}
							placeholder="units"
							aria-label="Units"
							required
						/>
						<button
							type="button"
							class="btn"
							onclick={() => (list = list.filter((_, j) => j !== i))}
							disabled={list.length === 1}>Remove</button
						>
					</div>
				{/each}
				<button
					type="button"
					class="btn"
					onclick={() => (list = [...list, { vestsOn: '', units: '' }])}>Add tranche</button
				>
			</div>
		{/if}

		{#if preview.problem}
			<p class="quiet">{preview.problem}</p>
		{:else if preview.rows.length}
			<ul class="preview">
				{#each preview.rows as r, i (i)}
					<li><span class="mono">{r.vestsOn}</span><span class="mono">{r.units} units</span></li>
				{/each}
			</ul>
		{/if}

		<ActionError message={error} />
		<div class="row">
			<button type="submit" class="btn btn-primary"
				>{editing ? 'Save schedule' : 'Add grant'}</button
			>
			<button type="button" class="btn" onclick={onclose}>Cancel</button>
		</div>
	</form>
</Modal>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: var(--space-5) var(--space-6);
		align-items: end;
	}
	.grid:empty {
		display: none;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	label > span {
		color: var(--fg3);
		font-size: var(--text-xs);
	}
	.modes {
		display: flex;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		align-items: flex-start;
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.preview {
		list-style: none;
		margin: 0;
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	.preview li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-5);
	}
</style>
