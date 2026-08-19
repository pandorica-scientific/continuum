<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { selectedDayForMonth } from '$lib/ui/state';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import EventDialog from '$lib/components/EventDialog.svelte';
	import InfoHint from '$lib/components/InfoHint.svelte';
	import ActionError from '$lib/components/ActionError.svelte';

	let { data, form } = $props();

	// Which occurrence the editor is open on: an occurrence, 'new', or null.
	let editing = $state<'new' | { eventId: string; recurrenceId: string } | null>(null);

	const editingOccurrence = $derived.by(() => {
		// Captured before the closure: narrowing `editing` in the condition does not
		// survive into the callback, because it is a reassignable $state.
		const target = editing;
		if (!target || target === 'new') return undefined;
		return data.occurrences.find(
			(o) => o.eventId === target.eventId && o.recurrenceId === target.recurrenceId
		);
	});

	// Clicking a day filters the agenda; clicking it again clears.
	let selectedDay = $derived<string | null>(null);
	$effect(() => {
		selectedDay = selectedDayForMonth(
			selectedDay,
			data.cells.flatMap((cell) => (cell ? [cell.date] : [])),
			data.today
		);
	});

	// One list, both kinds, in date order. A day's agenda is what is happening
	// that day; which half of the app wrote each line is a detail shown on the row.
	const agenda = $derived(
		[
			...data.agenda.map((e) => ({
				kind: 'ledger' as const,
				date: e.date,
				day: e.day,
				time: null as string | null,
				marker: e.marker,
				label: e.label,
				occurrence: undefined
			})),
			...data.occurrences.map((o) => ({
				kind: 'authored' as const,
				date: o.date,
				day: o.date.slice(8),
				time: o.time,
				marker: o.marker,
				label: o.title,
				occurrence: o
			}))
		]
			.filter((e) => !selectedDay || e.date === selectedDay)
			.sort((a, b) =>
				a.date === b.date ? (a.time ?? '').localeCompare(b.time ?? '') : a.date < b.date ? -1 : 1
			)
	);

	const ledgerCount = $derived(data.agenda.length);
	const ourCount = $derived(data.occurrences.length);
</script>

<ScreenHeader
	title="Calendar"
	caption="What the household has on, and what the ledger knows is coming."
/>

<section class="sources">
	<div class="chips">
		<span class="chip"><span class="dot" style="background: var(--yellow);"></span>Ledger</span>
		<span class="chip"><span class="dot" style="background: var(--indigo);"></span>Ours</span>
		{#each data.accounts as account (account.id)}
			<span class="chip" class:muted={!account.connected || account.failing}>
				<span
					class="dot"
					style="background: {account.failing
						? 'var(--red)'
						: account.connected
							? 'var(--green)'
							: 'var(--fg3)'};"
				></span>
				{account.label}
				{account.failing
					? '· not syncing'
					: account.connected
						? '· syncing'
						: '· no calendar chosen'}
			</span>
		{/each}
	</div>
	<span class="eyebrow-caption">
		{data.accounts.length === 0
			? 'no calendar connected yet'
			: `${data.accounts.filter((a) => a.connected && !a.failing).length} of ${data.accounts.length} syncing`}
	</span>
</section>

{#if data.conflicts.length > 0}
	<!-- The briefing raises these and sends people here, so here is where they can
	     be cleared. Acknowledging is a button rather than a side effect of the
	     page loading: a discarded edit and a date that changed in the ledger are
	     things someone should have to say they have seen. -->
	<section class="card conflicts" aria-labelledby="sync-conflicts">
		<div class="eyebrow-row">
			<span class="eyebrow" id="sync-conflicts">Sync noticed</span>
			<form method="POST" action="?/acknowledgeConflicts">
				<button class="btn" type="submit">
					Mark {data.conflicts.length === 1 ? 'it' : 'all'} seen
				</button>
			</form>
		</div>
		{#each data.conflicts as conflict (conflict.id)}
			<p class="conflict">
				<span class="c-when mono">{conflict.detectedAt.slice(0, 10)}</span>
				<span>
					{#if conflict.resolution === 'wrote-back'}
						<strong>{conflict.title}</strong> moved in a connected calendar, and the date was written
						into the ledger.
					{:else}
						<strong>{conflict.title}</strong> was changed in two places at once; the
						{conflict.resolution === 'local-won' ? 'version here' : 'remote version'} won and the other
						was discarded.
					{/if}
				</span>
			</p>
		{/each}
	</section>
{/if}

<section class="layout">
	<div class="card cal">
		<div class="cal-head">
			<button type="button" class="btn" onclick={() => goto(`?m=${data.prev}`, { noScroll: true })}
				>←</button
			>
			<span class="month">{data.monthLabel}</span>
			<button type="button" class="btn" onclick={() => goto(`?m=${data.next}`, { noScroll: true })}
				>→</button
			>
			<span class="count">
				{ledgerCount + ourCount} events · {ourCount} yours, {ledgerCount} from the ledger
			</span>
		</div>
		<div class="grid">
			{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as w (w)}
				<span class="weekday">{w}</span>
			{/each}
			{#each data.cells as cell, i (i)}
				{#if cell === null}
					<span></span>
				{:else}
					<button
						type="button"
						class="day"
						class:today={cell.isToday}
						class:selected={selectedDay === cell.date}
						class:has-events={cell.events > 0}
						onclick={() => (selectedDay = cell.date)}
					>
						<span class="mono num">{cell.num}</span>
						<span class="dots">
							{#each { length: Math.min(cell.events, 4) }, d (d)}
								<span class="dot" style="background: var(--yellow);"></span>
							{/each}
						</span>
					</button>
				{/if}
			{/each}
		</div>

		<div class="agenda">
			<div class="eyebrow-row" style="padding-bottom: 6px;">
				<span class="eyebrow">{selectedDay ? `Agenda · ${selectedDay}` : 'Agenda'}</span>
				<span class="eyebrow-caption">
					{selectedDay ? 'click the day again to clear' : 'click a day to filter'}
				</span>
				<button class="btn" type="button" onclick={() => (editing = 'new')}>Add event</button>
			</div>

			<ActionError message={form?.message ?? null} />

			{#if editing === 'new'}
				<EventDialog
					categories={data.categories}
					tz={data.tz}
					date={selectedDay ?? data.today}
					onclose={() => (editing = null)}
				/>
			{/if}

			{#each agenda as e, i (e.date + e.label + i)}
				{#if editingOccurrence && e.occurrence && e.occurrence.eventId === editingOccurrence.eventId && e.occurrence.recurrenceId === editingOccurrence.recurrenceId}
					<!-- Keyed so opening a different occurrence remounts the form. The
					     dialog seeds its own state from the occurrence on mount, so a
					     reused instance would show the previous event's times. -->
					{#key editingOccurrence.eventId + editingOccurrence.recurrenceId}
						<EventDialog
							categories={data.categories}
							tz={data.tz}
							occurrence={editingOccurrence}
							date={e.date}
							onclose={() => (editing = null)}
						/>
					{/key}
				{:else if e.kind === 'authored'}
					<button
						type="button"
						class="event event-authored"
						onclick={() =>
							(editing = {
								eventId: e.occurrence!.eventId,
								recurrenceId: e.occurrence!.recurrenceId
							})}
					>
						<span class="mono e-date">{e.day}.</span>
						<span class="dot" style="background: var(--indigo);"></span>
						<span class="e-label">
							{#if e.marker}<span class="e-marker">{e.marker}</span>{/if}{e.label}
						</span>
						{#if e.time}<span class="mono e-time">{e.time}</span>{/if}
						<span class="e-source">{e.occurrence?.recurring ? 'Repeats' : 'Ours'}</span>
					</button>
				{:else}
					<div class="event">
						<span class="mono e-date">{e.day}.</span>
						<span class="dot" style="background: var(--yellow);"></span>
						<span class="e-label">
							{#if e.marker}<span class="e-marker">{e.marker}</span>{/if}{e.label}
						</span>
						<span class="e-source">Ledger</span>
					</div>
				{/if}
			{:else}
				<span class="quiet">Nothing on the books that day.</span>
			{/each}
		</div>
	</div>

	<div class="side">
		<div class="card stack">
			<Eyebrow emoji="🤖" label="What the ledger puts here by itself" />
			{#each data.rules as rule (rule.key)}
				<form method="POST" action="?/toggleRule" use:enhance class="rule">
					<input type="hidden" name="key" value={rule.key} />
					<button
						type="submit"
						class="switch"
						class:on={rule.on}
						role="switch"
						aria-checked={rule.on}
						aria-label={rule.label}
					>
						<span class="knob"></span>
					</button>
					<span class="r-text">
						<span class="r-label">{rule.label}</span>
						<span class="r-detail">{rule.detail}</span>
					</span>
				</form>
			{/each}
		</div>

		<div class="card stack">
			<div class="eyebrow-row">
				<Eyebrow emoji="🔗" label="Connected calendars" />
				<InfoHint label="What connecting a calendar does">
					<strong class="warn">Two-way: what you write here appears there, and back.</strong>
					<ol class="steps">
						<li>iCloud needs one app-specific password from appleid.apple.com.</li>
						<li>Google needs an OAuth client of your own — a few minutes in its console.</li>
						<li>Each is set up in Settings, which explains its own steps.</li>
					</ol>
					<span class="docs">
						Events this app writes are marked with their module emoji and “· Continuum”, so they are
						tellable from your own.
					</span>
				</InfoHint>
			</div>

			{#each data.accounts as account (account.id)}
				<div class="feed">
					<span>{account.failing ? '⚠️' : account.connected ? '🔄' : '⏸️'}</span>
					<div class="f-text">
						<span class="f-name">{account.label}</span>
						<span class="f-detail">
							{#if account.failing}
								not syncing — see Settings
							{:else if !account.connected}
								connected, but no calendar chosen yet
							{:else if account.lastSyncAt}
								{account.calendarName ? `${account.calendarName} · ` : ''}last synced
								{new Date(account.lastSyncAt).toLocaleString('en-GB')}
							{:else}
								waiting for its first sync
							{/if}
						</span>
					</div>
					<span
						class="f-state"
						style="color: {account.failing
							? 'var(--red)'
							: account.connected
								? 'var(--green)'
								: 'var(--fg3)'};"
					>
						{account.failing ? 'error' : account.connected ? 'syncing' : 'paused'}
					</span>
				</div>
			{/each}

			<a class="btn add-calendar" href="/settings#calendars">
				{data.accounts.length === 0 ? 'Connect Google or iCloud' : 'Add another calendar'}
			</a>

			<div class="feed">
				<span>📆</span>
				<div class="f-text">
					<span class="f-name">ledger.ics — this ledger's own feed</span>
					<span class="f-detail mono">{data.icsPath}</span>
				</div>
				<span class="f-state" style="color: var(--green);">published</span>
			</div>
			<span class="quiet">
				The feed is read-only and needs no account: subscribe from any calendar app with this
				server's address plus the path above. The token in the URL is the only key — treat it like a
				password.
			</span>
		</div>
	</div>
</section>

<style>
	.add-calendar {
		align-self: flex-start;
		text-decoration: none;
	}

	.warn {
		display: block;
		margin-bottom: 6px;
	}

	.steps {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.docs {
		display: block;
		margin-top: 6px;
		color: var(--fg3);
	}

	.event-authored {
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
		font: inherit;
		color: inherit;
		width: 100%;
	}

	.event-authored:hover {
		background: var(--card2);
	}

	.e-marker {
		margin-right: 5px;
	}

	.e-time {
		color: var(--fg3);
		font-size: 12px;
	}

	.conflicts {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-color: var(--yellow);
	}

	.conflict {
		display: flex;
		gap: 10px;
		margin: 0;
		font-size: 13px;
		color: var(--fg2);
	}

	.c-when {
		color: var(--fg3);
		white-space: nowrap;
	}

	.sources {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}
	.chips {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 8px;
		border: 1px solid var(--bd);
		background: var(--card);
		border-radius: 20px;
		padding: 6px 13px;
		font-size: 12.5px;
		color: var(--fg2);
	}
	.chip.muted {
		color: var(--fg3);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 8px;
		flex: 0 0 auto;
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}
	@media (max-width: 900px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.cal {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.cal-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.month {
		font-size: 16px;
		font-weight: 600;
	}
	.count {
		margin-left: auto;
		font-size: 12px;
		color: var(--fg3);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 5px;
	}
	.weekday {
		font-size: 10.5px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--fg3);
		text-align: center;
		padding-bottom: 3px;
	}
	.day {
		min-height: 58px;
		border: 1px solid var(--bd);
		background: transparent;
		border-radius: 8px;
		padding: 6px 7px 7px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		cursor: pointer;
	}
	.day:hover {
		background: var(--card2);
	}
	.day.today {
		border-color: var(--bd2);
		background: var(--card2);
	}
	.day.selected {
		background: var(--card3);
		border-color: var(--bd2);
	}
	.num {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.day.today .num {
		color: var(--fg1);
		font-weight: 600;
	}
	.dots {
		display: flex;
		gap: 3px;
		flex-wrap: wrap;
	}
	.dots .dot {
		width: 6px;
		height: 6px;
	}
	.agenda {
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-top: 1px solid var(--bd);
		padding-top: 12px;
	}
	.event {
		display: grid;
		grid-template-columns: 30px 9px minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 11px;
		padding: 9px 2px;
		border-top: 1px solid var(--bd);
	}
	.event .dot {
		width: 7px;
		height: 7px;
		align-self: center;
	}
	.e-date {
		font-size: 12px;
		color: var(--fg3);
	}
	.e-label {
		font-size: 13.5px;
		color: var(--fg1);
	}
	.e-source {
		font-size: 11.5px;
		color: var(--fg3);
		white-space: nowrap;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.rule {
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr);
		gap: 11px;
		align-items: center;
		padding: 8px 0;
		border-top: 1px solid var(--bd);
	}
	.switch {
		width: 38px;
		height: 22px;
		border-radius: 22px;
		border: 1px solid var(--bd2);
		background: var(--card2);
		position: relative;
		cursor: pointer;
		padding: 0;
	}
	.switch .knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 16px;
		background: var(--fg3);
	}
	.switch.on {
		border-color: var(--green);
		background: var(--green-tint);
	}
	.switch.on .knob {
		left: auto;
		right: 2px;
		background: var(--green);
	}
	.r-text {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.r-label {
		font-size: 13px;
	}
	.r-detail {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.feed {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) auto;
		gap: 10px;
		align-items: center;
		padding: 8px 0;
		border-top: 1px solid var(--bd);
	}
	.f-text {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.f-name {
		font-size: 13px;
	}
	.f-detail {
		font-size: 11px;
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.f-state {
		font-size: 11.5px;
	}
	.quiet {
		font-size: 12px;
		color: var(--fg3);
		line-height: 1.55;
	}
</style>
