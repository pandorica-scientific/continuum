<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { untrack } from 'svelte';
	import RecurrenceEditor from '$lib/components/RecurrenceEditor.svelte';

	interface Category {
		key: string;
		label: string;
		emoji: string;
	}

	interface Editing {
		eventId: string;
		recurrenceId: string;
		startsAt: string;
		endsAt: string;
		title: string;
		notes: string | null;
		category: string | null;
		allDay: boolean;
		recurring: boolean;
		rrule: string | null;
	}

	let {
		categories,
		tz,
		occurrence = undefined,
		date,
		onclose
	}: {
		categories: Category[];
		tz: string;
		/** The occurrence being edited, or undefined when creating. */
		occurrence?: Editing;
		/** Default date for a new event, YYYY-MM-DD. */
		date: string;
		onclose: () => void;
	} = $props();

	const editing = $derived(Boolean(occurrence));

	/** HH:MM in the household's zone — what the form shows and submits. */
	function localTime(iso: string): string {
		return new Date(iso).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: tz
		});
	}

	function localDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
	}

	let allDay = $state(untrack(() => occurrence?.allDay ?? false));

	// Only asked when the event actually recurs; a single event has nothing to
	// choose between and the question would be noise.
	let scope = $state<'this' | 'following' | 'all'>('this');
</script>

<form class="card editor" method="POST" action="?/saveEvent">
	{#if occurrence}
		<input type="hidden" name="id" value={occurrence.eventId} />
		<input type="hidden" name="recurrenceId" value={occurrence.recurrenceId} />
	{/if}

	<div class="grid">
		<label class="wide">
			<span>Title</span>
			<input name="title" value={occurrence?.title ?? ''} required autocomplete="off" />
		</label>

		<label>
			<span>Date</span>
			<input
				name="date"
				type="date"
				value={occurrence ? localDate(occurrence.startsAt) : date}
				required
			/>
		</label>

		<label>
			<span>Category</span>
			<select name="category">
				<option value="">None</option>
				{#each categories as category (category.key)}
					<option value={category.key} selected={occurrence?.category === category.key}>
						{category.emoji}
						{category.label}
					</option>
				{/each}
			</select>
		</label>

		<label class="tick wide">
			<input type="checkbox" name="allDay" bind:checked={allDay} />
			All day
		</label>

		{#if !allDay}
			<label>
				<span>Starts</span>
				<input
					name="startTime"
					type="time"
					value={occurrence ? localTime(occurrence.startsAt) : '09:00'}
				/>
			</label>
			<label>
				<span>Ends</span>
				<input
					name="endTime"
					type="time"
					value={occurrence ? localTime(occurrence.endsAt) : '10:00'}
				/>
			</label>
		{/if}

		<label class="wide">
			<span>Notes</span>
			<textarea name="notes" rows="2">{occurrence?.notes ?? ''}</textarea>
		</label>
	</div>

	<!-- Recurrence is only offered on the whole series. Changing the rule of a
	     single occurrence is not a thing that can mean anything: an occurrence
	     belongs to its series' rule. -->
	<!-- `!occurrence?.recurring` matters: a single event has no scope radios, so
	     `scope` sits at its 'this' default forever and this block never opened —
	     which meant an existing event could not be given a recurrence at all,
	     only a brand-new one. The hidden scope=all below is what the server
	     receives for those, so the editor belongs open here. -->
	{#if !editing || !occurrence?.recurring || scope === 'all'}
		<div class="recurrence">
			<RecurrenceEditor
				value={occurrence?.rrule ?? null}
				startDate={occurrence ? localDate(occurrence.startsAt) : date}
			/>
		</div>
	{/if}

	{#if occurrence?.recurring}
		<fieldset class="scope">
			<legend>Apply to</legend>
			<label class="tick">
				<input type="radio" name="scope" value="this" bind:group={scope} />
				This event only
			</label>
			<label class="tick">
				<input type="radio" name="scope" value="following" bind:group={scope} />
				This and all later events
			</label>
			<label class="tick">
				<input type="radio" name="scope" value="all" bind:group={scope} />
				Every event in the series
			</label>
		</fieldset>
	{:else if editing}
		<input type="hidden" name="scope" value="all" />
	{/if}

	<div class="actions">
		<button class="btn btn-primary" type="submit">Save</button>
		<button class="btn" type="button" onclick={onclose}>Cancel</button>
		{#if occurrence}
			<button class="btn danger" type="submit" formaction="?/deleteEvent">Delete</button>
		{/if}
	</div>
</form>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px 14px;
	}

	.wide {
		grid-column: 1 / -1;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}

	.recurrence {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding-top: 4px;
		border-top: 1px solid var(--bd2);
	}

	.scope {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 14px;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		padding: 10px 12px;
	}

	legend {
		font-size: var(--text-sm);
		color: var(--fg3);
		padding: 0 5px;
	}

	.tick {
		flex-direction: row;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-md);
		color: var(--fg1);
	}

	.tick input {
		width: auto;
	}

	.actions {
		display: flex;
		gap: var(--space-4);
	}

	.danger {
		margin-left: auto;
		color: var(--red);
	}

	@media (max-width: 40rem) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
