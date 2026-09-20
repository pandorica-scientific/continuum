<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Deleting a filed statement sits behind a ⋯ menu — an always-visible
	// Delete for records touched once a year was too easy to misclick.
	import { enhance } from '$app/forms';
	import DocumentsCard from '$lib/components/DocumentsCard.svelte';
	import PersonTag from '$lib/components/PersonTag.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import { ATTACHMENT_KINDS } from '$lib/tax';
	import type { AboutDocument } from '$lib/server/documents/targets';

	interface Statement {
		id: string;
		/** Which filer this statement belongs to — the dialog needs it back. */
		personId: string;
		personName: string;
		year: number;
		country: string;
		currency: string;
		currencyCode: string;
		gross: string;
		taxPaid: string;
		ratePct: string | null;
		lines: { label: string; amount: string }[];
		/** From `documentsAbout`. */
		attachments: AboutDocument[];
		/**
		 * Which return this is — carried through untouched so the dialog opens on
		 * what was saved. Null is "nobody has said", and only a `residence` one
		 * proves where somebody lived.
		 */
		role: 'residence' | 'source' | null;
		note: string | null;
		diverges: string | null;
	}

	let {
		statements,
		countries,
		personHue,
		onedit
	}: {
		statements: Statement[];
		countries: { code: string; name: string; token: string }[];
		/** The filer's colour, assigned over the whole household — see
		 *  `personHues` in $lib/people — so it stays consistent with Salary. */
		personHue: (personId: string) => string;
		onedit: (statement: Statement) => void;
	} = $props();

	const tokenOf = $derived(new Map(countries.map((c) => [c.code, c.token])));
	const nameOf = $derived(new Map(countries.map((c) => [c.code, c.name])));

	// One open menu at a time, keyed by statement id.
	let menuOpen = $state<string | null>(null);

	$effect(() => {
		void statements;
		menuOpen = null;
	});
</script>

<div class="detail">
	{#each statements as s (s.id)}
		<div class="card statement">
			<div class="who">
				<span class="swatch" style="background: var({tokenOf.get(s.country) ?? '--series-r1'})"
				></span>
				<span class="country">{nameOf.get(s.country) ?? s.country}</span>
				<PersonTag name={s.personName} hue={personHue(s.personId)} />
			</div>

			<div class="figures">
				<span class="line">
					gross <strong class="mono">{s.gross} {s.currency}</strong>
					· tax <strong class="mono">{s.taxPaid} {s.currency}</strong>
					{#if s.ratePct !== null}
						· <span class="mono rate">{s.ratePct}%</span> effective
					{/if}
				</span>
				<span class="filed">filed in {s.currency}</span>

				<div class="attachments">
					<!-- `detachAction="detach"` only unlinks — the file stays filed on
					     the Finance shelf, so `confirmDetach` stays off. -->
					<DocumentsCard
						bare
						heading="Attachments"
						documents={s.attachments}
						target={{ id: s.id, kind: 'tax_statement', label: `${s.year} ${s.country}` }}
						emptyText="Nothing filed against this statement yet."
						detachAction="detach"
					/>

					<form
						method="POST"
						action="?/attach"
						use:enhance
						enctype="multipart/form-data"
						class="adder"
					>
						<input type="hidden" name="id" value={s.id} />
						<UploadDropzone
							name="file"
							multiple
							accept=".pdf,.png,.jpg,.jpeg,.webp"
							idleText="Drop files here, or click to browse"
							description="PDF, PNG, JPEG or WebP"
						/>
						<select name="fileKind" aria-label="What these files are">
							{#each ATTACHMENT_KINDS as k (k.key)}
								<option value={k.key}>{k.label}</option>
							{/each}
						</select>
						<button type="submit" class="btn">Attach</button>
					</form>
				</div>

				{#if s.note}<span class="note">{s.note}</span>{/if}
				{#if s.diverges}<span class="diverges">{s.diverges}</span>{/if}
				{#if s.lines.length > 0}
					<span class="lines">
						{#each s.lines as l, i (i)}
							<span>{l.label} {l.amount}</span>
						{/each}
					</span>
				{/if}
			</div>

			<div class="actions">
				<button type="button" class="btn" onclick={() => onedit(s)}>Edit</button>
				<div class="menu-wrap">
					<button
						type="button"
						class="icon"
						aria-label="More for {s.year} {s.country}"
						aria-expanded={menuOpen === `statement:${s.id}`}
						onclick={() => {
							menuOpen = menuOpen === `statement:${s.id}` ? null : `statement:${s.id}`;
						}}>⋯</button
					>
					{#if menuOpen === `statement:${s.id}`}
						<form method="POST" action="?/remove" use:enhance class="menu">
							<input type="hidden" name="id" value={s.id} />
							<button type="submit" class="menu-item danger">Delete statement</button>
						</form>
					{/if}
				</div>
			</div>
		</div>
	{/each}

	{#if statements.length > 1}
		<span class="detail-note">
			Two filings in one year is a move, not a mistake — the year total above is the only place they
			add up.
		</span>
	{/if}
</div>

<style>
	.detail {
		background: var(--bg2);
		box-shadow: inset 3px 0 0 var(--teal);
		padding: var(--space-6) var(--space-6) var(--space-6) 106px;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.statement {
		display: grid;
		grid-template-columns: 96px minmax(0, 1fr) auto;
		gap: var(--space-6);
		align-items: start;
	}
	.who {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: var(--radius-xs);
	}
	.country {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.figures {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.line {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.rate {
		color: var(--yellow);
	}
	.filed,
	.note {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.diverges {
		font-size: var(--text-sm);
		color: var(--yellow);
	}
	.lines {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.attachments {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.icon {
		background: none;
		border: 0;
		color: var(--fg3);
		cursor: pointer;
		font-size: var(--text-sm);
		padding: 2px 5px;
	}
	.icon:hover {
		color: var(--fg1);
	}
	.menu-item.danger {
		color: var(--red);
	}
	.adder {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-top: var(--space-2);
	}
	.adder :global(.dropzone) {
		flex: 1 1 210px;
		min-width: 0;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.menu-wrap {
		position: relative;
	}
	.menu {
		position: absolute;
		right: 0;
		top: 100%;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-float);
		overflow: hidden;
		z-index: 2;
	}
	.menu-item {
		display: block;
		width: 100%;
		background: none;
		border: 0;
		color: var(--fg1);
		cursor: pointer;
		padding: var(--space-4) var(--space-7);
		font-size: var(--text-sm);
		text-align: left;
		white-space: nowrap;
	}
	.menu-item:hover {
		background: var(--bg3, var(--bd));
	}
	.detail-note {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
