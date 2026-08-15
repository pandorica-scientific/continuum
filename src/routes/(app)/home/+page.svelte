<script lang="ts">
	import { enhance } from '$app/forms';
	import { submitAction } from '$lib/actions/result';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import MetricTile from '$lib/components/MetricTile.svelte';

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
	emoji="🏠"
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
		<Eyebrow emoji="🔌" label="Connect your smart home" />
		<p class="quiet">
			Continuum reads energy, water, climate and sensors, controls devices, and feeds the lived-in
			flat's meter readings into its bills. Platforms plug in behind one interface — Home Assistant
			is the first; the demo home shows the screen without any hardware.
		</p>
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
		<Eyebrow emoji="⚠️" label={`${data.providerLabel} is not answering`} />
		<p class="quiet">{data.unreachable}</p>
		<form method="POST" action="?/disconnect" use:enhance>
			<button type="submit" class="btn">Disconnect and reconfigure</button>
		</form>
	</section>
{:else if data.snapshot}
	<section class="tiles">
		{#each data.snapshot.metrics as m (m.key)}
			<MetricTile label={m.label} value={m.value} unit={m.unit} note={m.note} />
		{/each}
	</section>

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
			<Eyebrow emoji="🛋️" label="Rooms" />
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
				<Eyebrow emoji="⚡" label="Energy into the budget" />
				<span class="eyebrow-caption">last {data.energyDays.length} days · orange ran high</span>
			</div>
			<div class="bars">
				{#each data.energyDays as d (d.day)}
					<div class="bar-wrap" title="{d.day}: {d.kwh.toFixed(1)} kWh">
						<div
							class="bar"
							style:height="{d.pct}%"
							style:background={d.high ? 'var(--orange)' : 'var(--teal)'}
						></div>
					</div>
				{/each}
			</div>
			{#if data.billNote}<span class="quiet">{data.billNote}</span>{/if}
		</section>
	{/if}

	{#if 'week' in data && data.week.length}
		<section class="card stack">
			<div class="eyebrow-row">
				<Eyebrow emoji="🗓️" label="This week at home" />
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
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.setup {
		display: flex;
		flex-direction: column;
		gap: 14px;
		max-width: 720px;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		color: var(--fg3);
	}
	input,
	select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
		line-height: 1.55;
		margin: 0;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 12px;
	}
	.attention {
		display: flex;
		gap: 10px 22px;
		flex-wrap: wrap;
		border: 1px solid var(--yellow);
		background: var(--yellow-tint);
		border-radius: 12px;
		padding: 10px 15px;
	}
	.a-item {
		font-size: 13px;
	}
	.rooms {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 16px;
	}
	.room {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.r-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.r-name {
		font-size: 14px;
		font-weight: 600;
	}
	.r-climate {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.devices {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 8px;
	}
	.device {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		border: 1px solid var(--bd);
		background: transparent;
		border-radius: 8px;
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
		font-size: 15px;
	}
	.d-name {
		font-size: 12.5px;
		min-width: 0;
	}
	.d-state {
		font-size: 11px;
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		height: 120px;
	}
	.bar-wrap {
		flex: 1 1 0;
		height: 100%;
		display: flex;
		align-items: flex-end;
	}
	.bar {
		width: 100%;
		border-radius: 3px 3px 0 0;
	}
	.week-row {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr);
		gap: 12px;
		align-items: baseline;
		padding: 8px 0;
		border-top: 1px solid var(--bd);
		font-size: 13.5px;
	}
	.w-date {
		font-size: 12px;
		color: var(--fg3);
	}
	.w-label {
		color: var(--fg2);
	}
	.open-link {
		font-size: 12.5px;
	}
	.disconnect {
		display: flex;
	}
</style>
