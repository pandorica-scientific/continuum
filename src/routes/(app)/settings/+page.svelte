<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
	import {
		messageFromActionResult,
		shouldCloseAfterAction,
		submitAction
	} from '$lib/actions/result';
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import InfoHint from '$lib/components/InfoHint.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { SETUP_GUIDES } from '$lib/calendar/setup-steps';
	import Field from '$lib/components/Field.svelte';
	import { goto } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import IconTile from '$lib/components/IconTile.svelte';
	import Switch from '$lib/components/Switch.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import PeopleSettings from '$lib/components/PeopleSettings.svelte';
	import { MODULE_KEYS, MODULES } from '$lib/modules/registry';
	import { passwordHint } from '$lib/password-policy';
	import { currencyLabel } from '$lib/currencies';

	let { data, form } = $props();

	/**
	 * The nine things this screen configures, and which of them this person has.
	 *
	 * Availability mirrors the `{#if}` around each section exactly — a nav entry
	 * leading to a section that will not render is a dead click, and the two
	 * conditions living apart is how they would drift.
	 */
	const sections = $derived(
		(
			[
				{ key: 'modules', label: 'Modules', icon: 'layers', hue: '--brand', when: data.isAdmin },
				{
					key: 'currencies',
					label: 'Currencies',
					icon: 'coins',
					hue: '--teal',
					when: data.isAdmin
				},
				{ key: 'household', label: 'Household', icon: 'people', hue: '--purple', when: true },
				{
					key: 'backups',
					label: 'Backups',
					icon: 'inbox',
					hue: '--green',
					when: Boolean(data.backup)
				},
				{
					key: 'hosting',
					label: 'Self-hosting',
					icon: 'gear',
					hue: '--fg3',
					when: Boolean(data.status)
				},
				{
					key: 'calendars',
					label: 'Calendars',
					icon: 'calendar',
					hue: '--indigo',
					when: data.isAdmin
				},
				{ key: 'tokens', label: 'API tokens', icon: 'key', hue: '--orange', when: data.isAdmin },
				{ key: 'categories', label: 'Categories', icon: 'tag', hue: '--teal', when: data.isAdmin },
				{
					key: 'open',
					label: 'Open instance',
					icon: 'lock',
					hue: '--yellow',
					when: data.isAdmin
				}
			] as const
		).filter((s) => s.when)
	);

	// In the URL, so a section survives a reload and a shared link — and so the
	// `#calendars` anchor other screens already point at still lands on the
	// calendar section rather than scrolling to a hidden element.
	const requested = $derived(page.url.searchParams.get('section') ?? page.url.hash.slice(1));
	const active = $derived(
		sections.some((s) => s.key === requested) ? requested : (sections[0]?.key ?? 'household')
	);

	function select(key: string) {
		// replaceState: flipping between sections is not nine entries of history.
		void goto(`?section=${key}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

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
	/** Which category is showing its "move them to" picker, by id. */
	/**
	 * The category whose ✕ was pressed, once we know what depends on it.
	 *
	 * The count comes first and decides everything: nothing filed under it and
	 * the delete simply happens, because there is no question to ask. Only when
	 * something does depend on it is a dialog worth anybody's attention.
	 */
	let deletingLeaf = $state<{
		id: string;
		name: string;
		transactions: number;
		splits: number;
		rules: number;
	} | null>(null);
	let deleteError = $state<string | null>(null);
	let checkingLeaf = $state<string | null>(null);

	/**
	 * Reordering the categories inside a group.
	 *
	 * Two ways in, because one is not enough. Dragging is what was asked for and
	 * is what a mouse expects; the arrow keys are what makes it reachable without
	 * one, and they are not a lesser path — holding a chip and pressing ← or →
	 * is faster than dragging for a single step.
	 *
	 * A catch-all is excluded from both: it is pinned last by its flag, so
	 * letting it be picked up would promise a move the ordering will not honour.
	 */
	/**
	 * Reordering the categories inside a group.
	 *
	 * POINTER events, not HTML5 drag-and-drop. The first version used `draggable`,
	 * which does not fire on touch at all — so reordering worked on a desktop and
	 * simply did nothing on a phone or tablet. Pointer events cover mouse, touch
	 * and pen with one code path.
	 *
	 * The order also rearranges UNDER the finger rather than only on release. A
	 * drag with no feedback until you let go is a guess, and the first version
	 * made you take it.
	 *
	 * The arrow keys stay: they are how this is reachable without a pointer at
	 * all, and for a single step they are quicker than dragging.
	 */
	let dragging = $state<{ group: string; id: string } | null>(null);
	/** The order being shown while a drag is in flight, per group. */
	let liveOrder = $state<Record<string, string[]>>({});

	type Leaf = { id: string; name: string; isCatchAll?: boolean };
	type Group = { key: string; items: Leaf[] };

	function movableIds(group: Group): string[] {
		return group.items.filter((item) => !item.isCatchAll).map((item) => item.id);
	}

	/** What to render: the live order during a drag, the server's otherwise. */
	function shownItems(group: Group): Leaf[] {
		const order = liveOrder[group.key];
		if (!order) return group.items;
		const byId = new Map(group.items.map((item) => [item.id, item]));
		const moved = order.map((id) => byId.get(id)).filter((item): item is Leaf => !!item);
		// The catch-all is never in the order — it is pinned last by its flag.
		return [...moved, ...group.items.filter((item) => item.isCatchAll)];
	}

	async function commitOrder(groupKey: string, order: string[]) {
		await submitAction('?/reorderLeaves', formOf({ groupKey, order: order.join(',') }));
	}

	/** One step left or right, for the keyboard. */
	async function nudge(group: Group, id: string, delta: number) {
		const ids = movableIds(group);
		const from = ids.indexOf(id);
		const to = from + delta;
		if (from < 0 || to < 0 || to >= ids.length) return;
		ids.splice(to, 0, ...ids.splice(from, 1));
		await commitOrder(group.key, ids);
	}

	function startDrag(event: PointerEvent, group: Group, id: string) {
		// Only a primary press, and never the delete button inside the chip.
		if (!event.isPrimary) return;
		event.preventDefault();
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		dragging = { group: group.key, id };
		liveOrder = { ...liveOrder, [group.key]: movableIds(group) };
	}

	/**
	 * Rearrange under the finger.
	 *
	 * The chip beneath the pointer is found by hit-testing rather than by
	 * listening on every chip: during a pointer capture every event goes to the
	 * element that captured it, so the others never hear about it.
	 */
	function moveDrag(event: PointerEvent) {
		if (!dragging) return;
		const over = document
			.elementFromPoint(event.clientX, event.clientY)
			?.closest<HTMLElement>('[data-leaf]');
		const targetId = over?.dataset.leaf;
		if (!targetId || targetId === dragging.id) return;

		const order = [...(liveOrder[dragging.group] ?? [])];
		const from = order.indexOf(dragging.id);
		const to = order.indexOf(targetId);
		if (from < 0 || to < 0 || from === to) return;
		order.splice(to, 0, ...order.splice(from, 1));
		liveOrder = { ...liveOrder, [dragging.group]: order };
	}

	async function endDrag() {
		if (!dragging) return;
		const { group } = dragging;
		const order = liveOrder[group];
		dragging = null;
		if (order) await commitOrder(group, order);
		// Cleared after the save, so the chips do not jump back to the old order
		// for the instant between letting go and the page reloading.
		liveOrder = { ...liveOrder, [group]: undefined as unknown as string[] };
		delete liveOrder[group];
	}

	async function askToDelete(leaf: { id: string; name: string }) {
		checkingLeaf = leaf.id;
		deleteError = null;
		const body = new FormData();
		body.set('categoryId', leaf.id);
		const response = await fetch('?/countLeafDependants', {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		const counts = readDependants(await response.text());
		checkingLeaf = null;
		if (!counts) {
			deleteError = 'Could not check what is filed under that category.';
			return;
		}
		if (!counts.any) {
			// Nothing points at it, so there is nothing to decide.
			await submitAction('?/removeLeaf', formOf({ categoryId: leaf.id }));
			return;
		}
		deletingLeaf = { id: leaf.id, name: leaf.name, ...counts };
	}

	function formOf(fields: Record<string, string>): FormData {
		const body = new FormData();
		for (const [key, value] of Object.entries(fields)) body.set(key, value);
		return body;
	}

	/** The action result carries the counts; anything else means the check failed. */
	function readDependants(
		payload: string
	): { transactions: number; splits: number; rules: number; any: boolean } | null {
		try {
			const result = deserialize(payload);
			if (result.type !== 'success') return null;
			const data = result.data as { dependants?: Record<string, number | boolean> } | undefined;
			const d = data?.dependants;
			if (!d) return null;
			return {
				transactions: Number(d.transactions ?? 0),
				splits: Number(d.splits ?? 0),
				rules: Number(d.rules ?? 0),
				any: Boolean(d.any)
			};
		} catch {
			return null;
		}
	}
	const ROLE_LABELS: Record<string, string> = {
		income: 'Money in',
		expense: 'Money out',
		savings: 'Money kept'
	};
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

{#snippet chipBody(leaf: { id: string; name: string })}
	<span>{leaf.name}</span>
	<button
		type="button"
		aria-label="Delete {leaf.name}"
		disabled={checkingLeaf === leaf.id}
		onclick={() => askToDelete(leaf)}
	>
		✕
	</button>
{/snippet}

<ScreenHeader
	title="Settings"
	caption="Everything visible in Continuum is configuration, not content."
/>

<!-- One place, one component. The calendar section used to draw its own copy
     with a `.form-error` class this file has no rule for — and Svelte scopes
     styles per component, so a failed calendar connection rendered as unstyled
     body text below the form. -->
<ActionError message={form?.message ?? null} />

<div class="settings-grid">
	<!-- One section at a time. This page was ten of them stacked, which meant
	     finding the calendar meant scrolling past every module toggle, and the
	     scroll position was the only thing saying where you were. -->
	<nav class="sec-nav" aria-label="Settings sections">
		{#each sections as s (s.key)}
			<button
				type="button"
				class="sec-item"
				class:on={active === s.key}
				aria-current={active === s.key ? 'page' : undefined}
				onclick={() => select(s.key)}
			>
				<IconTile hue={s.hue} icon={s.icon} size={26} />
				<span>{s.label}</span>
			</button>
		{/each}
	</nav>
	<div class="pane">
		{#if data.isAdmin}
			<section class="section" hidden={active !== 'modules'}>
				<Eyebrow
					hue="--brand"
					icon="layers"
					label="Modules"
					caption="Everything is optional. Switch off what you do not have and it leaves the sidebar entirely."
				/>
				<div class="modules">
					{#each MODULE_KEYS as key (key)}
						{@const m = MODULES[key]}
						<form method="POST" action="?/toggleModule" use:enhance class="module-row">
							<input type="hidden" name="key" value={key} />
							<span class="emoji">{m.emoji}</span>
							<span class="mod-label">
								<span>{m.label}</span>
								<span class="note">{m.note}</span>
							</span>
							<Switch on={data.moduleToggles?.[key] ?? false} label="Toggle {m.label}" />
						</form>
					{/each}
				</div>
			</section>

			<section class="section" hidden={active !== 'currencies'}>
				<Eyebrow
					hue="--brand"
					icon="coins"
					label="Currencies"
					caption="Balances stay in their own currency everywhere. Only the totals at the top of a screen convert, at the day's rate."
				/>
				<div class="card">
					<form method="POST" action="?/setBaseCurrency" use:enhance class="currency-form">
						<Field label="Base currency">
							<select name="baseCurrency" value={data.baseCurrency}>
								{#each data.currencies as c (c)}
									<option value={c}>{currencyLabel(c)}</option>
								{/each}
							</select>
						</Field>
						<button type="submit" class="btn">Save</button>
					</form>
				</div>
				{#if data.missingRates.none.length + data.missingRates.carried.length > 0}
					<!-- Used to be a banner above every screen's title, dismissed
					     without being read. The FACT stays where a figure is approximate
					     — the sidebar's Money row carries a dot — and the reason lives
					     here, where the base currency it concerns is set. -->
					<div class="card rate-note" role="status">
						<Eyebrow hue="--yellow" icon="alert" label="Approximate exchange rates" />
						{#if data.missingRates.none.length > 0}
							<p>
								<strong class="warn">
									No rate at all is stored for {data.missingRates.none.join(', ')}, so those amounts
									are counted at face value.
								</strong>
								Check the internet connection — rates come from the Czech National Bank and refresh every
								six hours.
							</p>
						{/if}
						{#if data.missingRates.carried.length > 0}
							<p>
								{data.missingRates.carried.join(', ')} converts at the oldest rate on record, because
								the figures involved are dated before this instance's first stored fixing. That happens
								to any ledger holding history older than itself, and there is nothing to fix — the Czech
								National Bank publishes forward, so past days cannot gain a rate of their own.
							</p>
						{/if}
					</div>
				{/if}
			</section>
		{/if}

		<section class="section" hidden={active !== 'household'}>
			<Eyebrow
				hue="--brand"
				icon="people"
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
				reason={data.passkeyReason}
				worksAt={data.passkeyWorksAt}
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
			<section class="section" hidden={active !== 'backups'}>
				<div class="eyebrow-row">
					<Eyebrow
						hue="--brand"
						icon="inbox"
						label="Backups (one restorable dump plus every uploaded file)"
					/>
					<InfoHint label="How backups work">
						One restorable database dump, overwritten each run, plus every uploaded file. Point it
						at a cloud-sync folder and the copy leaves the machine by itself — the sync client keeps
						the file's version history, so overwriting the dump each time still leaves you earlier
						ones.
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
						<Field label="How often">
							<select name="cadence" value={data.backup.cadence}>
								<option value="off">Off</option>
								<option value="weekly">Weekly</option>
								<option value="monthly">Monthly</option>
							</select>
						</Field>
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
			<section class="section" hidden={active !== 'hosting'}>
				<Eyebrow
					hue="--brand"
					icon="gear"
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
						Everything on this server — people, currencies, modules, integrations — is configuration
						in your own database. Restoring elsewhere is booting a fresh instance and feeding it the
						backup dump.
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
							ledger.config.json — configuration only (name, currency, modules, backup, learned
							labels), never data or passwords
						</span>
					</div>
				</div>
			</section>
		{/if}

		{#if data.isAdmin}
			<section class="section" hidden={active !== 'calendars'} id="calendars">
				<div class="eyebrow-row">
					<Eyebrow hue="--brand" icon="calendar" label="Connected calendars" />
					<span class="eyebrow-caption">two-way sync with iCloud and other CalDAV servers</span>
				</div>

				{#if form?.created}
					<p class="calendar-notice" role="status">
						Calendar created. Press “Sync now” to fill it.
					</p>
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
								<button
									class="btn"
									type="submit"
									disabled={!account.remoteCalId || syncing !== null}
								>
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
								<Field label={field.label}>
									<input
										name={field.key}
										type={field.secret ? 'password' : field.kind === 'url' ? 'url' : 'text'}
										placeholder={field.placeholder ?? ''}
										required={field.required}
										autocomplete="off"
									/>
								</Field>
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
					<Switch on={data.calendarMarkers} label="Mark the ledger's own events" />
					<span class="r-text">
						<span class="r-label">Mark the ledger's own events</span>
						<span class="r-detail">
							Adds the module emoji and “· Continuum” to events this app writes, so they are
							tellable apart from your own in a shared calendar.
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
							Each pass is one request per connected calendar. Slower is kinder to a metered
							connection; faster is only useful while setting something up. Takes effect without a
							restart — the interval is measured against each account's own last sync.
						</span>
					</label>
					<button class="btn" type="submit">Save</button>
				</form>
			</section>

			<section class="section" hidden={active !== 'tokens'}>
				<div class="eyebrow-row">
					<Eyebrow
						hue="--brand"
						icon="bolt"
						label="API tokens (read-only access to the whole ledger)"
					/>
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

		{#if data.isAdmin}
			<section class="section" hidden={active !== 'categories'}>
				<Eyebrow
					hue="--brand"
					icon="folders"
					label="Categories"
					caption="What your spending is filed under. Nothing here is fixed — a household that does not drive can delete Transport."
				/>
				<!-- Field names are prefixed (groupLabel, groupRole, categoryName) rather
		     than the plain label/role/name they would otherwise be. This page is one
		     document holding a dozen unrelated forms, so a generic name here becomes
		     a second match for a selector aimed at the person form. -->
				<div class="card taxonomy">
					{#each data.taxonomy as group (group.key)}
						<!-- The key identifies the row: its label lives in an input, so nothing
				     in the markup otherwise says which group this is. -->
						<div class="tx-group" data-group={group.key}>
							<div class="tx-head">
								<span class="tx-dot" style:background="var({group.colorToken})"></span>
								<form method="POST" action="?/editGroup" use:enhance class="tx-edit">
									<input type="hidden" name="groupKey" value={group.key} />
									<input name="groupLabel" value={group.label} aria-label="Group name" />
									<select name="colorToken" aria-label="Colour">
										{#each data.paletteTokens as token (token)}
											<option value={token} selected={token === group.colorToken}>
												{token.replace('--series-', '')}
											</option>
										{/each}
									</select>
									<span class="tx-role">{ROLE_LABELS[group.role] ?? group.role}</span>
									<button type="submit" class="btn">Save</button>
								</form>
								<form method="POST" action="?/removeGroup" use:enhance>
									<input type="hidden" name="groupKey" value={group.key} />
									<!-- Only when empty. The categories under it point at this key, and
							     deleting it out from under them would strand them. -->
									<button type="submit" class="btn" disabled={group.items.length > 0}>
										Delete group
									</button>
								</form>
							</div>

							<div class="tx-leaves">
								{#each shownItems(group) as leaf (leaf.id)}
									{#if leaf.isCatchAll}
										<!-- Pinned last by its flag, so it offers no grip and takes no
								     focus: a chip that looks draggable and then refuses to move is
								     worse than one that never offered. -->
										<span class="tx-leaf pinned" title="Always last in this group">
											{@render chipBody(leaf)}
										</span>
									{:else}
										<span
											class="tx-leaf"
											class:dragging={dragging?.id === leaf.id}
											data-leaf={leaf.id}
											role="button"
											tabindex="0"
											aria-label="{leaf.name} — drag it, or use the arrow keys"
											onkeydown={(e) => {
												if (e.key === 'ArrowLeft') {
													e.preventDefault();
													nudge(group, leaf.id, -1);
												} else if (e.key === 'ArrowRight') {
													e.preventDefault();
													nudge(group, leaf.id, 1);
												}
											}}
										>
											<!-- The grip is the handle, not the whole chip: pressing anywhere
									     on it would make the delete button inside impossible to hit on
									     a touch screen. touch-action:none stops the browser scrolling
									     the page instead of giving us the move. -->
											<span
												class="grip"
												aria-hidden="true"
												onpointerdown={(e) => startDrag(e, group, leaf.id)}
												onpointermove={moveDrag}
												onpointerup={endDrag}
												onpointercancel={endDrag}
											>
												⠿
											</span>
											{@render chipBody(leaf)}
										</span>
									{/if}
								{/each}
								<form method="POST" action="?/addLeaf" use:enhance class="tx-add-leaf">
									<input type="hidden" name="groupKey" value={group.key} />
									<input
										name="categoryName"
										placeholder="New category…"
										aria-label="New category name"
									/>
									<!-- "Add category", not "Add": a bare verb next to a field says
							     nothing about what it adds, and this page already has an Add
							     button for people. -->
									<button type="submit" class="btn">Add category</button>
								</form>
							</div>
						</div>
					{/each}

					<form method="POST" action="?/addGroup" use:enhance class="tx-add-group">
						<input
							name="groupLabel"
							placeholder="New group, e.g. Pets"
							aria-label="New group name"
						/>
						<select name="groupRole" aria-label="Kind">
							{#each data.groupRoles as role (role)}
								<option value={role}>{ROLE_LABELS[role] ?? role}</option>
							{/each}
						</select>
						<button type="submit" class="btn">Add group</button>
						<!-- Colour is not asked for here. The palette is ranked by how well each
				     colour separates from the others, so the next one down is always the
				     best remaining choice; it can be changed above afterwards. -->
						<span class="note">It takes the next colour from the palette.</span>
					</form>
				</div>
			</section>
		{/if}

		{#if data.isAdmin}
			<section class="section" hidden={active !== 'open'}>
				<Eyebrow
					hue="--brand"
					icon="lock"
					label="Open this instance"
					caption="Sign in with no password and no passkey — for everyone, on every address."
				/>
				<div class="card open-mode" class:on={data.openMode}>
					{#if data.openMode}
						<p class="open-warning">
							<strong>This instance is open.</strong> Anyone who can reach its address can sign in as
							anyone — including you — and read every statement, salary figure, mortgage balance and tax
							statement, use the API, and export the lot. On a plain-HTTP address that is everyone on
							the network.
						</p>
						<form method="POST" action="?/disableOpenMode" use:enhance>
							<!-- No password asked for: the door is already open, so demanding a
					     credential to close it would only stop the honest. -->
							<button type="submit" class="btn btn-primary">Close it</button>
						</form>
					{:else}
						<p class="note">
							Everyone signs in with a password or a passkey. Turning this off means anyone who can
							reach the address is anyone on this instance. Existing passwords are kept, so turning
							it back on restores normal sign-in.
						</p>
						<form method="POST" action="?/enableOpenMode" use:enhance class="open-form">
							<Field label="Your password, to confirm you mean it">
								<input name="password" type="password" autocomplete="current-password" />
							</Field>
							<button type="submit" class="btn">Open the instance</button>
						</form>
					{/if}
				</div>
			</section>
		{/if}
	</div>
</div>

{#if deletingLeaf}
	<!-- Asked in a dialog rather than in the list, because the list is where the
	     other categories are and pushing them down to make room for a question
	     loses the thing being asked about. Only reached when something actually
	     depends on the category: an unused one is deleted without a word. -->
	<Modal title="Delete “{deletingLeaf.name}”?" onclose={() => (deletingLeaf = null)}>
		<form
			method="POST"
			action="?/removeLeaf"
			use:enhance={() =>
				async ({ update, result }) => {
					deleteError = messageFromActionResult(result);
					await update();
					if (shouldCloseAfterAction(result.type)) deletingLeaf = null;
				}}
			class="tx-delete"
		>
			<input type="hidden" name="categoryId" value={deletingLeaf.id} />

			<p class="tx-counts">
				{#if deletingLeaf.transactions > 0}
					<strong>{deletingLeaf.transactions}</strong>
					{deletingLeaf.transactions === 1 ? 'transaction' : 'transactions'}
				{/if}{#if deletingLeaf.splits > 0}{deletingLeaf.transactions > 0 ? ', ' : ''}<strong
						>{deletingLeaf.splits}</strong
					>
					{deletingLeaf.splits === 1
						? 'split line'
						: 'split lines'}{/if}{#if deletingLeaf.rules > 0}{deletingLeaf.transactions +
						deletingLeaf.splits >
					0
						? ' and '
						: ''}<strong>{deletingLeaf.rules}</strong>
					{deletingLeaf.rules === 1 ? 'rule' : 'rules'}{/if}
				{deletingLeaf.transactions + deletingLeaf.splits + deletingLeaf.rules === 1 ? 'is' : 'are'} filed
				under it.
			</p>

			<!-- A rule left pointing at a deleted category still matches and files
			     nothing, so the categoriser quietly stops working. That is why they
			     are named here rather than folded into the transaction count. -->
			<label class="field">
				<span>Move them all to</span>
				<select name="reassignTo" required>
					{#each data.allLeaves.filter((l) => l.id !== deletingLeaf?.id) as target (target.id)}
						<option value={target.id}>{target.name}</option>
					{/each}
				</select>
			</label>

			{#if deleteError}<p class="error">{deleteError}</p>{/if}

			<div class="tx-delete-actions">
				<button type="button" class="btn" onclick={() => (deletingLeaf = null)}>Cancel</button>
				<button type="submit" class="btn btn-primary">Move and delete</button>
			</div>
		</form>
	</Modal>
{/if}

<style>
	.settings-grid {
		display: grid;
		grid-template-columns: 200px minmax(0, 1fr);
		gap: 26px;
		align-items: start;
	}
	.sec-nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		position: sticky;
		top: 26px;
	}
	.sec-item {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		width: 100%;
		border: 0;
		background: none;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-lg);
		color: var(--fg2);
		font-family: inherit;
		font-size: var(--text-md);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur) var(--ease);
	}
	.sec-item:hover {
		background: var(--surface-2);
	}
	.sec-item.on {
		background: var(--surface-2);
		color: var(--fg1);
		font-weight: 600;
	}
	.sec-item:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
	.pane {
		display: flex;
		flex-direction: column;
		gap: 26px;
		min-width: 0;
	}

	/* Below 900 the nav becomes a scrolling row above the pane: a 200px column
	   beside a form is most of a tablet's width spent on nine words. */
	@media (max-width: 899px) {
		.settings-grid {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-8);
		}
		.sec-nav {
			position: static;
			flex-direction: row;
			gap: var(--space-3);
			overflow-x: auto;
			scrollbar-width: none;
			padding-bottom: var(--space-2);
		}
		.sec-nav::-webkit-scrollbar {
			display: none;
		}
		.sec-item {
			width: auto;
			flex: none;
			white-space: nowrap;
		}
	}

	.tx-leaf .grip {
		color: var(--fg3);
		cursor: grab;
		font-size: var(--text-sm);
		line-height: 1;
		padding: 0 var(--space-1);
		/* Without this the browser takes the gesture as a scroll and the chip never
		   moves — which is exactly how the first version failed on a phone. */
		touch-action: none;
	}
	.tx-leaf .grip:active {
		cursor: grabbing;
	}
	.tx-leaf.dragging {
		/* Lifted rather than faded: it is being carried, and the chips around it
		   are already rearranging to show where it will land. */
		background: var(--card2);
		box-shadow: var(--shadow-raise);
	}
	.tx-leaf:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
	/* A catch-all is pinned last by its flag, so it offers no grip: a chip that
	   looks draggable and then refuses to move is worse than one that never
	   offered. */
	.tx-leaf.pinned {
		opacity: 0.85;
	}

	.tx-delete {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		padding: var(--space-6) 0 0;
	}
	.tx-counts {
		margin: 0;
		color: var(--fg2);
		font-size: var(--text-md);
	}
	.tx-delete-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	.open-mode {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.open-mode.on {
		border-color: var(--yellow);
		background: var(--yellow-wash);
	}
	.open-warning {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg1);
		line-height: 1.55;
	}
	.open-form {
		display: flex;
		align-items: flex-end;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.taxonomy {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.tx-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding-top: 12px;
		border-top: 1px solid var(--bd);
	}
	.tx-head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.tx-dot {
		width: 14px;
		height: 14px;
		border-radius: var(--radius-xs);
		flex: none;
	}
	.tx-edit {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
		flex: 1;
	}
	.tx-role {
		font-size: var(--text-xs);
		color: var(--fg3);
		white-space: nowrap;
	}
	.tx-leaves {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-items: center;
		padding-left: 24px;
	}
	.tx-leaf {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		padding: 3px 6px 3px 11px;
		font-size: var(--text-sm);
	}
	.tx-leaf button {
		background: none;
		border: 0;
		color: var(--fg3);
		cursor: pointer;
		font-size: var(--text-xs);
		padding: 0 3px;
	}
	.tx-add-leaf,
	.tx-add-group {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.tx-add-group {
		padding-top: 12px;
		border-top: 1px solid var(--bd);
	}
	.calendar-notice {
		color: var(--fg2);
		font-size: var(--text-md);
	}

	.cal-account,
	.cal-connect {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.ca-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-5);
	}

	.ca-label {
		font-weight: 600;
	}

	.ca-state {
		font-size: var(--text-sm);
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
		font-size: var(--text-sm);
		color: var(--fg3);
	}

	.ca-row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	.cc-title {
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
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
		gap: var(--space-5) var(--space-7);
	}

	.marker-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-5);
	}

	.interval {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		flex: 1;
	}

	.interval-input {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		color: var(--fg3);
		font-size: var(--text-md);
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
		gap: var(--space-3);
	}
	.tn-label {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.api-token-raw {
		font-size: var(--text-md);
		word-break: break-all;
		color: var(--fg1);
	}
	.token-add {
		display: flex;
		gap: var(--space-5);
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.token-add label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
		flex: 1 1 220px;
	}
	.token-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-6);
		flex-wrap: wrap;
	}
	.tr-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.tr-label {
		font-size: var(--text-md);
		font-weight: 500;
	}
	.tr-meta {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* A grid of cards rather than eighteen rows in one: the modules are a set
	   of independent choices, and a column of rows reads as an ordered list of
	   steps. Three across on a wide monitor, two on a tablet, one on a phone. */
	.modules {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: var(--space-6);
	}
	.module-row {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-6);
		padding: var(--space-6) var(--space-7);
		background: var(--surface);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
	}
	.module-row:first-child {
		border-top: 0;
	}
	/* A 32px tile, the same shape IconTile draws — the glyph here is the
	   module's own emoji, which is data rather than an icon from the set. */
	.emoji {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 9px;
		background: var(--surface-2);
		font-size: var(--text-xl);
	}
	.mod-label {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.mod-label > span:first-child {
		font-size: var(--text-md);
	}
	.note {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.currency-form {
		display: flex;
		align-items: flex-end;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	/* Three equal password fields and a button. This used to borrow .add-form,
	   whose second column is 90px wide for a birth year — which left the
	   new-password input a third the width of its neighbours. That rule now
	   lives only in PeopleSettings, next to the form it was written for. */
	.password-form {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
		gap: var(--space-4);
		padding-top: 11px;
		border-top: 1px solid var(--bd);
	}
	.ok-note {
		margin: 8px 0 0;
		font-size: var(--text-sm);
		color: var(--green);
	}
	.prose {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg2);
		line-height: 1.55;
	}
	.stack-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.backup-form {
		display: flex;
		align-items: flex-end;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.backup-form .dest {
		flex: 1 1 320px;
	}
	.backup-status {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		flex-wrap: wrap;
	}
	.status-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-7);
	}
	.status {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.s-label {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.s-value {
		font-size: var(--text-xl);
		font-weight: 600;
	}
	.s-value.origin {
		font-size: var(--text-md);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.config-row {
		display: flex;
		align-items: center;
		gap: var(--space-6);
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
	.rate-note {
		background: var(--yellow-wash);
		border-color: color-mix(in srgb, var(--yellow) 35%, transparent);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		font-size: var(--text-md);
		line-height: 1.5;
		color: var(--fg2);
	}
	.rate-note p {
		margin: 0;
	}
	.rate-note .warn {
		display: block;
		color: var(--red);
		margin-bottom: var(--space-3);
	}
</style>
