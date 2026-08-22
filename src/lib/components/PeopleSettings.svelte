<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { startRegistration } from '@simplewebauthn/browser';
	import { runCeremony } from '$lib/webauthn';
	import { DEFAULT_ENROLLMENT_LINK_DAYS, daysPhrase } from '$lib/password-policy';

	// Everything past the name is administrative detail, and the server sends it
	// as null to anyone who is not an administrator — so a member's copy of this
	// page cannot carry who runs the household or who has yet to enrol.
	interface PersonRow {
		id: string;
		name: string;
		initials: string;
		role: 'admin' | 'member' | null;
		birthYear: number | null;
		deactivatedAt: Date | null;
		pending: boolean;
	}

	interface PasskeyRow {
		id: string;
		label: string;
		createdAt: Date;
		lastUsedAt: Date | null;
	}

	let {
		people,
		me,
		enrollmentLink = null,
		enrollmentLinkDays = DEFAULT_ENROLLMENT_LINK_DAYS,
		passkeys = false,
		origin = '',
		reason = null,
		worksAt = null,
		myPasskeys = []
	}: {
		people: PersonRow[];
		me: { id: string; role: 'admin' | 'member' } | null;
		enrollmentLink?: string | null;
		enrollmentLinkDays?: number;
		passkeys?: boolean;
		/** The configured ORIGIN, named on screen when passkeys are unavailable. */
		origin?: string;
		/** Why they are unavailable, so the explanation can be the true one. */
		reason?: 'unconfigured' | 'insecure' | 'other-address' | null;
		/** The address they do work at, when there is one. */
		worksAt?: string | null;
		myPasskeys?: PasskeyRow[];
	} = $props();

	let adding = $state(false);
	let passkeyError = $state('');
	// Cleared when the next ceremony starts, so a stale success cannot sit above
	// a fresh failure. Without it nothing on screen distinguished "added, and you
	// may add another" from "that failed" — the button is deliberately always
	// present, since passkeys are per-device, so its staying said nothing.
	let passkeyAdded = $state('');
	let registering = $state(false);
	const isAdmin = $derived(me?.role === 'admin');

	async function addPasskey() {
		passkeyError = '';
		passkeyAdded = '';
		registering = true;
		const result = await runCeremony(
			'/auth/passkey/register/options',
			'/auth/passkey/register/verify',
			startRegistration,
			// Asked once the authenticator has already agreed, so a cancelled
			// biometric never puts a naming prompt on screen.
			() => ({ label: window.prompt('Name this passkey', 'This device') ?? 'Passkey' }),
			'Could not add that passkey.'
		);
		registering = false;
		if (result.ok) {
			passkeyAdded = 'Passkey added.';
			await invalidateAll();
		} else passkeyError = result.error;
	}

	function note(p: PersonRow): string {
		if (!p.role) return '';
		const bits: string[] = [p.role];
		if (p.birthYear) bits.push(`born ${p.birthYear}`);
		if (p.pending) bits.push('not enrolled yet');
		if (p.deactivatedAt) bits.push('deactivated');
		return bits.join(' · ');
	}
</script>

<div class="card people">
	{#each people as p (p.id)}
		{@const label = note(p)}
		<div class="person-row" class:dimmed={p.deactivatedAt}>
			<span class="avatar">{p.initials}</span>
			<span class="mod-label">
				<span>{p.name}</span>
				{#if label}<span class="note">{label}</span>{/if}
			</span>

			{#if isAdmin && p.id !== me?.id}
				<span class="row-actions">
					<!-- Not for a closed account: deactivation revoked the link they
					     had, and the server refuses to mint a replacement. -->
					{#if p.pending && !p.deactivatedAt}
						<form method="POST" action="?/reissueEnrollment" use:enhance>
							<input type="hidden" name="personId" value={p.id} />
							<button type="submit" class="btn">New link</button>
						</form>
					{/if}
					<form method="POST" action="?/changePersonRole" use:enhance>
						<input type="hidden" name="personId" value={p.id} />
						<input type="hidden" name="role" value={p.role === 'admin' ? 'member' : 'admin'} />
						<button type="submit" class="btn">
							{p.role === 'admin' ? 'Make member' : 'Make admin'}
						</button>
					</form>
					{#if p.deactivatedAt}
						<form method="POST" action="?/reactivatePerson" use:enhance>
							<input type="hidden" name="personId" value={p.id} />
							<button type="submit" class="btn">Reactivate</button>
						</form>
					{:else}
						<form method="POST" action="?/deactivatePerson" use:enhance>
							<input type="hidden" name="personId" value={p.id} />
							<button type="submit" class="btn">Deactivate</button>
						</form>
					{/if}
				</span>
			{/if}
		</div>
	{/each}

	{#if enrollmentLink}
		<p class="note">
			Send this link to the new person — it is shown once and lasts {daysPhrase(
				enrollmentLinkDays
			)}.
		</p>
		<code class="reveal">{enrollmentLink}</code>
	{/if}

	{#if isAdmin}
		{#if adding}
			<form method="POST" action="?/addPerson" use:enhance class="add-form">
				<input name="name" placeholder="Name" />
				<input name="birthYear" placeholder="Birth year" inputmode="numeric" />
				<select name="role">
					<option value="member">Member</option>
					<option value="admin">Administrator</option>
				</select>
				<button type="submit" class="btn">Add</button>
			</form>
		{:else}
			<button type="button" class="btn" onclick={() => (adding = true)}>➕ Add a person</button>
		{/if}
	{/if}
</div>

{#if passkeys}
	<div class="card people">
		{#each myPasskeys as k (k.id)}
			<div class="person-row passkey-row">
				<span class="mod-label">
					<span>{k.label}</span>
					<span class="note">
						{k.lastUsedAt
							? `last used ${new Date(k.lastUsedAt).toLocaleDateString('en')}`
							: 'never used'}
					</span>
				</span>
				<form method="POST" action="?/removePasskey" use:enhance class="row-actions">
					<input type="hidden" name="credentialId" value={k.id} />
					<button type="submit" class="btn">Remove</button>
				</form>
			</div>
		{/each}
		<!-- "Add another" once one is registered: the button stays on purpose,
		     because a passkey belongs to a device and a laptop plus a tablet needs
		     two. Reading "Add a passkey" after adding one made it look as though
		     nothing had happened. -->
		<button type="button" class="btn" onclick={addPasskey} disabled={registering}>
			{#if registering}
				Waiting for your device…
			{:else if myPasskeys.length}
				➕ Add another passkey
			{:else}
				🔑 Add a passkey
			{/if}
		</button>
		{#if passkeyAdded}<p class="note" role="status">{passkeyAdded}</p>{/if}
		{#if passkeyError}<p class="note">{passkeyError}</p>{/if}
	</div>
{:else}
	<!-- Hiding the passkey card on a plain-HTTP deployment is correct — browsers
	     refuse WebAuthn outside a secure context — but hiding it silently reads as
	     "this build has no passkeys". Say why, name the address in force, and give
	     the administrator the actual steps rather than a variable to look up. -->
	<div class="card people">
		<p class="note">
			{#if reason === 'other-address'}
				<!-- Not a misconfiguration: a passkey is bound to one address, so this
				     one is simply the wrong one to add or use it from. Saying "needs
				     HTTPS" here would be wrong and would send someone to fix a setting
				     that is already correct. -->
				Passwords are the only sign-in at this address. A passkey belongs to one address, and this instance's
				is <code>{worksAt}</code> — open that to add or use one.
			{:else}
				Passwords are the only sign-in here: passkeys need a secure address, and browsers refuse
				them over plain HTTP.
				{#if origin}
					This instance is configured as <code>{origin}</code>.
				{:else}
					This instance has no <code>ORIGIN</code> configured.
				{/if}
			{/if}
		</p>
		{#if isAdmin && reason !== 'other-address'}
			<ol class="steps note">
				<li>
					Authenticate the bundled Tailscale sidecar — <code>docker compose logs tailscale</code> prints
					a login URL to open once.
				</li>
				<li>
					Put the name it issues in <code>.env</code>:
					<code>ORIGIN=https://continuum.&lt;your-tailnet&gt;.ts.net</code>
				</li>
				<li>
					Restart with <code>docker compose up -d</code> and reopen this page at that address.
				</li>
			</ol>
			<p class="note">
				Any other route to a trusted certificate does just as well — a reverse proxy, or your own
				certificate authority. Continuum only needs <code>ORIGIN</code> to be
				<code>https://</code> and to match the address you actually browse to.
			</p>
		{:else}
			<p class="note">
				An administrator can move the household to an https address; the passkey controls then
				appear here on their own.
			</p>
		{/if}
	</div>
{/if}

<style>
	/* Mirrors the module list on the same screen: a bordered row per entry. */
	.people {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.person-row {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-6);
		padding: 11px 0;
		border-top: 1px solid var(--bd);
	}
	.person-row:first-child {
		border-top: 0;
	}
	.passkey-row {
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.person-row.dimmed {
		opacity: 0.55;
	}
	.avatar {
		width: 26px;
		height: 26px;
		border-radius: 26px;
		background: var(--card3);
		display: grid;
		place-items: center;
		font-size: var(--text-xs);
	}
	.mod-label {
		display: flex;
		flex-direction: column;
		min-width: 0;
		font-size: var(--text-md);
	}
	.note {
		color: var(--fg2);
		font-size: var(--text-sm);
	}
	/* The passkey explanation is prose, not a row: it needs the line height and
	   the breathing room the bordered rows above deliberately do without. */
	.steps {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 10px 0;
		padding-left: 18px;
		line-height: 1.5;
	}
	.steps li::marker {
		color: var(--fg3);
	}
	code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		background: var(--card2);
		border-radius: var(--radius-xs);
		padding: 1px 5px;
		/* A tailnet name or a compose command should wrap inside the card rather
		   than push it wider on a phone. */
		overflow-wrap: anywhere;
	}
	.row-actions {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.add-form {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) 90px minmax(0, 1fr) auto;
		gap: var(--space-3);
		padding-top: 11px;
	}
	/* Came along with the rule above when this list moved out of the settings
	   page. Left behind there, four columns stayed four columns on a phone and
	   the name field, the birth year, the role and the button each got about
	   ninety pixels. */
	@media (max-width: 640px) {
		.add-form {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.reveal {
		display: block;
		word-break: break-all;
		font-size: var(--text-sm);
		margin-top: 8px;
		padding: 9px 11px;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card2);
	}
</style>
