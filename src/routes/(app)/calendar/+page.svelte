<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { selectedDayForMonth } from '$lib/ui/state';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';

	let { data } = $props();

	// Clicking a day filters the agenda; clicking it again clears.
	let selectedDay = $derived<string | null>(null);
	$effect(() => {
		selectedDay = selectedDayForMonth(
			selectedDay,
			data.cells.flatMap((cell) => (cell ? [cell.date] : []))
		);
	});

	const agenda = $derived(
		selectedDay ? data.agenda.filter((e) => e.date === selectedDay) : data.agenda
	);

	const ledgerCount = $derived(data.agenda.length);
</script>

<ScreenHeader
	emoji="📅"
	title="Calendar"
	caption="What the ledger knows is coming — written by itself, from your data."
/>

<section class="sources">
	<div class="chips">
		<span class="chip"><span class="dot" style="background: var(--yellow);"></span>Ledger</span>
		<span class="chip muted"
			><span class="dot" style="background: var(--blue);"></span>Google · not connected</span
		>
		<span class="chip muted"
			><span class="dot" style="background: var(--purple);"></span>iCal · not connected</span
		>
	</div>
	<span class="eyebrow-caption">external sync lands in Phase 4 · the ledger feed is live below</span
	>
</section>

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
			<span class="count">{ledgerCount} events · all written by the ledger</span>
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
						onclick={() => (selectedDay = selectedDay === cell.date ? null : cell.date)}
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
			</div>
			{#each agenda as e, i (e.date + e.label + i)}
				<div class="event">
					<span class="mono e-date">{e.day}.</span>
					<span class="dot" style="background: var(--yellow);"></span>
					<span class="e-label">{e.label}</span>
					<span class="e-source">Ledger</span>
				</div>
			{:else}
				<span class="quiet">Nothing on the books {selectedDay ? 'that day' : 'this month'}.</span>
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
			<Eyebrow emoji="🔗" label="Connected calendars" />
			<div class="feed">
				<span>📆</span>
				<div class="f-text">
					<span class="f-name">ledger.ics — this ledger's own feed</span>
					<span class="f-detail mono">{data.icsPath}</span>
				</div>
				<span class="f-state" style="color: var(--green);">published</span>
			</div>
			<span class="quiet">
				Subscribe from Google or Apple Calendar with this server's address plus the path above. The
				token in the URL is the only key — treat it like a password. Two-way Google and iCal sync
				arrive in Phase 4.
			</span>
		</div>
	</div>
</section>

<style>
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
