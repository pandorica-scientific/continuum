<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
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

	let {
		people,
		me,
		enrollmentLink = null,
		enrollmentLinkDays = DEFAULT_ENROLLMENT_LINK_DAYS
	}: {
		people: PersonRow[];
		me: { id: string; role: 'admin' | 'member' } | null;
		enrollmentLink?: string | null;
		enrollmentLinkDays?: number;
	} = $props();

	let adding = $state(false);
	const isAdmin = $derived(me?.role === 'admin');

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
	code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		background: var(--card2);
		border-radius: var(--radius-xs);
		padding: 1px 5px;
		/* A long address or a compose command should wrap inside the card rather
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
