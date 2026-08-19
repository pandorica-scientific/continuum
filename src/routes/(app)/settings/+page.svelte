<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import InfoHint from '$lib/components/InfoHint.svelte';
	import { SETUP_GUIDES } from '$lib/calendar/setup-steps';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import PeopleSettings from '$lib/components/PeopleSettings.svelte';
	import { MODULE_KEYS, MODULES } from '$lib/modules/registry';
	import { passwordHint } from '$lib/password-policy';
	import { currencyLabel } from '$lib/currencies';

	let { data, form } = $props();

	// The Google callback redirects back with its outcome in the query string.
	const calendarNotice = $derived(page.url.searchParams.get('calendar'));

	// The name is submitted alongside the id so it can be stored and shown later:
	// a CalDAV collection URL or a Google calendar id tells a person nothing about
	// which of their calendars they picked.
	// Which account is mid-sync. A pass can take several seconds against a real
	// server, and with no feedback the button looks like it did nothing.
	let syncing = $state<string | null>(null);

	let pickedName = $state<string | null>(null);
	const rememberName = (event: Event) => {
		const select = event.currentTarget as HTMLSelectElement;
		pickedName = select.options[select.selectedIndex]?.dataset.name ?? null;
	};
	const chosenName = (calendars: { id: string; name: string }[]) =>
		pickedName ?? calendars[0]?.name ?? '';

	// Watch a backup through to its outcome.
	//
	// `runBackupNow` answers as soon as the run has *started* — dumping the
	// database and copying every upload takes as long as it takes, and nobody
	// should hold a browser open for it. Nothing then looked again, so the
	// status line stopped at "the result appears here when it finishes", a
	// promise this page had no way of keeping, until someone reloaded by hand.
	//
	// Watching `backupRunning` alone is not enough. The answer this page happens
	// to render can predate the run — press Save and Back up now in quick
	// succession and the two invalidations race — and then the flag that would
	// have armed the watch is never seen at all. So asking for a backup arms it
	// directly, whatever the loads do.
	//
	// It also has to stop. `runBackup` has the run under way before the action
	// answers, so the first load to land after that is authoritative: a run is
	// either still going, or its outcome is already recorded. One look that
	// reports neither means nothing further is coming — a run that died without
	// recording anything — and the watch ends rather than polling for ever.
	//
	// So: how many fresh loads have landed since this page asked for a backup,
	// or null if it has not asked for one.
	let looksSinceAsked = $state<number | null>(null);
	const watchBackup = $derived(data.backupRunning || looksSinceAsked === 0);
	$effect(() => {
		if (!watchBackup) return;
		const timer = setInterval(() => {
			void invalidateAll().then(() => {
				if (looksSinceAsked !== null) looksSinceAsked += 1;
			});
		}, 1000);
		return () => clearInterval(timer);
	});
</script>

<ScreenHeader
	title="Settings"
	caption="Everything visible in Continuum is configuration, not content."
/>

<!-- One place, one component. The calendar section used to draw its own copy
     with a `.form-error` class this file has no rule for — and Svelte scopes
     styles per component, so a failed calendar connection rendered as unstyled
     body text below the form. -->
<ActionError message={form?.message ?? null} />

{#if data.isAdmin}
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
						class:on={data.moduleToggles?.[key]}
						role="switch"
						aria-checked={data.moduleToggles?.[key] ?? false}
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
{/if}

<section class="section">
	<Eyebrow
		emoji="👥"
		label="Household"
		caption="People can sign in and own accounts and documents."
	/>
	<PeopleSettings
		people={data.people}
		me={data.me}
		enrollmentLink={form?.enrollmentLink ?? null}
		enrollmentLinkDays={data.enrollmentLinkDays}
		passkeys={data.passkeys}
		origin={data.origin}
		myPasskeys={data.myPasskeys}
	/>

	<form
		method="POST"
		action="?/changePassword"
		use:enhance={() =>
			async ({ update }) => {
				// reset:true clears the three password fields on success, which is
				// half the confirmation that anything happened.
				await update({ reset: true });
			}}
		class="card password-form"
	>
		<input name="currentPassword" type="password" placeholder="Current password" required />
		<input
			name="newPassword"
			type="password"
			placeholder={`New password (${passwordHint(data.passwordMinLength)})`}
			required
		/>
		<input name="confirmPassword" type="password" placeholder="Repeat new password" required />
		<button type="submit" class="btn">Change password</button>
	</form>
	{#if form?.passwordChanged}
		<p class="ok-note">
			Password changed. Every other signed-in device has been signed out, and any registered
			passkeys have been removed — add them again from this device.
		</p>
	{/if}
</section>

{#if data.backup}
	<section class="section">
		<div class="eyebrow-row">
			<Eyebrow emoji="🛟" label="Backups (one restorable dump plus every uploaded file)" />
			<InfoHint label="How backups work">
				One restorable database dump, overwritten each run, plus every uploaded file. Point it at a
				cloud-sync folder and the copy leaves the machine by itself — the sync client keeps the
				file's version history, so overwriting the dump each time still leaves you earlier ones.
			</InfoHint>
		</div>
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
				<form
					method="POST"
					action="?/runBackupNow"
					use:enhance={() => {
						looksSinceAsked = 0;
					}}
				>
					<button type="submit" class="btn" disabled={data.backupRunning}>
						{data.backupRunning ? 'Backing up…' : 'Back up now'}
					</button>
				</form>
				{#if data.backupRunning}
					<span class="note">
						Running in the background — the result appears here when it finishes.
					</span>
				{:else if data.lastBackup}
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
{/if}

{#if data.status}
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
{/if}

{#if data.isAdmin}
	<section class="section" id="calendars">
		<div class="eyebrow-row">
			<Eyebrow emoji="📆" label="Connected calendars" />
			<span class="eyebrow-caption">two-way sync with iCloud and other CalDAV servers</span>
		</div>

		{#if form?.created}
			<p class="calendar-notice" role="status">Calendar created. Press “Sync now” to fill it.</p>
		{/if}

		{#if calendarNotice}
			<!-- The OAuth callback is a redirect, so its outcome arrives in the URL
			     rather than as a form result. -->
			<p class="calendar-notice" role="status">{calendarNotice}</p>
		{/if}

		{#each data.calendarAccounts as account (account.id)}
			{@const makesOwn = data.calendarProviders.find(
				(p) => p.id === account.provider
			)?.createsOwnCalendar}
			<div class="card cal-account">
				<div class="ca-head">
					<span class="ca-label">{account.label}</span>
					{#if syncing === account.id}
						<span class="ca-state busy">syncing now…</span>
					{:else if account.lastError}
						<span class="ca-state bad">{account.lastError}</span>
					{:else if account.lastSyncAt}
						<span class="ca-state good">
							last synced {new Date(account.lastSyncAt).toLocaleString('en-GB')}
						</span>
					{:else}
						<span class="ca-state">never synced</span>
					{/if}
				</div>

				<!-- One calendar per account, always changeable. Syncing a whole
				     account would mean writing household events into every calendar
				     someone owns; picking one is how this stays usable. -->
				<form method="POST" action="?/listRemoteCalendars" use:enhance class="ca-row">
					<input type="hidden" name="id" value={account.id} />
					{#if account.remoteCalId}
						<span class="ca-cal">
							Syncing with <strong>{account.remoteCalName ?? account.remoteCalId}</strong>
						</span>
						<!-- A provider that makes its own calendar has nothing to change
						     to: it may only touch what it created. -->
						{#if !makesOwn}
							<button class="btn" type="submit">Change calendar</button>
						{/if}
					{:else}
						<button class="btn btn-primary" type="submit">
							{makesOwn ? 'Create a calendar' : 'Choose a calendar'}
						</button>
						<span class="quiet">
							{makesOwn
								? 'Continuum makes its own calendar — it cannot see or touch your others.'
								: 'No calendar chosen yet — nothing syncs until one is.'}
						</span>
					{/if}
				</form>

				<!-- Scoped to the account the list was fetched for. Without listedFor
				     this picker appeared on every card, and choosing on the wrong one
				     wrote the wrong account's calendar. -->
				{#if form?.calendars && form?.listedFor === account.id}
					<form method="POST" action="?/chooseCalendar" use:enhance class="ca-row">
						<input type="hidden" name="id" value={account.id} />
						<select name="remoteCalId" onchange={rememberName}>
							{#each form.calendars as calendar (calendar.id)}
								<option value={calendar.id} data-name={calendar.name}>{calendar.name}</option>
							{/each}
						</select>
						<input type="hidden" name="remoteCalName" value={chosenName(form.calendars)} />
						<button class="btn btn-primary" type="submit">Use this calendar</button>
					</form>
					<span class="quiet">
						Point this at a calendar of its own — make one called “Household” in
						{account.label.includes('Google') ? 'Google' : 'iCloud'} first. Sharing it with a personal
						calendar works, but everything this app writes lands among your own events.
					</span>
				{/if}

				<div class="ca-row">
					<form
						method="POST"
						action="?/syncCalendarNow"
						use:enhance={() => {
							syncing = account.id;
							return async ({ update }) => {
								await update();
								syncing = null;
							};
						}}
					>
						<input type="hidden" name="id" value={account.id} />
						<button class="btn" type="submit" disabled={!account.remoteCalId || syncing !== null}>
							{syncing === account.id ? 'Syncing…' : 'Sync now'}
						</button>
					</form>
					<form method="POST" action="?/disconnectCalendar" use:enhance>
						<input type="hidden" name="id" value={account.id} />
						<button class="btn danger" type="submit">Disconnect</button>
					</form>
				</div>
			</div>
		{/each}

		{#each data.calendarProviders.filter((p) => !data.calendarAccounts.some((a) => a.provider === p.id)) as provider (provider.id)}
			<!-- Which flow this provider needs comes from the registry, not from a
			     name check here: CalDAV takes an app password, Google has to send the
			     browser away and come back. -->
			<form
				method="POST"
				action={provider.oauth ? '?/authoriseGoogle' : '?/connectCalendar'}
				class="card cal-connect"
			>
				<input type="hidden" name="provider" value={provider.id} />
				<span class="cc-title">
					Connect {provider.label}
					{#if SETUP_GUIDES[provider.id]}
						<InfoHint label="How to connect {provider.label}">
							{#if SETUP_GUIDES[provider.id].warning}
								<strong class="warn">{SETUP_GUIDES[provider.id].warning}</strong>
							{/if}
							<ol class="steps">
								{#each SETUP_GUIDES[provider.id].steps as step (step)}
									<li>{step}</li>
								{/each}
							</ol>
							{#if SETUP_GUIDES[provider.id].docs}
								<span class="docs mono">{SETUP_GUIDES[provider.id].docs}</span>
							{/if}
						</InfoHint>
					{:else if provider.hint}
						<InfoHint label="How to connect {provider.label}">{provider.hint}</InfoHint>
					{/if}
				</span>
				<div class="cc-fields">
					<!-- Rendered from the provider's own field list. Adding a provider
					     never edits this screen. -->
					{#each provider.fields as field (field.key)}
						<label class="field">
							<span>{field.label}</span>
							<input
								name={field.key}
								type={field.secret ? 'password' : field.kind === 'url' ? 'url' : 'text'}
								placeholder={field.placeholder ?? ''}
								required={field.required}
								autocomplete="off"
							/>
						</label>
					{/each}
				</div>
				<div class="ca-row">
					<button class="btn btn-primary" type="submit">
						{provider.oauth ? 'Authorise with Google' : 'Connect'}
					</button>
				</div>
			</form>
		{/each}

		{#if data.calendarProviders.every( (p) => data.calendarAccounts.some((a) => a.provider === p.id) )}
			<span class="quiet">
				Both providers are connected. One account each — disconnect above to connect a different
				Apple ID or Google account.
			</span>
		{/if}

		<form method="POST" action="?/toggleCalendarMarkers" use:enhance class="card marker-row">
			<button
				type="submit"
				class="switch"
				class:on={data.calendarMarkers}
				role="switch"
				aria-checked={data.calendarMarkers}
				aria-label="Mark Continuum's own events"
			>
				<span class="knob"></span>
			</button>
			<span class="r-text">
				<span class="r-label">Mark the ledger's own events</span>
				<span class="r-detail">
					Adds the module emoji and “· Continuum” to events this app writes, so they are tellable
					apart from your own in a shared calendar.
				</span>
			</span>
		</form>

		<form method="POST" action="?/setCalendarInterval" use:enhance class="card marker-row">
			<label class="interval">
				<span class="r-label">Check connected calendars every</span>
				<span class="interval-input">
					<input
						type="number"
						name="minutes"
						min="1"
						max="1440"
						step="1"
						value={data.calendarSyncMinutes}
						aria-label="Minutes between calendar sync passes"
					/>
					<span>minutes</span>
				</span>
				<span class="r-detail">
					Each pass is one request per connected calendar. Slower is kinder to a metered connection;
					faster is only useful while setting something up. Takes effect without a restart — the
					interval is measured against each account's own last sync.
				</span>
			</label>
			<button class="btn" type="submit">Save</button>
		</form>
	</section>

	<section class="section">
		<div class="eyebrow-row">
			<Eyebrow emoji="🔌" label="API tokens (read-only access to the whole ledger)" />
			<InfoHint label="What an API token can do">
				A token grants read access to every transaction, account and figure in this ledger. It
				cannot change anything.
			</InfoHint>
		</div>

		{#if form?.createdToken}
			<div class="card token-new">
				<span class="tn-label">Copy this now — it is not shown again.</span>
				<code class="api-token-raw mono">{form.createdToken}</code>
			</div>
		{/if}

		<form method="POST" action="?/createApiToken" use:enhance class="card token-add">
			<label>
				<span>Label</span>
				<input class="api-token-label" name="label" placeholder="Home Assistant" />
			</label>
			<button type="submit" class="btn btn-primary">Create token</button>
		</form>

		{#each data.apiTokens as t (t.id)}
			<div class="card token-row">
				<div class="tr-main">
					<span class="tr-label">{t.label}</span>
					<span class="tr-meta">created {t.created} · last used {t.lastUsed ?? 'never'}</span>
				</div>
				<form method="POST" action="?/revokeApiToken" use:enhance>
					<input type="hidden" name="id" value={t.id} />
					<button type="submit" class="btn">Revoke</button>
				</form>
			</div>
		{/each}
	</section>
{/if}

<style>
	.calendar-notice {
		color: var(--fg2);
		font-size: 13px;
	}

	.cal-account,
	.cal-connect {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.ca-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}

	.ca-label {
		font-weight: 600;
	}

	.ca-state {
		font-size: 12px;
		color: var(--fg3);
	}

	.ca-state.good {
		color: var(--green);
	}

	.ca-state.bad {
		color: var(--red);
	}

	.ca-state.busy {
		color: var(--yellow);
	}

	.ca-cal {
		font-size: 12px;
		color: var(--fg3);
	}

	.ca-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.cc-title {
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.warn {
		display: block;
		color: var(--red);
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

	.cc-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px 14px;
	}

	.marker-row {
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}

	.interval {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1;
	}

	.interval-input {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--fg3);
		font-size: 13px;
	}

	.interval-input input {
		width: 5.5rem;
	}

	@media (max-width: 40rem) {
		.cc-fields {
			grid-template-columns: 1fr;
		}
	}

	.token-new {
		border-color: var(--blue);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tn-label {
		font-size: 12px;
		color: var(--fg3);
	}
	.api-token-raw {
		font-size: 13px;
		word-break: break-all;
		color: var(--fg1);
	}
	.token-add {
		display: flex;
		gap: 10px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.token-add label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		color: var(--fg3);
		flex: 1 1 220px;
	}
	.token-add input {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
	}
	.token-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.tr-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.tr-label {
		font-size: 13.5px;
		font-weight: 500;
	}
	.tr-meta {
		font-size: 12px;
		color: var(--fg3);
	}
	.modules {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.module-row {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) auto;
		align-items: center;
		gap: 12px;
		padding: 11px 0;
		border-top: 1px solid var(--bd);
	}
	.module-row:first-child {
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
	/* Three equal password fields and a button. This used to borrow .add-form,
	   whose second column is 90px wide for a birth year — which left the
	   new-password input a third the width of its neighbours. That rule now
	   lives only in PeopleSettings, next to the form it was written for. */
	.password-form {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
		gap: 8px;
		padding-top: 11px;
		border-top: 1px solid var(--bd);
	}
	.ok-note {
		margin: 8px 0 0;
		font-size: 12.5px;
		color: var(--green);
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
		.password-form {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
