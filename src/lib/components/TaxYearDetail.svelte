<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// What a year's row opens into: the statements filed that year, and the
	// paperwork each of them brought.
	//
	// Every secondary or destructive action sits behind a ⋯ menu — the
	// statement's and each attachment's alike. Twenty-six always-visible Edit
	// and Delete buttons for records touched once a year was the old screen's
	// worst density problem, and deleting a filed statement should not be one
	// misclick away.
	//
	// The attachment row used to carry a bare ⇥ and a bare 🗑 beside a caption
	// claiming "Delete lives behind the ⋯ menu now", which was plainly untrue
	// with a bin two inches above it. One pattern, so the caption is unnecessary
	// and gone.
	import { enhance } from '$app/forms';
	import PersonTag from '$lib/components/PersonTag.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import { ATTACHMENT_KINDS } from '$lib/tax';

	interface Attachment {
		id: string;
		name: string;
		ext: string;
		file: string | null;
	}
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
		attachments: Attachment[];
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
		/**
		 * The filer's colour, assigned over the whole household rather than over
		 * the statements on screen — see `personHues` in $lib/people. A colour
		 * that meant one person here and another on Salary would be worse than
		 * no colour.
		 */
		personHue: (personId: string) => string;
		onedit: (statement: Statement) => void;
	} = $props();

	const tokenOf = $derived(new Map(countries.map((c) => [c.code, c.token])));
	const nameOf = $derived(new Map(countries.map((c) => [c.code, c.name])));

	// Two taps rather than a browser confirm(): this destroys a stored file, and
	// a native dialog blocks the page while it is open. Keyed by document id.
	let arming = $state<string | null>(null);

	// One open menu at a time across the whole detail, statements and
	// attachments together — keyed `statement:<id>` or `attachment:<id>` so the
	// two cannot collide on a shared id.
	let menuOpen = $state<string | null>(null);

	$effect(() => {
		// A delete reloads the page data; nothing should still be open after it.
		void statements;
		arming = null;
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
					{#each s.attachments as a (a.id)}
						<div class="attachment">
							<span class="mono ext">{a.ext}</span>
							{#if a.file}
								<a href="/files/{a.file}" target="_blank" rel="noopener" class="a-name">{a.name}</a>
							{:else}
								<span class="a-name">{a.name}</span>
							{/if}

							<div class="menu-wrap">
								<button
									type="button"
									class="icon"
									aria-label="More for {a.name}"
									aria-expanded={menuOpen === `attachment:${a.id}`}
									onclick={() => {
										arming = null;
										menuOpen = menuOpen === `attachment:${a.id}` ? null : `attachment:${a.id}`;
									}}>⋯</button
								>
								{#if menuOpen === `attachment:${a.id}`}
									<div class="menu">
										<form method="POST" action="?/detach" use:enhance>
											<input type="hidden" name="id" value={s.id} />
											<input type="hidden" name="documentId" value={a.id} />
											<button type="submit" class="menu-item">Detach — keeps the file</button>
										</form>
										{#if arming === a.id}
											<form method="POST" action="?/deleteAttachment" use:enhance>
												<input type="hidden" name="documentId" value={a.id} />
												<button type="submit" class="menu-item danger">
													Delete the document and its file?
												</button>
											</form>
										{:else}
											<!-- Armed in place rather than fired on the first click: this
											     destroys a stored file, and a menu item is an easier
											     misclick than a button was. -->
											<button
												type="button"
												class="menu-item danger"
												onclick={() => (arming = a.id)}
											>
												Delete document and file
											</button>
										{/if}
									</div>
								{/if}
							</div>
						</div>
					{/each}

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
							arming = null;
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
		gap: var(--space-2);
	}
	.attachment {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.ext {
		font-size: var(--text-2xs);
		letter-spacing: 0.04em;
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: 5px;
		padding: 2px 5px;
		flex: none;
	}
	.a-name {
		font-size: var(--text-sm);
		color: var(--fg1);
		min-width: 0;
		overflow-wrap: anywhere;
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
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
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
		padding: 8px 14px;
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
