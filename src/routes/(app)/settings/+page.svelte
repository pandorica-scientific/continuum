<script lang="ts">
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { MODULE_KEYS } from '$lib/modules/registry';
	import { currencyLabel } from '$lib/currencies';

	let { data, form } = $props();

	const moduleLabels: Record<string, { emoji: string; label: string; note: string }> = {
		import: { emoji: '📥', label: 'Import', note: 'statement upload and the review queue' },
		property: { emoji: '🏢', label: 'Property', note: 'flats, tenancies and bills' },
		investments: { emoji: '📈', label: 'Investments', note: 'holdings from broker reports' },
		loans: { emoji: '💳', label: 'Loans', note: 'mortgages and fixation periods' },
		retirement: { emoji: '🎯', label: 'Retirement', note: 'the projection model' },
		home: { emoji: '🏠', label: 'Home Assistant', note: 'devices and meter readings' },
		calendar: { emoji: '📅', label: 'Calendar', note: 'two-way sync and generated events' },
		documents: { emoji: '🗂️', label: 'Documents', note: 'the archive with expiry dates' }
	};

	let addingPerson = $state(false);
</script>

<ScreenHeader
	emoji="⚙️"
	title="Settings"
	caption="Everything visible in Continuum is configuration, not content."
/>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<section class="section">
	<Eyebrow
		emoji="🧩"
		label="Modules"
		caption="Everything is optional. Switch off what you do not have and it leaves the sidebar entirely."
	/>
	<div class="card modules">
		{#each MODULE_KEYS as key (key)}
			{@const m = moduleLabels[key]}
			<form method="POST" action="?/toggleModule" use:enhance class="module-row">
				<input type="hidden" name="key" value={key} />
				<span class="emoji">{m.emoji}</span>
				<span class="mod-label">
					<span>{m.label}</span>
					<span class="note">{m.note}</span>
				</span>
				<button
					type="submit"
					class="switch"
					class:on={data.moduleToggles[key]}
					role="switch"
					aria-checked={data.moduleToggles[key]}
					aria-label={`Toggle ${m.label}`}
				>
					<span class="knob"></span>
				</button>
			</form>
		{/each}
	</div>
</section>

<section class="section">
	<Eyebrow
		emoji="💱"
		label="Currencies"
		caption="Balances stay in their own currency everywhere. Only the totals at the top of a screen convert, at the day's rate."
	/>
	<div class="card">
		<form method="POST" action="?/setBaseCurrency" use:enhance class="currency-form">
			<label class="field">
				<span>Base currency</span>
				<select name="baseCurrency" value={data.baseCurrency}>
					{#each data.currencies as c (c)}
						<option value={c}>{currencyLabel(c)}</option>
					{/each}
				</select>
			</label>
			<button type="submit" class="btn">Save</button>
		</form>
	</div>
</section>

<section class="section">
	<Eyebrow
		emoji="👥"
		label="Household"
		caption="People can sign in and own accounts and documents."
	/>
	<div class="card people">
		{#each data.people as p (p.id)}
			<div class="person-row">
				<span class="avatar">{p.initials}</span>
				<span class="mod-label">
					<span>{p.name}</span>
					<span class="note">{p.role}{p.birthYear ? ` · born ${p.birthYear}` : ''}</span>
				</span>
			</div>
		{/each}

		{#if addingPerson}
			<form method="POST" action="?/addPerson" use:enhance class="add-form">
				<input name="name" placeholder="Name" />
				<input name="birthYear" placeholder="Birth year" inputmode="numeric" />
				<input name="password" type="password" placeholder="Password (8+ characters)" />
				<button type="submit" class="btn">Add</button>
			</form>
		{:else}
			<button type="button" class="btn" onclick={() => (addingPerson = true)}
				>➕ Add a person</button
			>
		{/if}
	</div>
</section>

<section class="section">
	<Eyebrow emoji="🐳" label="Self-hosting" />
	<div class="card">
		<p class="prose">
			This server is yours. Every label, currency, person, module and integration on it is
			configuration stored in your own database — nothing calls home. Back up the
			<span class="mono">continuum-db</span> and <span class="mono">continuum-data</span> Docker volumes
			and you have backed up everything.
		</p>
	</div>
</section>

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.modules,
	.people {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.module-row,
	.person-row {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) auto;
		align-items: center;
		gap: 12px;
		padding: 11px 0;
		border-top: 1px solid var(--bd);
	}
	.module-row:first-child,
	.person-row:first-child {
		border-top: 0;
	}
	.emoji {
		font-size: 15px;
	}
	.mod-label {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.mod-label > span:first-child {
		font-size: 13.5px;
	}
	.note {
		font-size: 11.5px;
		color: var(--fg3);
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
	.currency-form {
		display: flex;
		align-items: flex-end;
		gap: 10px;
		flex-wrap: wrap;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12.5px;
		color: var(--fg3);
	}
	select,
	input {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
	}
	.avatar {
		width: 26px;
		height: 26px;
		border-radius: 26px;
		background: var(--card3);
		display: grid;
		place-items: center;
		font-size: 11px;
	}
	.add-form {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) 90px minmax(0, 1fr) auto;
		gap: 8px;
		padding-top: 11px;
		border-top: 1px solid var(--bd);
	}
	.prose {
		margin: 0;
		font-size: 13.5px;
		color: var(--fg2);
		line-height: 1.55;
	}
	@media (max-width: 640px) {
		.add-form {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
