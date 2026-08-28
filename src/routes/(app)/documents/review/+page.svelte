<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	//
	// Inbox review at email-triage cadence: preview left, fields right, Skip or
	// File & next. No wizard, no progress screen — the next document replaces
	// this one immediately.
	//
	// Everything about which document is in front of you lives in
	// `$lib/inbox-review`, because "a lap of skipping changes nothing" is a
	// promise that has to be testable.
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { documentFileHref } from '$lib/ui/file-viewer';
	import { EXPIRY_VERBS } from '$lib/documents';
	import { TYPE_LABELS } from '$lib/documents-view';
	import {
		counterLabel,
		currentId,
		fileAndNext,
		keptFields,
		setField,
		skip,
		startSession,
		type ReviewSession
	} from '$lib/inbox-review';

	let { data, form } = $props();

	// A fresh load is a fresh session: the queue is whatever is in the Inbox now,
	// and a document filed from another tab is simply no longer offered. Writable
	// because Skip and File & next advance it between loads.
	let session = $derived<ReviewSession>(startSession(data.waiting.map((d) => d.id)));

	const current = $derived(data.waiting.find((d) => d.id === currentId(session)) ?? null);
	const kept = $derived(keptFields(session));
</script>

<!-- Enter files (the submit button owns it); Escape leaves. The hint on screen
     says both, rather than a tooltip nobody opens. -->
<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') goto('/documents');
	}}
/>

<ScreenHeader
	title="Review inbox"
	caption="One at a time. Everything is optional — Skip files nothing and deletes nothing."
/>

{#if form?.message}
	<div class="error" role="alert">{form.message}</div>
{/if}

{#if !current || session.done}
	<!-- The one place in this pass where a semantic hue carries a mood. It is a
	     surface rather than a pill, so the traffic-light contract still holds. -->
	<div class="clear">
		<p class="clear-title">Inbox is clear.</p>
		<p class="quiet">
			{session.skipped.length > 0
				? `${session.skipped.length} skipped — they are still in the Inbox.`
				: 'Nothing is waiting to be filed.'}
		</p>
		<a class="btn" href="/documents">Back to documents</a>
	</div>
{:else}
	<section class="panes">
		<div class="preview">
			{#if current.storedName}
				<iframe title={current.name} src={documentFileHref(current.id)} data-file-ext={current.ext}
				></iframe>
			{:else}
				<p class="quiet">No file attached</p>
			{/if}
		</div>

		<form
			class="fields"
			method="POST"
			action="?/file"
			use:enhance={() =>
				async ({ update }) => {
					await update({ reset: false });
					await invalidateAll();
				}}
		>
			<input type="hidden" name="id" value={current.id} />

			<label>
				<span class="eyebrow">Name</span>
				<input name="name" value={current.name} />
			</label>

			<label>
				<span class="eyebrow">
					Shelf {#if kept.includes('shelf')}<span class="kept">kept</span>{/if}
				</span>
				<select
					name="shelf"
					value={session.sticky.shelf ?? data.shelves[0]?.key}
					onchange={(e) => (session = setField(session, 'shelf', e.currentTarget.value))}
				>
					{#each data.shelves as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
				</select>
			</label>

			<label>
				<span class="eyebrow">
					Type {#if kept.includes('type')}<span class="kept">kept</span>{/if}
				</span>
				<select
					name="type"
					value={session.sticky.type ?? 'other'}
					onchange={(e) => (session = setField(session, 'type', e.currentTarget.value))}
				>
					{#each Object.entries(TYPE_LABELS) as [code, label] (code)}
						<option value={code}>{label}</option>
					{/each}
				</select>
			</label>

			<div class="field">
				<span class="eyebrow">About</span>
				<div class="checks">
					{#each data.targets as target (target.id)}
						<label class="check">
							<input type="checkbox" name="linkIds" value={target.id} />
							{target.name}
						</label>
					{/each}
				</div>
			</div>

			<div class="field expiry">
				<span class="eyebrow">Expiry</span>
				<select name="expiryVerb">
					{#each EXPIRY_VERBS as verb (verb)}<option value={verb}>{verb}</option>{/each}
				</select>
				<!-- Native date input, never a text mask. -->
				<input type="date" name="expiresOn" />
			</div>

			<label><span class="eyebrow">Note</span><textarea name="note"></textarea></label>

			{#if data.isAdmin}
				<label class="check">
					<input type="checkbox" name="sensitivity" value="restricted" />
					Restricted — admins only
				</label>
			{/if}

			<div class="foot">
				<button type="button" class="btn skip" onclick={() => (session = skip(session))}>
					Skip
				</button>
				<button
					type="submit"
					class="btn btn-primary file"
					onclick={() => (session = fileAndNext(session, {}))}
				>
					File &amp; next →
				</button>
			</div>
			<div class="hints">
				<span class="mono counter">{counterLabel(session)}</span>
				<span class="mono hint">Enter to file · Esc to leave</span>
			</div>
		</form>
	</section>
{/if}

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.clear {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-5);
		border: 1px solid var(--green);
		background: var(--green-wash);
		border-radius: var(--radius-lg);
		padding: var(--space-8);
	}
	.clear-title {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
	}
	.panes {
		display: grid;
		grid-template-columns: 58fr 42fr;
		gap: 0;
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--card);
		overflow: hidden;
		min-height: 60vh;
	}
	.preview {
		border-right: 1px solid var(--bd);
		background: var(--card2);
		display: flex;
		align-items: stretch;
		justify-content: center;
		padding: var(--space-5);
	}
	.preview iframe {
		width: 100%;
		min-height: 60vh;
		border: 0;
		background: var(--card);
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-7);
		min-width: 0;
	}
	.fields label,
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.expiry {
		flex-direction: row;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
	}
	.fields input,
	.fields select,
	.fields textarea {
		height: var(--control-h);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--fg1);
		padding: 0 10px;
		font-size: var(--text-md);
	}
	.fields textarea {
		height: auto;
		min-height: calc(var(--control-h) * 2);
		padding: 8px 10px;
		font-family: inherit;
	}
	.kept {
		margin-left: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg3);
		text-transform: none;
		letter-spacing: 0;
	}
	.checks {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}
	.check {
		flex-direction: row;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		margin-top: auto;
	}
	.skip {
		flex: none;
	}
	.file {
		flex: 1;
	}
	.hints {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.counter,
	.hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
		margin: 0;
	}

	@media (max-width: 900px) {
		.panes {
			grid-template-columns: minmax(0, 1fr);
		}
		.preview {
			border-right: 0;
			border-bottom: 1px solid var(--bd);
		}
	}
</style>
