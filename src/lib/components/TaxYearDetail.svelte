<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// What a year's row opens into: the statements filed that year, and the
	// paperwork each of them brought.
	//
	// Delete for a statement sits behind a ⋯ menu rather than a permanent
	// button. Twenty-six always-visible Edit and Delete buttons for records
	// touched once a year was the old screen's worst density problem, and
	// deleting a filed tax statement should not be one misclick away.
	import { enhance } from '$app/forms';
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
		onedit
	}: {
		statements: Statement[];
		countries: { code: string; name: string; token: string }[];
		onedit: (statement: Statement) => void;
	} = $props();

	const tokenOf = $derived(new Map(countries.map((c) => [c.code, c.token])));
	const nameOf = $derived(new Map(countries.map((c) => [c.code, c.name])));

	// Two taps rather than a browser confirm(): this destroys a stored file, and
	// a native dialog blocks the page while it is open. Keyed by document id.
	let arming = $state<string | null>(null);
	$effect(() => {
		// A delete reloads the page data; nothing should still be armed after it.
		void statements;
		arming = null;
	});

	let menuOpen = $state<string | null>(null);
</script>

<div class="detail">
	{#each statements as s (s.id)}
		<div class="card statement">
			<div class="who">
				<span class="swatch" style="background: var({tokenOf.get(s.country) ?? '--series-r1'})"
				></span>
				<span class="country">{nameOf.get(s.country) ?? s.country}</span>
				<span class="person">{s.personName}</span>
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
							<form method="POST" action="?/detach" use:enhance class="inline">
								<input type="hidden" name="id" value={s.id} />
								<input type="hidden" name="documentId" value={a.id} />
								<button type="submit" class="icon" title="Detach — keeps the document">⇥</button>
							</form>
							{#if arming === a.id}
								<form method="POST" action="?/deleteAttachment" use:enhance class="inline">
									<input type="hidden" name="documentId" value={a.id} />
									<button type="submit" class="icon danger">Delete?</button>
								</form>
							{:else}
								<button
									type="button"
									class="icon"
									title="Delete the document and its file"
									onclick={() => (arming = a.id)}
									aria-label="Delete {a.name}">🗑</button
								>
							{/if}
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
						<input type="file" name="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" />
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
						aria-expanded={menuOpen === s.id}
						onclick={() => (menuOpen = menuOpen === s.id ? null : s.id)}>⋯</button
					>
					{#if menuOpen === s.id}
						<form method="POST" action="?/remove" use:enhance class="menu">
							<input type="hidden" name="id" value={s.id} />
							<button type="submit" class="menu-item danger">Delete statement</button>
						</form>
					{/if}
				</div>
			</div>
		</div>
	{/each}

	<span class="detail-note">
		{statements.length > 1
			? 'Two filings in one year is a move, not a mistake — the year total above is the only place they add up.'
			: 'Delete lives behind the ⋯ menu now; ⇥ detaches a document without deleting it.'}
	</span>
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
	.person {
		font-size: var(--text-xs);
		color: var(--fg3);
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
	.inline {
		display: contents;
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
	.icon.danger,
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
	.adder input[type='file'] {
		font-size: var(--text-xs);
		max-width: 210px;
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
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
		z-index: 2;
	}
	.menu-item {
		background: none;
		border: 0;
		cursor: pointer;
		padding: 8px 14px;
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.detail-note {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
