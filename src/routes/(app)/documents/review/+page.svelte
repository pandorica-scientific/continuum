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
	import Icon from '$lib/components/Icon.svelte';
	import TagField from '$lib/components/TagField.svelte';
	import { documentFileHref } from '$lib/ui/file-viewer';
	import { ALL_TYPES, EXPIRY_VERBS, EXPIRY_VERB_MEANINGS, typeOptionsFor } from '$lib/documents';
	import { groupAboutOptions, typeLabels } from '$lib/documents-view';
	import {
		counterLabel,
		currentId,
		fileAndNext,
		keptFields,
		proposeType,
		setField,
		skip,
		startSession,
		suggestedFields,
		type ReviewSession
	} from '$lib/inbox-review';

	let { data, form } = $props();

	/**
	 * What a filing leaves behind for the next document.
	 *
	 * The queue itself comes from the server on every load — a document filed in
	 * another tab is simply no longer offered — but the shelf and type carried
	 * forward must not: rebuilding the whole session from `data.waiting` after
	 * each filing reset them, so "kept" could never appear on the second
	 * document of a folder import, which is the case it exists for.
	 */
	let carried = $state<Pick<ReviewSession, 'sticky' | 'kept' | 'suggested'>>({
		sticky: {},
		kept: [],
		suggested: []
	});

	// Widening is remembered for the session: somebody who needed all seventeen
	// once usually needs them again on the next document.
	let allTypes = $state(false);

	/** What this household calls each type: the built-ins, plus its own. */
	const labels = $derived(typeLabels(data.documentTypes));

	const typeOptions = $derived.by(() => {
		const shelfKey = session.sticky.shelf ?? data.shelves[0]?.key;
		const offered = shelfKey ? (data.shelfTypes[shelfKey] ?? []) : [];
		return typeOptionsFor(offered, session.sticky.type, labels, allTypes);
	});

	/** Keep only the three fields that outlive a load; the queue is the server's. */
	function remember(next: ReviewSession) {
		carried = { sticky: next.sticky, kept: next.kept, suggested: next.suggested };
	}

	// The queue is whatever is in the Inbox now; everything else is carried.
	// Writable because Skip advances it between loads.
	let session = $derived<ReviewSession>({
		...startSession(data.waiting.map((d) => d.id)),
		sticky: carried.sticky,
		kept: carried.kept,
		suggested: carried.suggested
	});

	const current = $derived(data.waiting.find((d) => d.id === currentId(session)) ?? null);
	const kept = $derived(keptFields(session));
	const suggested = $derived(suggestedFields(session));
	let confirmingDelete = $state(false);
	$effect(() => {
		void current?.id;
		confirmingDelete = false;
	});
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
			use:enhance={({ formData }) => {
				// Read off the form rather than off `session.sticky`: what carries
				// forward has to be what was filed, and the two differ the moment
				// somebody changes a field without the change reaching state.
				const filed = {
					shelfKey: String(formData.get('shelf') ?? ''),
					type: String(formData.get('type') ?? '')
				};
				return async ({ result, update }) => {
					await update({ reset: false });
					// Only a filing that happened advances anything. A refusal — a
					// document somebody else deleted, a shelf that has gone — leaves
					// the reviewer on the document they were looking at.
					if (result.type === 'success') remember(fileAndNext(session, filed));
					await invalidateAll();
				};
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
					onchange={(e) => {
						// The shelf knows what it holds, so picking one answers the next
						// question too — unless that question already has an answer
						// somebody gave, which a proposal never overwrites.
						const key = e.currentTarget.value;
						// The shelf's own list, as the household has it — not the
						// registry's, which is only where that list started.
						remember(proposeType(setField(session, 'shelf', key), data.shelfTypes[key]?.[0]));
					}}
				>
					{#each data.shelves as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
				</select>
			</label>

			<label>
				<span class="eyebrow">
					Type
					{#if kept.includes('type')}
						<span class="kept">kept</span>
					{:else if suggested.includes('type')}
						<!-- A different claim from `kept`, in the same slot: one says you
						     chose this before, the other says the shelf expects it. -->
						<span class="kept">suggested</span>
					{/if}
				</span>
				<select
					name="type"
					value={session.sticky.type ?? 'other'}
					onchange={(e) => {
						// "Show all types" is a view control wearing an option's clothes:
						// it widens the list rather than choosing anything, so the type
						// that was selected stays selected.
						if (e.currentTarget.value === ALL_TYPES) {
							allTypes = true;
							e.currentTarget.value = session.sticky.type ?? 'other';
							return;
						}
						remember(setField(session, 'type', e.currentTarget.value));
					}}
				>
					{#each typeOptions as [code, label] (code)}
						<option value={code}>{label}</option>
					{/each}
					{#if !allTypes && typeOptions.length < Object.keys(labels).length}
						<option value={ALL_TYPES}>Show all types…</option>
					{/if}
				</select>
			</label>

			<div class="field">
				<span class="eyebrow">About</span>
				<div class="about">
					<!-- The registry's groups, in the registry's order. The three
					     hand-written ones this replaces meant a reviewer could file a
					     lease against the flat but never against the tenancy, and a
					     mortgage statement against nobody at all — with nothing on
					     screen to say a kind was missing. -->
					{#each groupAboutOptions(data.targets) as group (group.label)}
						<div class="about-group">
							<span class="mono about-kind">{group.label}</span>
							<div class="chips">
								{#each group.options as target (target.id)}
									<label class="pick-chip">
										<input type="checkbox" name="linkIds" value={target.id} />
										<span>{target.name}</span>
									</label>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div class="field expiry">
				<span class="eyebrow">Expiry</span>
				<select name="expiryVerb">
					{#each EXPIRY_VERBS as verb (verb)}<option value={verb}
							>{verb} — {EXPIRY_VERB_MEANINGS[verb]}</option
						>{/each}
				</select>
				<!-- Native date input, never a text mask. -->
				<input type="date" name="expiresOn" />
			</div>

			<div class="field">
				<span class="eyebrow">Tags</span>
				<TagField known={data.knownTags} />
			</div>

			<label><span class="eyebrow">Note</span><textarea name="note"></textarea></label>

			{#if data.isAdmin}
				<!-- Its own bordered row rather than one checkbox among the fields:
				     this is the one decision on the form that changes who can see the
				     document, and it should not be ticked by momentum. -->
				<label class="restricted">
					<input type="checkbox" name="sensitivity" value="restricted" />
					<span class="lock"><Icon name="lock" size={15} /></span>
					<span class="restricted-text">
						<span class="restricted-title">Restricted — admins only</span>
						<span class="quiet"
							>Absent for household members: no row, no search hit, no calendar event.</span
						>
					</span>
				</label>
			{/if}

			<div class="foot">
				<!-- Two taps, and it leaves the flow only for this document: a photo
				     of the floor should not have to be filed to be got rid of. -->
				{#if confirmingDelete}
					<button type="submit" class="btn danger" formaction="?/remove">Delete for good</button>
				{:else}
					<button type="button" class="btn ghost-danger" onclick={() => (confirmingDelete = true)}>
						Delete
					</button>
				{/if}
				<button type="button" class="btn skip" onclick={() => (session = skip(session))}>
					Skip
				</button>
				<!-- No `onclick`. Advancing the queue here moved the document out of
				     `current` before the browser had dispatched the submit, which
				     unmounted the form it was submitting: the screen said "Inbox is
				     clear" and the server was never asked to file anything. The
				     queue moves on when the filing comes back, below. -->
				<button type="submit" class="btn btn-primary file">File &amp; next →</button>
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
	.about {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		/* Nine kinds instead of three: a household with two hundred contacts must
		   not push File & next off the bottom of the form. The chips scroll. */
		max-height: 224px;
		overflow-y: auto;
	}
	.about-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.about-kind {
		font-size: var(--text-2xs);
		color: var(--fg3);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.pick-chip {
		position: relative;
		display: inline-flex;
		flex-direction: row;
		align-items: center;
		height: 28px;
		padding: 0 var(--space-6);
		border: 1px solid var(--bd);
		border-radius: var(--radius-chip);
		background: var(--card);
		color: var(--fg2);
		font-size: var(--text-sm);
		cursor: pointer;
		white-space: nowrap;
	}
	.pick-chip input {
		position: absolute;
		inset: 0;
		opacity: 0;
		margin: 0;
		height: auto;
		padding: 0;
		cursor: pointer;
	}
	.pick-chip:hover {
		background: var(--card2);
	}
	.pick-chip:has(input:checked) {
		background: var(--card3);
		border-color: var(--bd2);
		color: var(--fg1);
	}
	/* `.fields label` above lays every field out as a column; this one is a row
	   and needs the specificity to say so. */
	.fields label.restricted {
		flex-direction: row;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-5) var(--space-6);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card2);
		cursor: pointer;
	}
	.restricted input {
		height: auto;
		width: 16px;
		flex: none;
	}
	.restricted .lock {
		color: var(--fg3);
		display: inline-flex;
		flex: none;
	}
	.restricted-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.restricted-title {
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--fg1);
	}
	.danger,
	.ghost-danger {
		border-color: var(--red);
		color: var(--red);
		flex: none;
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
