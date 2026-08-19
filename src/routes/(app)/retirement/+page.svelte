<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { enhance } from '$app/forms';
	import { onDestroy } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import { createSerializedAutosave } from '$lib/actions/autosave';
	import { sendActionForPageExit, submitAction } from '$lib/actions/result';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import SalaryCharts from '$lib/charts/SalaryCharts.svelte';
	import { MAX_RETIREMENT_AGE, MIN_RETIREMENT_AGE, retModel, type RetireConfig } from '$lib/retire';
	import { displayCurrency } from '$lib/money';

	let { data, form } = $props();

	const salaryColors = ['--teal', '--purple', '--yellow', '--blue'];
	const salaryPeople = $derived(
		data.salary.map((s, i) => ({
			name: s.name,
			colorVar: salaryColors[i % salaryColors.length],
			points: s.years
				.slice()
				.reverse() // ascending by year for the lines
				.map((y) => ({ year: y.year, age: y.age, avgMajor: y.avgMajor, deltaPct: y.deltaPct }))
		}))
	);

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
	const CW = 800;
	const CH = 200;
	const chart = $derived.by(() => {
		const max = Math.max(...model.chart.map((p) => Math.max(p.pot, p.required)), 1);
		const x = (t: number) => (t / 20) * CW;
		const y = (v: number) => CH - (v / max) * CH;
		return {
			pot: model.chart.map((p) => `${x(p.t).toFixed(1)},${y(p.pot).toFixed(1)}`).join(' '),
			required: `0,${y(model.chart[0].required).toFixed(1)} ${CW},${y(model.chart[0].required).toFixed(1)}`,
			axis: [0, 0.5, 1].map((f) => ({
				top: `${f * 100}%`,
				label: (((1 - f) * max) / 1e6).toFixed(1)
			})),
			// The horizontal scale carried no labels at all, so the one thing the
			// chart is for — when the pot crosses the line — could be seen but not
			// read off. Calendar years, not offsets: nobody thinks in "t + 13".
			years: [0, 5, 10, 15, 20].map((t) => ({
				left: `${(t / 20) * 100}%`,
				label: String(data.inputs.year + t)
			})),
			// The crossing itself, marked where it falls inside the window.
			crossing:
				model.fire && model.fire.t >= 0 && model.fire.t <= 20
					? {
							left: `${(model.fire.t / 20) * 100}%`,
							// Drawn inside the SVG, in its coordinates: the chart box is
							// inset by the y-axis gutter, so a percentage against the
							// container would sit to the right of the data it marks.
							x: x(model.fire.t),
							label: String(model.fire.year)
						}
					: null
		};
	});

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
	<p>
		If you stopped working today, your capital would pay about
		<span class="mono chip">{money(model.rows[0].draw)} {unit}</span> a month and the state pension
		would add
		<span class="mono chip"
			>{model.rows[0].pension ? `${money(model.rows[0].pension)} ${unit}` : 'nothing yet'}</span
		>. That covers
		<span class="mono chip"
			>{Math.round((model.rows[0].total / Math.max(cfg.spend, 1)) * 100)}%</span
		>
		of the {money(cfg.spend)}
		{unit} you say you would need.
	</p>
	<span class="verdict-line">{verdict}</span>
</section>

<section class="card stack">
	<div class="eyebrow-row">
		<Eyebrow emoji="🎛️" label="What you assume" />
		<span class="eyebrow-caption">
			capital, savings rate, mortgages and rent are read from your own data
		</span>
	</div>
	<div class="controls">
		<label>
			<span>Monthly spending you would need</span>
			<input
				class="mono"
				type="number"
				min="0"
				step="1000"
				bind:value={cfg.spend}
				oninput={persist}
			/>
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
		<div class="control wide">
			<span>The flats, once you retire</span>
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
		</div>
		<label>
			<span>{data.personNames[0]} · pension / month</span>
			<input
				class="mono"
				type="number"
				min="0"
				step="500"
				bind:value={cfg.pensionOne}
				oninput={persist}
			/>
		</label>
		<label>
			<span>{data.personNames[1]} · pension / month</span>
			<input
				class="mono"
				type="number"
				min="0"
				step="500"
				bind:value={cfg.pensionTwo}
				oninput={persist}
			/>
		</label>
		<label>
			<span>{data.personNames[0]} · starts at</span>
			<input
				class="mono"
				type="number"
				min={MIN_RETIREMENT_AGE}
				max={MAX_RETIREMENT_AGE}
				step="1"
				bind:value={cfg.ageOne}
				oninput={persist}
			/>
		</label>
		<label>
			<span>{data.personNames[1]} · starts at</span>
			<input
				class="mono"
				type="number"
				min={MIN_RETIREMENT_AGE}
				max={MAX_RETIREMENT_AGE}
				step="1"
				bind:value={cfg.ageTwo}
				oninput={persist}
			/>
		</label>
	</div>
	<span class="quiet">
		Pension figures are rough placeholders until you paste the real ones from your ČSSZ personal
		account.
	</span>
</section>

<section class="card stack">
	<Eyebrow emoji="📋" label="Where that leaves you" />
	<div class="table">
		<div class="t-head">
			<span>When</span><span class="r">Ages</span><span class="r">Capital</span><span class="r"
				>Flat equity</span
			><span class="r">Monthly income</span><span class="r">Against target</span>
		</div>
		{#each model.rows as row (row.t)}
			<div class="t-row" class:now={row.t === 0}>
				<span>{row.t === 0 ? 'today' : `in ${row.t} years`}</span>
				<span class="mono r">{row.a1} / {row.a2}</span>
				<span class="mono r">{money(row.capital)}</span>
				<span class="mono r">{money(row.equity)}</span>
				<span class="mono r">{money(row.total)}</span>
				<span class="mono r" style:color={row.gap >= 0 ? 'var(--green)' : 'var(--red)'}>
					{row.gap >= 0 ? '+' : '−'}{money(Math.abs(row.gap))}
				</span>
			</div>
		{/each}
	</div>
</section>

<section class="card stack">
	<div class="eyebrow-row">
		<Eyebrow emoji="📈" label="The pot against what the target requires" />
		<span class="eyebrow-caption">millions {unit} · twenty years out</span>
	</div>
	<div class="chart">
		{#each chart.axis as a (a.top)}
			<span class="axis mono" style:top={a.top}>{a.label}</span>
		{/each}
		<svg viewBox="0 0 800 200" preserveAspectRatio="none">
			{#each [0, 100] as gy (gy)}
				<line x1="0" y1={gy} x2="800" y2={gy} stroke="var(--bd)" stroke-width="1" />
			{/each}
			<line x1="0" y1="200" x2="800" y2="200" stroke="var(--bd2)" stroke-width="1" />
			{#if chart.crossing}
				<line
					x1={chart.crossing.x}
					y1="0"
					x2={chart.crossing.x}
					y2="200"
					stroke="var(--green)"
					stroke-width="1"
					stroke-dasharray="4 4"
					vector-effect="non-scaling-stroke"
					opacity="0.6"
				/>
			{/if}
			<polyline
				points={chart.required}
				fill="none"
				stroke="var(--fg3)"
				stroke-width="2"
				stroke-dasharray="6 4"
				vector-effect="non-scaling-stroke"
			/>
			<polyline
				points={chart.pot}
				fill="none"
				stroke="var(--teal)"
				stroke-width="2.5"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
			/>
		</svg>
		<div class="years mono">
			{#each chart.years as year (year.label)}
				<span class="year" style:left={year.left}>{year.label}</span>
			{/each}
			{#if chart.crossing}
				<span class="year crossing" style:left={chart.crossing.left}>
					{chart.crossing.label}
				</span>
			{/if}
		</div>
	</div>
	<div class="legend">
		<span class="l"
			><span class="swatch" style="border-top: 2.5px solid var(--teal);"></span>your pot</span
		>
		<span class="l"
			><span class="swatch" style="border-top: 2px dashed var(--fg3);"></span>required for the
			target</span
		>
		<span class="l-note">{verdict}</span>
	</div>
</section>

<section class="card stack">
	<div class="eyebrow-row">
		<Eyebrow emoji="💼" label="Salary history" />
		<span class="eyebrow-caption">
			from payslips — upload one and the amount reads itself, corrections teach it
		</span>
	</div>

	{#if form?.message}
		<div class="error">{form.message}</div>
	{/if}

	<SalaryCharts people={salaryPeople} {unit} />

	<div class="salary-grid">
		{#each data.salary as s (s.name)}
			<div class="person-block">
				<span class="p-name">{s.name}</span>
				{#if s.years.length}
					<table class="salary-table">
						<thead>
							<tr>
								<th>Year</th>
								<th>Age</th>
								<th class="num">Avg monthly</th>
								<th class="num">vs prev. year</th>
								<th class="num">slips</th>
							</tr>
						</thead>
						<tbody>
							{#each s.years as y (y.year)}
								<tr>
									<td class="mono">{y.year}</td>
									<td class="mono">{y.age ?? '—'}</td>
									<td class="mono num">{y.avg}</td>
									<td
										class="mono num"
										style:color={y.deltaPct === null
											? 'var(--fg3)'
											: y.deltaPct >= 0
												? 'var(--green)'
												: 'var(--red)'}
									>
										{y.deltaPct === null
											? '—'
											: `${y.deltaPct > 0 ? '+' : ''}${y.deltaPct.toFixed(1)}%`}
									</td>
									<td class="mono num quiet-cell">{y.months}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<div class="recent">
						{#each s.recent as slip (slip.id)}
							<form method="POST" action="?/setPayslipAmount" use:enhance class="slip">
								<input type="hidden" name="id" value={slip.id} />
								<span class="mono slip-month">{slip.periodMonth}</span>
								<input name="amount" value={slip.amount} aria-label="Payslip amount" />
								{#if slip.file}
									<a href="/files/{slip.file}" target="_blank" rel="noopener" class="slip-file"
										>📎</a
									>
								{/if}
								<button type="submit" class="btn slip-save">Fix</button>
							</form>
						{/each}
					</div>
				{:else}
					<span class="quiet">No payslips with amounts yet.</span>
				{/if}
			</div>
		{/each}
	</div>

	<form
		method="POST"
		action="?/addPayslip"
		use:enhance
		enctype="multipart/form-data"
		class="payslip-form"
	>
		<label
			><span>Whose</span>
			<select name="personId">
				{#each data.peopleOptions as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select></label
		>
		<label><span>Month</span><input name="periodMonth" type="month" /></label>
		<label
			><span>Amount (blank = read from the PDF)</span><input
				name="amount"
				inputmode="decimal"
				placeholder="45 231"
			/></label
		>
		<label><span>Payslip file (optional)</span><input name="file" type="file" /></label>
		<button type="submit" class="btn btn-primary">Add payslip</button>
	</form>
	<span class="quiet">
		Payslips land on the Documents → Payslips shelf. Month and amount read themselves from a PDF
		when they can; whatever you type wins — and a typed amount that matches a line on the slip
		teaches the reader which line to trust for {data.peopleList.join(' and ')}.
	</span>
</section>

<style>
	.save-error {
		margin: 0;
		color: var(--red);
		font-size: 13px;
	}
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.salary-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 22px;
	}
	.person-block {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.p-name {
		font-size: 13.5px;
		font-weight: 600;
	}
	.salary-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}
	.salary-table th {
		text-align: left;
		font-size: 11px;
		font-weight: 500;
		color: var(--fg3);
		padding: 4px 8px 6px 0;
		border-bottom: 1px solid var(--bd);
	}
	.salary-table td {
		padding: 6px 8px 6px 0;
		border-bottom: 1px solid var(--bd);
	}
	.salary-table .num {
		text-align: right;
	}
	.quiet-cell {
		color: var(--fg3);
	}
	.recent {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.slip {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr) auto auto;
		gap: 8px;
		align-items: center;
	}
	.slip-month {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.slip input {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 5px 9px;
		font-size: 12.5px;
		font-family: var(--font-mono);
	}
	.slip-file {
		text-decoration: none;
		font-size: 12px;
	}
	.slip-save {
		padding: 5px 10px;
		font-size: 11.5px;
	}
	.payslip-form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 12px;
		align-items: end;
	}
	.payslip-form label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		color: var(--fg3);
	}
	.payslip-form input,
	.payslip-form select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
	}
	.verdict {
		background: var(--blue-tint);
		border: 1px solid var(--blue);
		border-radius: 12px;
		padding: 18px 22px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.verdict p {
		margin: 0;
		font-size: 18px;
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
		font-size: 13px;
		color: var(--fg2);
		border-top: 1px solid var(--bd);
		padding-top: 11px;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 14px;
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
		font-size: 12px;
		color: var(--fg3);
	}
	.control.wide {
		grid-column: span 2;
	}
	@media (max-width: 640px) {
		.control.wide {
			grid-column: span 1;
		}
	}
	input[type='number'] {
		border: 1px solid var(--bd2);
		border-radius: 8px;
		padding: 9px 11px;
		font-size: 13.5px;
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
		gap: 6px;
	}
	.seg button {
		flex: 1 1 0;
		border: 1px solid var(--bd);
		background: transparent;
		color: var(--fg2);
		border-radius: 8px;
		padding: 8px 6px;
		font-size: 12.5px;
		cursor: pointer;
		white-space: nowrap;
	}
	.seg button.active {
		border-color: var(--blue);
		background: var(--blue);
		color: var(--fg-inverse);
	}
	.quiet {
		font-size: 12px;
		color: var(--fg3);
	}
	.table {
		display: flex;
		flex-direction: column;
	}
	.t-head,
	.t-row {
		display: grid;
		grid-template-columns: minmax(80px, 1fr) repeat(5, minmax(90px, auto));
		gap: 10px 14px;
		align-items: baseline;
	}
	.t-head {
		font-size: 11px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--fg3);
		padding-bottom: 8px;
		border-bottom: 1px solid var(--bd);
	}
	.t-row {
		padding: 10px 0;
		border-bottom: 1px solid var(--bd);
		font-size: 13px;
	}
	.t-row.now {
		background: var(--card2);
	}
	.r {
		text-align: right;
	}
	.chart {
		position: relative;
		padding-left: 46px;
	}
	.axis {
		position: absolute;
		left: 0;
		width: 36px;
		text-align: right;
		transform: translateY(-50%);
		font-size: 11px;
		color: var(--fg3);
	}
	.years {
		position: relative;
		height: 16px;
		margin-top: 4px;
	}
	.year {
		position: absolute;
		transform: translateX(-50%);
		font-size: 11px;
		color: var(--fg3);
		white-space: nowrap;
	}
	/* The year the pot clears the target reads as state, not decoration. */
	.year.crossing {
		color: var(--green);
		font-weight: 600;
		top: 0;
	}

	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.legend {
		display: flex;
		gap: 14px 18px;
		flex-wrap: wrap;
		font-size: 12.5px;
		color: var(--fg2);
		border-top: 1px solid var(--bd);
		padding-top: 12px;
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
		font-size: 11.5px;
	}
	@media (max-width: 720px) {
		.t-head,
		.t-row {
			grid-template-columns: minmax(70px, 1fr) repeat(3, minmax(80px, auto));
		}
		.t-head span:nth-child(2),
		.t-row span:nth-child(2),
		.t-head span:nth-child(4),
		.t-row span:nth-child(4) {
			display: none;
		}
	}
</style>
