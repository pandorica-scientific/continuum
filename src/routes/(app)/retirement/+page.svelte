<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { onDestroy } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import { createSerializedAutosave } from '$lib/actions/autosave';
	import { sendActionForPageExit, submitAction } from '$lib/actions/result';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import LineChart from '$lib/charts/LineChart.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import type { Column } from '$lib/components/data-table';
	import type { LineSeries } from '$lib/charts/line';
	import { initialsFor } from '$lib/people';
	import { MAX_RETIREMENT_AGE, MIN_RETIREMENT_AGE, retModel, type RetireConfig } from '$lib/retire';
	import { displayCurrency } from '$lib/money';

	let { data } = $props();

	// Local assumptions recompute the model instantly; saving is fire-and-forget.
	// svelte-ignore state_referenced_locally
	let cfg: RetireConfig = $state({ ...data.config });

	const model = $derived(retModel(data.inputs, cfg));
	const unit = $derived(displayCurrency(data.baseCurrency));

	const money = (v: number) => Math.round(v).toLocaleString('en').replace(/,/g, ' ');

	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saveError = $state<string | null>(null);
	// A loader invalidation may replace `data`, but one mounted page must retain
	// one writer identity and the version it originally edited against.
	// svelte-ignore state_referenced_locally
	const autosaveWriterId = data.autosaveWriterId;
	// svelte-ignore state_referenced_locally
	const autosaveBaseVersion = data.autosaveBaseVersion;

	function bodyFor(snapshot: RetireConfig, revision: number) {
		const body = new FormData();
		for (const [key, value] of Object.entries(snapshot)) body.set(key, String(value));
		body.set('revision', String(revision));
		body.set('writerId', autosaveWriterId);
		body.set('baseVersion', String(autosaveBaseVersion));
		return body;
	}

	function sendSave(snapshot: RetireConfig, revision: number) {
		const body = bodyFor(snapshot, revision);
		return submitAction(new URL('/retirement?/save', window.location.origin), body, {
			updatePage: false
		}).then((outcome) => {
			saveError = outcome.type === 'success' ? null : outcome.message;
			if (outcome.type !== 'success') throw new Error(outcome.message);
		});
	}

	const autosave = createSerializedAutosave(
		sendSave,
		(snapshot, revision) => {
			sendActionForPageExit(
				new URL('/retirement?/save', window.location.origin),
				bodyFor(snapshot, revision)
			);
		},
		0
	);

	function flushSave() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = undefined;
		return autosave.flush();
	}

	function flushForPageExit() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = undefined;
		autosave.flushForPageExit();
	}

	function persist() {
		clearTimeout(saveTimer);
		autosave.queue({ ...cfg });
		saveTimer = setTimeout(() => {
			void flushSave();
		}, 500);
	}

	onNavigate(() => flushSave());
	onDestroy(() => {
		flushForPageExit();
	});

	// Chart geometry.
	/**
	 * The pot against the target, as lines over the model's twenty years.
	 *
	 * Capital on its own, and capital with the flats' equity on top, unless the
	 * plan already sells them into the pot; the target pot dashed, since it is
	 * a reference and not a measurement. Equity is known every five years and
	 * drawn straight between them.
	 */
	const equityAt = (t: number) => {
		const rows = model.rows;
		const after = rows.find((r) => r.t >= t) ?? rows[rows.length - 1];
		const before = [...rows].reverse().find((r) => r.t <= t) ?? rows[0];
		if (after.t === before.t) return after.equity;
		const share = (t - before.t) / (after.t - before.t);
		return before.equity + (after.equity - before.equity) * share;
	};
	const chartSeries = $derived<LineSeries[]>([
		{
			key: 'capital',
			colorVar: '--blue',
			endLabel: 'capital',
			points: model.chart.map((p) => ({ value: p.pot }))
		},
		...(cfg.plan === 'sell'
			? []
			: [
					{
						key: 'flats',
						colorVar: '--purple',
						endLabel: 'with flats',
						points: model.chart.map((p) => ({ value: p.pot + equityAt(p.t) }))
					}
				]),
		{
			key: 'required',
			colorVar: '--fg3',
			dashed: true,
			endLabel: 'target pot',
			points: model.chart.map((p) => ({ value: p.required }))
		}
	]);
	const chartLabels = $derived(
		model.chart.map((p) => (p.t % 5 === 0 ? String(data.inputs.year + p.t) : ''))
	);
	const millions = (v: number) => `${(v / 1e6).toFixed(1)} M`;

	// The three figures the sentence is made of, as tiles beside it.
	const requiredPot = $derived((cfg.spend * 12) / (cfg.swr / 100));
	const yearsToPension = $derived(
		Math.max(0, Math.min(cfg.ageOne - model.rows[0].a1, cfg.ageTwo - model.rows[0].a2))
	);

	// The two people, for the pension cards. Hues as the handoff assigns them.
	const PERSON_HUES = ['--series-health', '--series-savings'];
	const people = $derived(
		[0, 1].map((i) => ({
			name: data.personNames[i],
			initials: initialsFor(data.personNames[i]),
			hue: PERSON_HUES[i],
			age: i === 0 ? model.rows[0].a1 : model.rows[0].a2,
			startsAt: i === 0 ? cfg.ageOne : cfg.ageTwo
		}))
	);

	const TABLE_COLUMNS: Column[] = [
		{ key: 'when', label: 'When', width: 'minmax(90px, 1fr)' },
		{ key: 'ages', label: 'Ages', align: 'end', width: '80px', hideBelow: 760 },
		{ key: 'capital', label: 'Capital', align: 'end', width: 'minmax(110px, auto)' },
		{
			key: 'equity',
			label: 'Flat equity',
			align: 'end',
			width: 'minmax(110px, auto)',
			hideBelow: 760
		},
		{ key: 'income', label: 'Income / month', align: 'end', width: 'minmax(110px, auto)' },
		{ key: 'target', label: 'Against target', align: 'end', width: 'minmax(150px, auto)' }
	];
	type Row = (typeof model.rows)[number];
	const coverage = (row: Row) => Math.round((row.total / Math.max(cfg.spend, 1)) * 100);

	/**
	 * The gauge's arithmetic.
	 *
	 * `r` and the circumference are constants rather than props: the arc is a
	 * fixed 124px drawing scaled by the viewBox, and a caller choosing a radius
	 * would also have to choose a stroke width that suits it.
	 */
	const GAUGE_R = 55;
	const GAUGE_C = 2 * Math.PI * GAUGE_R;

	const coveredPct = $derived(Math.round((model.rows[0].total / Math.max(cfg.spend, 1)) * 100));
	// The same three steps the rest of the app reads a proportion at. Above 100
	// is still green: over-covered is not a warning.
	const coveredTone = $derived(
		coveredPct < 50 ? '--red' : coveredPct < 100 ? '--yellow' : '--green'
	);
	// A floor of 2.5%, so "almost nothing" is visibly not "nothing at all" —
	// with a round cap a zero-length dash draws no arc, and an empty ring and a
	// 1% ring would be the same picture.
	const gaugeDash = $derived(
		(Math.max(coveredPct === 0 ? 0 : 2.5, Math.min(100, coveredPct)) / 100) * GAUGE_C
	);

	const verdict = $derived(
		model.fire
			? model.fire.t === 0
				? 'On these assumptions you could stop now.'
				: `On these assumptions you clear the target in ${model.fire.t} years — ${model.fire.year}, aged ${model.fire.a1} and ${model.fire.a2}.`
			: 'On these assumptions the target is never reached within 40 years.'
	);
</script>

<ScreenHeader
	title="Retirement"
	caption="All figures in today's money · returns are real, after inflation."
/>
<svelte:window onpagehide={flushForPageExit} />
{#if saveError}<p class="save-error" role="alert">Could not save assumptions: {saveError}</p>{/if}

<section class="verdict">
	<div class="gauge">
		<svg
			viewBox="0 0 124 124"
			role="img"
			aria-label="{coveredPct}% of what you need, covered today"
		>
			<circle
				cx="62"
				cy="62"
				r={GAUGE_R}
				fill="none"
				stroke="color-mix(in srgb, var(--fg1) 10%, transparent)"
				stroke-width="12"
			/>
			<circle
				cx="62"
				cy="62"
				r={GAUGE_R}
				fill="none"
				stroke="var({coveredTone})"
				stroke-width="12"
				stroke-linecap="round"
				stroke-dasharray="{gaugeDash} {GAUGE_C}"
				transform="rotate(-90 62 62)"
			/>
		</svg>
		<!-- One block, centred as one: two grid items were each centred in a
		     row of their own, which put the figure high and the note low. -->
		<span class="gauge-text">
			<span class="gauge-figure display">{coveredPct}<span class="gauge-pct">%</span></span>
			<span class="gauge-note">covered today</span>
		</span>
	</div>
	<div class="verdict-text">
		<p>
			If you stopped working today, your capital would pay about
			<span class="mono chip">{money(model.rows[0].draw)} {unit}</span> a month and the state
			pension would add
			<span class="mono chip"
				>{model.rows[0].pension ? `${money(model.rows[0].pension)} ${unit}` : 'nothing yet'}</span
			>. That covers
			<span class="mono chip">{coveredPct}%</span>
			of the {money(cfg.spend)}
			{unit} you say you would need.
		</p>
		<span class="verdict-line">{verdict}</span>
	</div>

	<!-- The one figure this screen exists to produce, drawn as well as said.
	     A stroke arc rather than a filled wedge: the arc's own thickness is
	     constant, so a small share still reads as a share rather than as a
	     sliver of a pie that is mostly empty. -->
	<div class="v-tiles">
		<div class="v-tile">
			<span class="v-label">Capital pays</span>
			<span class="display v-value" style="color: var(--blue);"
				>{money(model.rows[0].draw)}<span class="v-unit">{unit} / mo</span></span
			>
			<span class="v-note">at {cfg.swr}% of {money(model.chart[0].pot)}</span>
		</div>
		<div class="v-tile">
			<span class="v-label">Pension adds</span>
			<span class="display v-value"
				>{money(model.rows[0].pension)}<span class="v-unit">{unit} / mo</span></span
			>
			<span class="v-note"
				>{model.rows[0].pension > 0
					? 'already drawing'
					: `first in ${yearsToPension} ${yearsToPension === 1 ? 'year' : 'years'}`}</span
			>
		</div>
		<div class="v-tile">
			<span class="v-label">You need</span>
			<span class="display v-value">{money(cfg.spend)}<span class="v-unit">{unit} / mo</span></span>
			<span class="v-note">a pot of {millions(requiredPot)}</span>
		</div>
	</div>
</section>

<!-- The assumptions beside the picture they change, not above it: every control
     on the left moves the line and the table on the right, and a person tuning
     one wants to watch the other rather than scroll between them. -->
<div class="model">
	<div class="assume">
		<section class="card stack">
			<div class="eyebrow-row">
				<Eyebrow hue="--blue" icon="sliders" label="What you assume" />
				<span class="eyebrow-caption">
					capital, savings rate, mortgages and rent are read from your own data
				</span>
			</div>
			<div class="groups">
				<div class="group">
					<span class="g-label">Target</span>
					<div class="controls">
						<label>
							<span>Monthly spending you would need</span>
							<span class="money-field">
								<input
									class="mono"
									type="number"
									min="0"
									step="1000"
									bind:value={cfg.spend}
									oninput={persist}
								/>
								<span class="mono money-unit">{unit}</span>
							</span>
						</label>
						<div class="control">
							<span>Withdrawal rate</span>
							<div class="seg">
								{#each [3, 3.5, 4] as rate (rate)}
									<button
										type="button"
										class="mono"
										class:active={cfg.swr === rate}
										onclick={() => {
											cfg.swr = rate;
											persist();
										}}
									>
										{rate.toFixed(1)}%
									</button>
								{/each}
							</div>
						</div>
					</div>
				</div>

				<div class="group">
					<span class="g-label">Growth · real, after inflation</span>
					<div class="controls one">
						<label>
							<span class="split"
								><span>Real return until then</span><span class="mono value"
									>{cfg.realReturn.toFixed(1)}%</span
								></span
							>
							<input
								type="range"
								min="0"
								max="8"
								step="0.5"
								bind:value={cfg.realReturn}
								oninput={persist}
							/>
						</label>
						<label>
							<span class="split"
								><span>Yearly contributions grow</span><span class="mono value"
									>{cfg.contributionGrowth.toFixed(1)}%</span
								></span
							>
							<input
								type="range"
								min="-5"
								max="10"
								step="0.5"
								bind:value={cfg.contributionGrowth}
								oninput={persist}
							/>
						</label>
						<label>
							<span class="split"
								><span>Property values grow</span><span class="mono value"
									>{cfg.propertyGrowth.toFixed(1)}%</span
								></span
							>
							<input
								type="range"
								min="-5"
								max="10"
								step="0.5"
								bind:value={cfg.propertyGrowth}
								oninput={persist}
							/>
						</label>
					</div>
				</div>

				<div class="group">
					<span class="g-label">The flats, once you retire</span>
					<div class="seg">
						{#each [['keep', 'Keep, live in it'], ['rent', 'Rent it out'], ['sell', 'Sell and invest']] as [value, label] (value)}
							<button
								type="button"
								class:active={cfg.plan === value}
								onclick={() => {
									cfg.plan = value as RetireConfig['plan'];
									persist();
								}}
							>
								{label}
							</button>
						{/each}
					</div>
					<span class="consequence">
						{cfg.plan === 'keep'
							? 'Equity stays in the walls. It is shown, but pays nothing.'
							: cfg.plan === 'rent'
								? 'Rent joins the monthly income once the first pension starts.'
								: 'Equity joins the pot at the first pension and is drawn down with it.'}
					</span>
				</div>

				<div class="group">
					<span class="g-label">State pension</span>
					{#each people as person, i (person.name)}
						<div class="person">
							<span class="avatar mono" style:--person-hue="var({person.hue})">
								{person.initials}
							</span>
							<span class="p-names">
								<span class="p-name">{person.name}</span>
								<span class="p-sub">
									{person.age} today · pension in {Math.max(0, person.startsAt - person.age)} years
								</span>
							</span>
							<label class="p-field">
								<span>a month</span>
								<span class="money-field">
									<input
										class="mono"
										type="number"
										min="0"
										step="500"
										value={i === 0 ? cfg.pensionOne : cfg.pensionTwo}
										oninput={(e) => {
											const v = Number((e.currentTarget as HTMLInputElement).value);
											if (i === 0) cfg.pensionOne = v;
											else cfg.pensionTwo = v;
											persist();
										}}
									/>
									<span class="mono money-unit">{unit}</span>
								</span>
							</label>
							<label class="p-field">
								<span>from age</span>
								<input
									class="mono"
									type="number"
									min={MIN_RETIREMENT_AGE}
									max={MAX_RETIREMENT_AGE}
									step="1"
									value={i === 0 ? cfg.ageOne : cfg.ageTwo}
									oninput={(e) => {
										const v = Number((e.currentTarget as HTMLInputElement).value);
										if (i === 0) cfg.ageOne = v;
										else cfg.ageTwo = v;
										persist();
									}}
								/>
							</label>
						</div>
					{/each}
				</div>
			</div>
			<span class="quiet">
				Pension figures are rough placeholders until you paste the real ones from your ČSSZ personal
				account.
			</span>
		</section>
	</div>
	<div class="output">
		<section class="card stack">
			<div class="eyebrow-row">
				<Eyebrow hue="--blue" icon="trend" label="The pot against what the target requires" />
				<span class="eyebrow-caption">millions {unit} · twenty years out</span>
			</div>
			<LineChart
				series={chartSeries}
				labels={chartLabels}
				height={280}
				title="The pot against what the target requires"
				description="Capital, capital with the flats' equity, and the pot the target needs, year by year."
				format={millions}
				axisTitle="millions {unit}"
				slotLabel={(i) => `${data.inputs.year + i}`}
			>
				{#snippet readout(i)}
					<span class="mono">{data.inputs.year + i}</span>
					<span>capital <span class="mono">{money(model.chart[i].pot)}</span></span>
					{#if cfg.plan !== 'sell'}
						<span
							>with flats <span class="mono">{money(model.chart[i].pot + equityAt(i))}</span></span
						>
					{/if}
				{/snippet}
				{#snippet legend()}
					<span class="l"
						><span class="swatch" style="border-top: 2.5px solid var(--blue);"></span>capital</span
					>
					{#if cfg.plan !== 'sell'}
						<span class="l"
							><span class="swatch" style="border-top: 2.5px solid var(--purple);"></span>capital +
							flat equity</span
						>
					{/if}
					<span class="l"
						><span class="swatch" style="border-top: 2px dashed var(--fg3);"></span>pot the target
						needs · <span class="mono">{millions(requiredPot)}</span></span
					>
					<span class="l-note">{verdict}</span>
				{/snippet}
			</LineChart>
		</section>
		<section class="card stack">
			<div class="eyebrow-row">
				<Eyebrow hue="--blue" icon="ledger" label="Where that leaves you" />
				<span class="eyebrow-caption">today's money</span>
			</div>
			<DataTable
				columns={TABLE_COLUMNS}
				groups={[{ key: 'all', open: true, rows: model.rows }]}
				flat
				hue="--blue"
				label="Where that leaves you"
				rowKey={(r) => String(r.t)}
				rowClass={(r) => (r.t === 0 ? 'now' : undefined)}
			>
				{#snippet row(r, visible)}
					<span class="when">
						{r.t === 0 ? 'today' : `in ${r.t} years`}
						{#if r.pension > 0 && (r.t === 0 || model.rows.find((x) => x.t < r.t && x.pension > 0) === undefined)}
							<span class="pension-note">pension starts</span>
						{/if}
					</span>
					{#if visible.has('ages')}<span class="mono r">{r.a1} / {r.a2}</span>{/if}
					<span class="mono r" class:short={r.capital < 0}>{money(r.capital)}</span>
					{#if visible.has('equity')}<span class="mono r">{money(r.equity)}</span>{/if}
					<span class="mono r">{money(r.total)}</span>
					<span class="target r">
						<span class="cover" aria-hidden="true">
							<span
								class="cover-fill"
								style:width="{Math.min(100, coverage(r))}%"
								style:background="var({coverage(r) >= 100
									? '--green'
									: coverage(r) >= 50
										? '--yellow'
										: '--red'})"
							></span>
						</span>
						<span class="mono cover-pct">{coverage(r)}%</span>
					</span>
				{/snippet}
			</DataTable>
		</section>
	</div>
</div>

<style>
	.save-error {
		margin: 0;
		color: var(--red);
		font-size: var(--text-md);
	}
	.gauge {
		position: relative;
		display: grid;
		place-items: center;
		width: 124px;
		height: 124px;
		justify-self: center;
		align-self: center;
	}
	.gauge svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	/* `tabular-nums` is for a COLUMN of figures that has to align. This is one
	   number with a unit beside it, and the tabular advance padded a narrow "4"
	   out to a full digit width — which read as "4    %". */
	.gauge-text {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: 0 var(--space-6);
		text-align: center;
	}
	.gauge-figure {
		font-size: var(--text-5xl);
		line-height: 1;
		font-variant-numeric: normal;
	}
	.gauge-pct {
		font-size: var(--text-xl);
		color: var(--fg3);
		letter-spacing: normal;
		margin-left: 1px;
	}
	.gauge-note {
		font-size: var(--text-xs);
		color: var(--fg3);
		margin-top: 2px;
	}
	/* The controls beside the picture they change. 380px is the design's: enough
	   for a labelled number field and a segmented control, and no more. */
	.model {
		display: grid;
		grid-template-columns: 380px minmax(0, 1fr);
		gap: var(--space-8);
		align-items: start;
	}
	.assume,
	.output {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		min-width: 0;
	}
	@media (max-width: 1279px) {
		.model {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.verdict-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}
	/* A wash and a 30% edge rather than a full tint inside a solid blue border:
	   at the size this panel now is, the old pair read as an alert. */
	.verdict {
		background: var(--blue-wash);
		border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: var(--space-8) 22px;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 22px;
	}
	/* The gauge moves beside the sentence only where there is room for both.
	   Below 1100 it sits above it, which is still better than a 124px circle
	   squeezed into a third of a phone. */
	@media (min-width: 1100px) {
		.verdict {
			grid-template-columns: auto 1.3fr minmax(360px, 1fr);
			align-items: center;
		}
	}
	/* The three figures the sentence is made of, as tiles beside it: what the
	   capital pays, what the pension adds, what is needed. */
	.v-tiles {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-4);
	}
	.v-tile {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-5) var(--space-6);
		border: 1px solid var(--bd);
		border-radius: var(--radius-tile);
		background: var(--surface);
		min-width: 0;
	}
	.v-label,
	.v-note {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.v-value {
		font-size: var(--text-xl);
		white-space: nowrap;
	}
	.v-unit {
		font-size: var(--text-xs);
		font-weight: 400;
		letter-spacing: 0;
		color: var(--fg3);
		margin-left: var(--space-2);
	}
	@media (max-width: 720px) {
		.v-tiles {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	/* The assumptions, in four groups: a heading each, so a wall of eleven
	   controls reads as four questions. */
	.groups {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.g-label {
		font-size: var(--text-xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg3);
	}
	.controls.one {
		grid-template-columns: minmax(0, 1fr);
	}
	.consequence {
		font-size: var(--text-sm);
		color: var(--fg3);
		line-height: 1.5;
	}
	.money-field {
		display: flex;
		align-items: center;
		gap: 0;
	}
	.money-field input {
		border-radius: var(--radius-ctl) 0 0 var(--radius-ctl);
		flex: 1;
	}
	.money-unit {
		display: grid;
		place-items: center;
		min-height: var(--control-h);
		padding: 0 var(--space-4);
		border: 1px solid var(--bd2);
		border-left: 0;
		border-radius: 0 var(--radius-ctl) var(--radius-ctl) 0;
		background: var(--surface-2);
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.person {
		display: grid;
		grid-template-columns: 30px minmax(0, 1fr);
		grid-template-areas:
			'avatar names'
			'month month'
			'age age';
		gap: var(--space-4) var(--space-4);
		padding: var(--space-5);
		border: 1px solid var(--bd);
		border-radius: var(--radius-tile);
		background: var(--surface);
	}
	.avatar {
		grid-area: avatar;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--person-hue) 26%, transparent);
		color: color-mix(in srgb, var(--fg1) var(--series-ink-mix), var(--person-hue));
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.p-names {
		grid-area: names;
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.p-name {
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--fg1);
	}
	.p-sub {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.p-field:nth-of-type(1) {
		grid-area: month;
	}
	.p-field:nth-of-type(2) {
		grid-area: age;
	}
	.when {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.pension-note {
		font-size: var(--text-xs);
		color: var(--blue);
		font-weight: 400;
	}
	.r {
		text-align: right;
	}
	.short {
		color: var(--red);
	}
	.target {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-4);
	}
	.cover {
		display: block;
		width: 80px;
		height: 5px;
		border-radius: var(--radius-pill);
		background: var(--card3);
		overflow: hidden;
	}
	.cover-fill {
		display: block;
		height: 100%;
		border-radius: var(--radius-pill);
	}
	.cover-pct {
		min-width: 38px;
		text-align: right;
		font-size: var(--text-sm);
	}
	.verdict p {
		margin: 0;
		font-size: var(--text-2xl);
		line-height: 1.6;
		color: var(--fg1);
	}
	.chip {
		font-weight: 600;
		background: var(--card2);
		border-radius: 5px;
		padding: 1px 7px;
		white-space: nowrap;
	}
	.verdict-line {
		font-size: var(--text-md);
		color: var(--fg2);
		border-top: 1px solid var(--bd);
		padding-top: 11px;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.controls {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(178px, 1fr));
		gap: 16px 20px;
		align-items: start;
	}
	label,
	.control {
		display: flex;
		flex-direction: column;
		gap: 7px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	input[type='number'] {
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		padding: 9px 11px;
		font-size: var(--text-md);
		color: var(--fg1);
		background: var(--card);
		width: 100%;
	}
	input[type='range'] {
		width: 100%;
		accent-color: var(--blue);
	}
	.split {
		display: flex;
		justify-content: space-between;
	}
	.split .value {
		color: var(--fg1);
	}
	.seg {
		display: flex;
		gap: var(--space-3);
	}
	.seg button {
		flex: 1 1 0;
		border: 1px solid var(--bd);
		background: transparent;
		color: var(--fg2);
		border-radius: var(--radius-md);
		padding: var(--space-4) var(--space-3);
		font-size: var(--text-sm);
		cursor: pointer;
		white-space: nowrap;
	}
	.seg button.active {
		border-color: var(--blue);
		background: var(--blue);
		color: var(--fg-inverse);
	}

	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.l {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.swatch {
		width: 16px;
		display: inline-block;
	}
	.l-note {
		margin-left: auto;
		color: var(--fg3);
		font-size: var(--text-xs);
	}
</style>
