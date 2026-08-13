<script lang="ts">
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { MODULE_KEYS, MODULES } from '$lib/modules/registry';
	import { currencyLabel } from '$lib/currencies';

	let { data, form } = $props();

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
			{@const m = MODULES[key]}
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
	<Eyebrow
		emoji="🛟"
		label="Backups"
		caption="One restorable database dump, overwritten each run, plus every uploaded file — point it at a cloud-sync folder and the copy leaves the machine by itself (the sync client keeps the file's version history)."
	/>
	<div class="card stack-card">
		<form method="POST" action="?/saveBackup" use:enhance class="backup-form">
			<label class="field dest">
				<span>Destination folder</span>
				<input
					name="dir"
					list="backup-destinations"
					value={data.backup.dir}
					placeholder="e.g. a Google Drive or Dropbox folder"
				/>
				<datalist id="backup-destinations">
					{#each data.backupDestinations as d (d.path)}
						<option value={d.path}>{d.label}</option>
					{/each}
				</datalist>
			</label>
			<label class="field">
				<span>How often</span>
				<select name="cadence" value={data.backup.cadence}>
					<option value="off">Off</option>
					<option value="weekly">Weekly</option>
					<option value="monthly">Monthly</option>
				</select>
			</label>
			<button type="submit" class="btn">Save</button>
		</form>
		<div class="backup-status">
			<form method="POST" action="?/runBackupNow" use:enhance>
				<button type="submit" class="btn">Back up now</button>
			</form>
			{#if data.lastBackup}
				<span class="note" style:color={data.lastBackup.ok ? 'var(--green)' : 'var(--red)'}>
					{data.lastBackup.ok ? 'Last backup' : 'Last attempt failed'}
					· {data.lastBackup.at.slice(0, 16).replace('T', ' ')} · {data.lastBackup.note}
				</span>
			{:else}
				<span class="note">No backup has run yet.</span>
			{/if}
		</div>
		{#if data.backupDestinations.length}
			<span class="note">
				Detected sync folders on this machine: {data.backupDestinations
					.map((d) => d.label)
					.join(', ')}. Backups land in a “Continuum backups” subfolder.
			</span>
		{/if}
	</div>
</section>

<section class="section">
	<Eyebrow
		emoji="🐳"
		label="Self-hosting"
		caption="Live facts about this installation — nothing here calls home."
	/>
	<div class="card stack-card">
		<div class="status-grid">
			<div class="status">
				<span class="s-label">Version</span>
				<span class="mono s-value">{data.status.version}</span>
				<span class="note">{data.status.migrations} migrations applied</span>
			</div>
			<div class="status">
				<span class="s-label">Database</span>
				<span class="mono s-value">{data.status.databaseSize}</span>
				<span class="note">PostgreSQL, on its own volume</span>
			</div>
			{#each data.status.storage as s (s.label)}
				<div class="status">
					<span class="s-label">{s.label}</span>
					<span class="mono s-value" style:color={s.writable ? 'var(--fg1)' : 'var(--red)'}>
						{s.size ?? '—'}
					</span>
					<span class="note" style:color={s.writable ? '' : 'var(--red)'}>
						{s.path} · {s.writable ? 'writable' : 'NOT WRITABLE'}
					</span>
				</div>
			{/each}
			<div class="status">
				<span class="s-label">Uptime</span>
				<span class="mono s-value">{data.status.uptime}</span>
				<span class="note">node {data.status.node}</span>
			</div>
			<div class="status">
				<span class="s-label">Base URL</span>
				<span class="mono s-value origin">{data.status.origin}</span>
				<span class="note">what the server believes it is (ORIGIN)</span>
			</div>
		</div>
		<p class="prose">
			Everything on this server — people, currencies, modules, integrations — is configuration in
			your own database. Restoring elsewhere is booting a fresh instance and feeding it the backup
			dump.
		</p>
		<div class="config-row">
			<a href="/settings/export" class="btn" download>⬇️ Export settings</a>
			<form method="POST" action="?/importConfig" use:enhance enctype="multipart/form-data">
				<label class="import-label">
					<input
						name="file"
						type="file"
						accept="application/json"
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					/>
					<span class="btn">⬆️ Import settings…</span>
				</label>
			</form>
			<span class="note">
				ledger.config.json — configuration only (name, currency, modules, backup, learned labels),
				never data or passwords
			</span>
		</div>
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
	.stack-card {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.backup-form {
		display: flex;
		align-items: flex-end;
		gap: 10px;
		flex-wrap: wrap;
	}
	.backup-form .dest {
		flex: 1 1 320px;
	}
	.backup-status {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.status-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 14px;
	}
	.status {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.s-label {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.s-value {
		font-size: 16px;
		font-weight: 600;
	}
	.s-value.origin {
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.config-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.import-label input[type='file'] {
		display: none;
	}
	.import-label {
		cursor: pointer;
	}
	@media (max-width: 640px) {
		.add-form {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
