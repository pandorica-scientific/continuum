<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { formatRrule, parseRrule } from '$lib/calendar/rrule';
	import Field from '$lib/components/Field.svelte';

	let {
		value = null,
		startDate
	}: {
		/** An existing RFC 5545 rule, or null for a single event. */
		value?: string | null;
		/** The event's date, so "monthly on the 15th" can name the right day. */
		startDate: string;
	} = $props();

	const WEEKDAYS = [
		{ code: 'MO', label: 'Mon' },
		{ code: 'TU', label: 'Tue' },
		{ code: 'WE', label: 'Wed' },
		{ code: 'TH', label: 'Thu' },
		{ code: 'FR', label: 'Fri' },
		{ code: 'SA', label: 'Sat' },
		{ code: 'SU', label: 'Sun' }
	];

	// The patterns a household actually uses, rather than everything RFC 5545 can
	// express. A rule authored by another client round-trips untouched; we simply
	// do not offer to build one.
	type Pattern = 'none' | 'daily' | 'weekly' | 'monthlyDate' | 'monthlyWeekday' | 'yearly';

	const parsed = parseRrule(value ?? '');

	/** The ordinal of a BYDAY token — 2 in `2TU`, -1 in `-1FR`, 0 for a bare code. */
	function ordinalOf(token: string): number {
		const n = Number(token.slice(0, -2));
		return Number.isInteger(n) ? n : 0;
	}

	// Google and Apple write "the second Tuesday" as `BYDAY=2TU`; this editor
	// writes the equivalent `BYDAY=TU;BYSETPOS=2`. Both have to open as
	// "monthly on a weekday", or an imported series is shown as — and saved back
	// as — "monthly on the 13th".
	const ordinalDay = parsed?.byDay.find((d) => ordinalOf(d) !== 0) ?? null;

	function initialPattern(): Pattern {
		if (!parsed) return 'none';
		if (parsed.freq === 'DAILY') return 'daily';
		if (parsed.freq === 'WEEKLY') return 'weekly';
		if (parsed.freq === 'YEARLY') return 'yearly';
		return parsed.bySetPos.length > 0 || ordinalDay ? 'monthlyWeekday' : 'monthlyDate';
	}

	const dayOfMonth = $derived(Number(startDate.slice(8, 10)) || 1);
	const weekdayOfStart = $derived(
		WEEKDAYS[(new Date(`${startDate}T00:00:00Z`).getUTCDay() + 6) % 7].code
	);

	let pattern = $state<Pattern>(initialPattern());
	let interval = $state(parsed?.interval ?? 1);
	let byDay = $state<string[]>(parsed?.byDay.length ? parsed.byDay.map((d) => d.slice(-2)) : []);
	let setPos = $state(parsed?.bySetPos[0] ?? (ordinalDay ? ordinalOf(ordinalDay) : 1));
	let ending = $state<'never' | 'count' | 'until'>(
		parsed?.count != null ? 'count' : parsed?.until ? 'until' : 'never'
	);
	let count = $state(parsed?.count ?? 10);
	let until = $state(parsed?.until ? parsed.until.slice(0, 10) : '');

	function toggleDay(code: string) {
		byDay = byDay.includes(code) ? byDay.filter((d) => d !== code) : [...byDay, code];
	}

	/** The rule as RFC 5545, or '' for a single event. */
	const rrule = $derived.by(() => {
		if (pattern === 'none') return '';

		const freq =
			pattern === 'daily'
				? 'DAILY'
				: pattern === 'weekly'
					? 'WEEKLY'
					: pattern === 'yearly'
						? 'YEARLY'
						: 'MONTHLY';

		return formatRrule({
			freq,
			interval: Math.max(1, interval),
			// An empty weekday selection would expand to nothing at all, so it falls
			// back to the day the event starts on — which is what someone choosing
			// "weekly" without ticking anything means.
			byDay:
				pattern === 'weekly'
					? byDay.length
						? byDay
						: [weekdayOfStart]
					: pattern === 'monthlyWeekday'
						? [weekdayOfStart]
						: [],
			byMonthDay: pattern === 'monthlyDate' ? [dayOfMonth] : [],
			bySetPos: pattern === 'monthlyWeekday' ? [setPos] : [],
			count: ending === 'count' ? Math.max(1, count) : null,
			// COUNT and UNTIL are mutually exclusive in RFC 5545, which the radio
			// group enforces by construction.
			until: ending === 'until' && until ? new Date(`${until}T23:59:59Z`).toISOString() : null
		});
	});

	const positions = [
		{ value: 1, label: 'first' },
		{ value: 2, label: 'second' },
		{ value: 3, label: 'third' },
		{ value: 4, label: 'fourth' },
		{ value: -1, label: 'last' }
	];

	const weekdayName = $derived(WEEKDAYS.find((w) => w.code === weekdayOfStart)?.label ?? '');
</script>

<input type="hidden" name="rrule" value={rrule} />

<Field label="Repeats">
	<select bind:value={pattern}>
		<option value="none">Does not repeat</option>
		<option value="daily">Daily</option>
		<option value="weekly">Weekly</option>
		<option value="monthlyDate">Monthly, on day {dayOfMonth}</option>
		<option value="monthlyWeekday">Monthly, on a chosen weekday</option>
		<option value="yearly">Yearly</option>
	</select>
</Field>

{#if pattern !== 'none'}
	<Field label="Every">
		<div class="row">
			<input class="num" type="number" min="1" max="99" bind:value={interval} />
			<span class="unit">
				{pattern === 'daily'
					? interval === 1
						? 'day'
						: 'days'
					: pattern === 'weekly'
						? interval === 1
							? 'week'
							: 'weeks'
						: pattern === 'yearly'
							? interval === 1
								? 'year'
								: 'years'
							: interval === 1
								? 'month'
								: 'months'}
			</span>
		</div>
	</Field>
{/if}

{#if pattern === 'weekly'}
	<!-- A group, not a label: wrapping several checkboxes in one <label> would
	     name only the first of them. -->
	<div class="field" role="group" aria-label="Repeat on">
		<span>On</span>
		<div class="row wrap">
			{#each WEEKDAYS as day (day.code)}
				<label class="tick">
					<input
						type="checkbox"
						checked={byDay.includes(day.code)}
						onchange={() => toggleDay(day.code)}
					/>
					{day.label}
				</label>
			{/each}
		</div>
	</div>
{/if}

{#if pattern === 'monthlyWeekday'}
	<Field label="On the">
		<div class="row">
			<select bind:value={setPos}>
				{#each positions as position (position.value)}
					<option value={position.value}>{position.label}</option>
				{/each}
			</select>
			<span class="unit">{weekdayName} of the month</span>
		</div>
	</Field>
{/if}

{#if pattern !== 'none'}
	<div class="field" role="group" aria-label="Ends">
		<span>Ends</span>
		<div class="row wrap">
			<label class="tick">
				<input type="radio" value="never" bind:group={ending} /> Never
			</label>
			<label class="tick">
				<input type="radio" value="count" bind:group={ending} /> After
				<input
					class="num"
					type="number"
					min="1"
					max="999"
					bind:value={count}
					disabled={ending !== 'count'}
				/>
				times
			</label>
			<label class="tick">
				<input type="radio" value="until" bind:group={ending} /> On
				<input type="date" bind:value={until} disabled={ending !== 'until'} />
			</label>
		</div>
	</div>
{/if}

<style>
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.wrap {
		flex-wrap: wrap;
		gap: 8px 14px;
	}

	.tick {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-md);
		color: var(--fg1);
	}

	.tick input[type='checkbox'],
	.tick input[type='radio'] {
		width: auto;
	}

	.num {
		width: 4.5rem;
	}

	.unit {
		font-size: var(--text-md);
		color: var(--fg1);
	}
</style>
