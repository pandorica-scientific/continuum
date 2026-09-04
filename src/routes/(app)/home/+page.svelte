<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
	import { submitAction } from '$lib/actions/result';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import InfoHint from '$lib/components/InfoHint.svelte';
	import SummaryBand from '$lib/components/SummaryBand.svelte';

	let { data, form } = $props();

	let kind = $state('homeassistant');
	const selected = $derived(data.providers.find((p) => p.id === kind));
	let busyDevice: string | null = $state(null);
	let deviceError = $state<string | null>(null);

	async function toggle(deviceId: string, on: boolean) {
		busyDevice = deviceId;
		deviceError = null;
		try {
			const body = new FormData();
			body.set('deviceId', deviceId);
			body.set('on', String(!on));
			const outcome = await submitAction('?/toggleDevice', body);
			if (outcome.type !== 'success') deviceError = outcome.message;
		} finally {
			busyDevice = null;
		}
	}
</script>

<ScreenHeader
	title="Home"
	caption={data.livedInName
		? `Bound to ${data.livedInName} — the flat you live in, never the rentals.`
		: 'Bound to the flat you live in.'}
/>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}
{#if deviceError}<div class="error" role="alert">{deviceError}</div>{/if}

{#if !data.configured}
	<section class="card setup">
		<div class="eyebrow-row">
			<Eyebrow hue="--orange" emoji="🔌" label="Connect your smart home" />
			<InfoHint label="What connecting a smart home does">
				Continuum reads energy, water, climate and sensors, controls devices, and feeds the lived-in
				flat's meter readings into its bills. Platforms plug in behind one interface — Home
				Assistant is the first; the demo home shows the screen without any hardware.
			</InfoHint>
		</div>
		<form method="POST" action="?/configure" use:enhance class="stack">
			<label
				><span>Home for meter readings</span>
				<select name="meterPropertyId" required>
					<option value="">Choose a lived-in property</option>
					{#each data.livedInOptions as property (property.id)}
						<option value={property.id}>{property.name}</option>
					{/each}
				</select></label
			>
			<label
				><span>Platform</span>
				<select name="kind" bind:value={kind}>
					{#each data.providers as p (p.id)}
						<option value={p.id}>{p.label}</option>
					{/each}
				</select></label
			>
			{#if selected && selected.fields.length}
				<!-- the form renders itself from the provider's field description -->
				<div class="grid">
					{#each selected.fields as f (f.key)}
						<label
							><span>{f.label}</span><input
								name={f.key}
								type={f.secret ? 'password' : 'text'}
								inputmode={f.kind === 'amount' ? 'decimal' : undefined}
								placeholder={f.placeholder ?? ''}
							/></label
						>
					{/each}
				</div>
				{#if selected.hint}
					<span class="quiet">{selected.hint}</span>
				{/if}
			{/if}
			<div class="row">
				<button type="submit" class="btn btn-primary">Connect</button>
			</div>
		</form>
	</section>
{:else if 'unreachable' in data && data.unreachable}
	<section class="card setup">
		<Eyebrow hue="--orange" emoji="⚠️" label={`${data.providerLabel} is not answering`} />
		<p class="quiet">{data.unreachable}</p>
		<form method="POST" action="?/disconnect" use:enhance>
			<button type="submit" class="btn">Disconnect and reconfigure</button>
		</form>
	</section>
{:else if data.snapshot}
	<SummaryBand
		tiles={data.snapshot.metrics.map((m) => ({
			label: m.label,
			value: m.value,
			unit: m.unit,
			note: m.note
		}))}
	/>

	{#if data.snapshot.attention.length}
		<section class="attention">
			{#each data.snapshot.attention as item, i (i)}
				<span class="a-item" style:color={item.hue === 'red' ? 'var(--red)' : 'var(--yellow)'}>
					{item.emoji}
					{item.text}
				</span>
			{/each}
		</section>
	{/if}

	<section class="section">
		<div class="eyebrow-row">
			<Eyebrow hue="--orange" emoji="🛋️" label="Rooms" />
			<span class="eyebrow-caption">{data.providerLabel} · devices toggle in place</span>
		</div>
		<div class="rooms">
			{#each data.snapshot.rooms as room (room.name)}
				<div class="card room">
					<div class="r-head">
						<span class="r-name">{room.name}</span>
						{#if room.climate}<span class="mono r-climate">{room.climate}</span>{/if}
					</div>
					<div class="devices">
						{#each room.devices as device (device.id)}
							<button
								type="button"
								class="device"
								class:on={device.on}
								disabled={!device.controllable || busyDevice === device.id}
								onclick={() => toggle(device.id, device.on)}
							>
								<span class="d-emoji">{device.emoji}</span>
								<span class="d-name">{device.name}</span>
								<span class="d-state" style:color={device.on ? 'var(--green)' : 'var(--fg3)'}>
									{busyDevice === device.id ? '…' : device.state}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</section>

	{#if 'energyDays' in data && data.energyDays.length}
		<section class="card stack">
			<div class="eyebrow-row">
				<Eyebrow hue="--orange" emoji="⚡" label="Energy into the budget" />
				<span class="eyebrow-caption">kWh a day · above the average in orange</span>
			</div>
			<div class="bars">
				{#each data.energyDays as d, i (d.day)}
					<div class="bar-wrap" title="{d.day}: {d.kwh.toFixed(1)} kWh">
						<div
							class="bar"
							style:height="{d.pct}%"
							style:background={d.high ? 'var(--orange)' : 'var(--teal)'}
						></div>
						<!-- Every fifth day only. Thirty labels under thirty bars is a
						     grey smear; five of them is a scale. -->
						<span class="bar-day mono">{i % 5 === 0 ? d.day.slice(-2) : ''}</span>
					</div>
				{/each}
			</div>
			{#if data.billNote}<span class="quiet">{data.billNote}</span>{/if}
		</section>
	{/if}

	{#if 'week' in data && data.week.length}
		<section class="card stack">
			<div class="eyebrow-row">
				<Eyebrow hue="--orange" emoji="🗓️" label="This week at home" />
				<a href="/calendar" class="open-link">Open calendar →</a>
			</div>
			{#each data.week as e (e.date + e.label)}
				<div class="week-row">
					<span class="mono w-date">{e.date}</span>
					<span class="w-label">{e.label}</span>
				</div>
			{/each}
		</section>
	{/if}

	<form method="POST" action="?/disconnect" use:enhance class="disconnect">
		<button type="submit" class="btn">Disconnect {data.providerLabel}</button>
	</form>
{/if}

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.setup {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		max-width: 720px;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--space-6);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.row {
		display: flex;
		gap: var(--space-4);
	}
	.quiet {
		line-height: 1.55;
		margin: 0;
	}
	.attention {
		display: flex;
		gap: 10px 22px;
		flex-wrap: wrap;
		border: 1px solid var(--yellow);
		background: var(--yellow-tint);
		border-radius: var(--radius-xl);
		padding: 10px 15px;
	}
	.a-item {
		font-size: var(--text-md);
	}
	.rooms {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: var(--space-8);
	}
	.room {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.r-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-6);
	}
	.r-name {
		font-size: var(--text-lg);
		font-weight: 600;
	}
	.r-climate {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.devices {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: var(--space-4);
	}
	.device {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		border: 1px solid var(--bd);
		background: transparent;
		border-radius: var(--radius-md);
		padding: 9px 10px;
		cursor: pointer;
		text-align: left;
		color: var(--fg2);
	}
	.device:hover:not(:disabled) {
		border-color: var(--bd2);
	}
	.device.on {
		border-color: var(--green);
		background: var(--green-tint);
		color: var(--fg1);
	}
	.device:disabled {
		cursor: default;
		opacity: 0.75;
	}
	.d-emoji {
		font-size: var(--text-xl);
	}
	.d-name {
		font-size: var(--text-sm);
		min-width: 0;
	}
	.d-state {
		font-size: var(--text-xs);
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		height: 140px;
	}
	.bar-wrap {
		flex: 1 1 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		min-width: 0;
	}
	.bar {
		width: 100%;
		border-radius: var(--radius-xs) var(--radius-xs) 0 0;
		transition: filter var(--dur) var(--ease);
	}
	.bar-wrap:hover .bar {
		filter: brightness(1.2);
	}
	.bar-day {
		font-size: var(--text-2xs);
		color: var(--fg3);
		text-align: center;
		line-height: 1.4;
		min-height: 1.4em;
	}
	.week-row {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr);
		gap: var(--space-6);
		align-items: baseline;
		padding: 8px 0;
		border-top: 1px solid var(--bd);
		font-size: var(--text-md);
	}
	.w-date {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.w-label {
		color: var(--fg2);
	}
	.open-link {
		font-size: var(--text-sm);
	}
	.disconnect {
		display: flex;
	}
</style>
