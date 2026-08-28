<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	//
	// A very good filing cabinet with excellent search — not a document
	// management system. One rail, one list, one document per row, and an
	// inspector that opens beside the list rather than over it.
	//
	// Every decision worth testing lives in `$lib/documents-view`, because there
	// is no browser suite in this repository and anything automation must hold
	// has to be reachable without a page.
	import { untrack } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import SnippetMark from '$lib/components/SnippetMark.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import { documentFileHref } from '$lib/ui/file-viewer';
	import { EXPIRY_VERBS } from '$lib/documents';
	import {
		expiryTreatment,
		groupDocuments,
		matchLabel,
		splitSnippet,
		sortDocuments,
		subLine,
		typeLabel,
		TYPE_LABELS,
		type GroupKey,
		type SortKey
	} from '$lib/documents-view';

	let { data, form } = $props();

	let query = $state(untrack(() => data.query));
	let capturing = $state(untrack(() => data.prefill.open));
	let editing = $state(false);
	let selection = $state<string[]>([]);
	let confirmingDelete = $state(false);
	let replacing = $state(false);

	$effect(() => {
		// A navigation is what carries new data in; nothing stays armed across it.
		void data.rows;
		confirmingDelete = false;
		selection = [];
	});
	$effect(() => {
		// The inspector opens read-only, whichever document it opens on.
		void data.selected?.id;
		editing = false;
		replacing = false;
	});

	const today = new Date().toISOString().slice(0, 10);

	function navigate(next: Record<string, string | null>) {
		const params = new SvelteURLSearchParams(window.location.search);
		for (const [key, value] of Object.entries(next)) {
			if (value === null || value === '') params.delete(key);
			else params.set(key, value);
		}
		// Opening a different document must not keep the last one's scroll
		// position halfway down the list.
		goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	const groups = $derived(
		groupDocuments(sortDocuments(data.rows, data.sort as SortKey), data.group as GroupKey, today)
	);
	const shelfLabel = $derived(
		data.shelves.find((s) => s.key === data.shelf)?.label ?? 'Everything'
	);
	const captureShelf = $derived(data.prefill.shelf || 'inbox');
	const captureShelfLabel = $derived(
		data.shelves.find((s) => s.key === captureShelf)?.label ?? 'Inbox'
	);

	const toggleSelected = (id: string) =>
		(selection = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);
</script>

<ScreenHeader
	title="Documents"
	caption="One archive for the household — filed by shelf, found by anything you remember."
/>

{#if form?.message}
	<div class="error" role="alert">{form.message}</div>
{/if}

{#if form?.ok && form?.addedId}
	<div class="ack">
		<Pill hue="green">Added to {form.addedShelf === 'inbox' ? 'Inbox' : form.addedShelf}</Pill>
		<button type="button" class="link" onclick={() => navigate({ doc: form.addedId, add: null })}>
			File it now
		</button>
	</div>
{/if}

<section class="toolbar">
	<div class="search">
		<span class="search-icon"><Icon name="search" size={16} /></span>
		<input
			type="search"
			bind:value={query}
			placeholder="Search documents and their contents…"
			onkeydown={(e) => e.key === 'Enter' && navigate({ q: query, doc: null })}
			aria-label="Search documents"
		/>
	</div>

	<span class="eyebrow">Group</span>
	<Segmented
		options={[
			{ value: 'type', label: 'Type' },
			{ value: 'entity', label: 'Entity' },
			{ value: 'year', label: 'Year' },
			{ value: 'expiry', label: 'Expiry' },
			{ value: 'none', label: 'None' }
		]}
		value={data.group}
		onchange={(value) => navigate({ group: value === 'type' ? null : value })}
	/>

	<!-- Group is not sort. Two questions, two controls. -->
	<select
		class="sort"
		aria-label="Sort documents"
		value={data.sort}
		onchange={(e) =>
			navigate({ sort: e.currentTarget.value === 'newest' ? null : e.currentTarget.value })}
	>
		<option value="newest">Newest first</option>
		<option value="oldest">Oldest first</option>
		<option value="name">Name A–Z</option>
		<option value="expiry">Expiry soonest</option>
	</select>

	<button type="button" class="btn btn-primary add" onclick={() => (capturing = !capturing)}>
		+ Add document
	</button>
</section>

{#if capturing}
	<form
		class="capture"
		method="POST"
		action="?/addDocument"
		enctype="multipart/form-data"
		use:enhance={() =>
			async ({ update }) => {
				await update();
				capturing = false;
			}}
	>
		<!-- Capture asks nothing. A file, a generated name, the Inbox — filing is
		     a separate decision made later, or never. -->
		<input type="hidden" name="shelf" value={captureShelf} />
		{#if data.prefill.personId}<input
				type="hidden"
				name="personIds"
				value={data.prefill.personId}
			/>{/if}
		{#if data.prefill.propertyId}<input
				type="hidden"
				name="propertyIds"
				value={data.prefill.propertyId}
			/>{/if}
		<UploadDropzone
			name="file"
			idleText="Drop a file here, or click to browse"
			description="PDF, images, text and spreadsheets"
		/>
		<div class="capture-foot">
			<span class="quiet">
				It goes to {captureShelfLabel} with the file's own name. Nothing else is asked of you.
			</span>
			<button type="submit" class="btn btn-primary">Add</button>
			<button type="button" class="btn" onclick={() => (capturing = false)}>Cancel</button>
		</div>
	</form>
{/if}

<section class="layout" class:with-inspector={data.selected}>
	<nav class="rail" aria-label="Shelves">
		{#each data.shelves.filter((s) => s.key === 'all' || s.key === 'inbox') as s (s.key)}
			<button
				type="button"
				class="rail-item"
				class:active={data.shelf === s.key}
				onclick={() => navigate({ shelf: s.key === 'all' ? null : s.key, doc: null })}
			>
				<span class="rail-label">{s.label}</span>
				<!-- Amber only when there is something waiting: work, not an error. -->
				<span class="mono rail-count" class:waiting={s.key === 'inbox' && s.count > 0}>
					{s.count}
				</span>
			</button>
		{/each}

		<div class="rail-divider"></div>

		<div class="rail-shelves">
			{#each data.shelves.filter((s) => s.key !== 'all' && s.key !== 'inbox') as s (s.key)}
				<button
					type="button"
					class="rail-item"
					class:active={data.shelf === s.key}
					onclick={() => navigate({ shelf: s.key, doc: null })}
				>
					<span class="rail-label">{s.label}</span>
					<span class="mono rail-count">{s.count}</span>
				</button>
			{/each}
		</div>

		<div class="rail-divider"></div>

		<a class="rail-item manage" href="/documents/settings">
			<span class="rail-label">Manage shelves</span>
		</a>
	</nav>

	<div class="area">
		{#if data.inboxCount > 0 && data.shelf !== 'inbox'}
			<div class="strip">
				<Pill hue="yellow">{data.inboxCount} in Inbox</Pill>
				<span class="strip-text">
					{data.inboxCount}
					{data.inboxCount === 1 ? 'document is' : 'documents are'} waiting in Inbox
				</span>
				<a class="btn strip-act" href="/documents/review">Review inbox →</a>
			</div>
		{/if}

		{#if data.archivedHidden > 0 || data.includeArchived}
			<div class="archive-line">
				<span class="quiet">
					Active subjects · <span class="mono">{data.archivedHidden}</span>
					{data.archivedHidden === 1 ? 'document' : 'documents'} hidden from archived subjects
				</span>
				<button
					type="button"
					class="btn small"
					class:active={data.includeArchived}
					onclick={() => navigate({ archived: data.includeArchived ? null : '1' })}
				>
					{data.includeArchived ? 'Hide archived' : 'Include archived subjects'}
				</button>
			</div>
		{/if}

		{#if data.tags.length}
			<div class="tag-chips">
				{#each data.tags as t (t.name)}
					<button
						type="button"
						class="tag-chip"
						class:active={t.active}
						onclick={() => navigate({ tag: t.active ? null : t.name })}
					>
						{t.name} <span class="mono t-count">{t.count}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if selection.length > 0}
			<form class="bulk" method="POST" action="?/bulkUpdate" use:enhance>
				{#each selection as id (id)}<input type="hidden" name="ids" value={id} />{/each}
				<span class="mono">{selection.length} selected</span>
				<select name="shelf" aria-label="Move to shelf">
					<option value="">Shelf…</option>
					{#each data.shelves.filter((s) => s.key !== 'all') as s (s.key)}
						<option value={s.key}>{s.label}</option>
					{/each}
				</select>
				<select name="type" aria-label="Set type">
					<option value="">Type…</option>
					{#each Object.entries(TYPE_LABELS) as [code, label] (code)}
						<option value={code}>{label}</option>
					{/each}
				</select>
				<input name="tags" placeholder="Add tags, comma separated" />
				{#if data.isAdmin}
					<select name="sensitivity" aria-label="Set visibility">
						<option value="">Visibility…</option>
						<option value="normal">Everyone in the household</option>
						<option value="restricted">Admins only</option>
					</select>
				{/if}
				<button type="submit" class="btn btn-primary">Apply</button>
				<button type="button" class="btn" onclick={() => (selection = [])}>Done</button>
			</form>
		{/if}

		{#if data.rows.length === 0}
			<div class="empty">
				{#if data.query}
					<!-- The honesty states. What was NOT searched is as important as
					     what was, and saying nothing is what makes a search feel broken. -->
					<p class="empty-title">
						No documents match “{data.query}”. Try fewer words or remove a filter.
					</p>
					{#if data.honesty?.pending}
						<p class="quiet">
							No match yet. <span class="mono">{data.honesty.pending}</span> documents are still being
							prepared for content search.
						</p>
					{/if}
					{#if data.honesty?.notSearchable}
						<p class="quiet">
							<span class="mono">{data.honesty.notSearchable}</span> documents don't have searchable contents.
						</p>
					{/if}
					{#if data.honesty?.archivedOnly}
						<p class="quiet">
							<span class="mono">{data.honesty.archivedOnly}</span>
							{data.honesty.archivedOnly === 1 ? 'match belongs' : 'matches belong'} only to archived
							subjects.
							<button type="button" class="link" onclick={() => navigate({ archived: '1' })}>
								Show archived matches
							</button>
						</p>
					{/if}
				{:else if data.total === 0 && data.shelf === 'all'}
					<p class="empty-title">No documents yet.</p>
					<p class="quiet">
						Drop files here, or click to browse. A name is generated and they go to the Inbox —
						nothing else is asked of you.
					</p>
					<button type="button" class="btn btn-primary" onclick={() => (capturing = true)}>
						+ Add document
					</button>
				{:else}
					<p class="empty-title">Nothing on {shelfLabel} yet.</p>
					<p class="quiet">
						Drop a file anywhere on this screen and it lands in the Inbox — you can move it here
						later.
					</p>
					<button type="button" class="btn btn-primary" onclick={() => (capturing = true)}>
						+ Add document
					</button>
				{/if}
			</div>
		{:else}
			{#each groups as g (g.key)}
				<div class="group">
					{#if g.label}
						<div class="group-head">
							<span class="group-label">{g.label}</span>
							<span class="mono group-count">{g.items.length}</span>
						</div>
					{/if}
					{#each g.items as d (d.id)}
						{@const expiry = expiryTreatment(d, d.subjectArchived, today, 'wide')}
						<div class="row" class:selected={data.selected?.id === d.id}>
							<input
								type="checkbox"
								class="pick"
								aria-label="Select {d.name}"
								checked={selection.includes(d.id)}
								onchange={() => toggleSelected(d.id)}
							/>
							<button
								type="button"
								class="row-main"
								onclick={() => navigate({ doc: d.id })}
								aria-label="Open {d.name}"
							>
								<span class="mono ext">{d.ext}</span>
								<span class="names">
									<span class="row-name">
										{d.name}
										{#if d.restricted}
											<!-- Quiet, and admins only. Restricted is an access
											     state, not a warning: no tint, no pill, never red. -->
											<span class="lock"><Icon name="lock" size={13} label="Restricted" /></span>
										{/if}
										{#if d.subjectArchived}
											<span class="chip">Archived subject</span>
										{/if}
									</span>
									<span class="sub">{subLine(d)}</span>
									{#if d.match?.snippet}
										{@const parts = splitSnippet(d.match.snippet, data.query)}
										<span class="snippet">
											{#if parts}
												{parts.before}<SnippetMark>{parts.match}</SnippetMark>{parts.after}
											{:else}
												{d.match.snippet}
											{/if}
										</span>
									{/if}
									{#if d.match && matchLabel(d.match.matchedIn)}
										<span class="match-label">
											{matchLabel(d.match.matchedIn)}{d.match.pageNo
												? ` · page ${d.match.pageNo}`
												: ''}
										</span>
									{/if}
								</span>
								<span class="expiry">
									{#if expiry?.kind === 'pill'}
										<Pill hue={expiry.hue}>{expiry.text}</Pill>
									{:else if expiry}
										<span class="mono plain-expiry">{expiry.text}</span>
									{/if}
								</span>
							</button>
						</div>
					{/each}
				</div>
			{/each}
		{/if}
	</div>

	{#if data.selected}
		{@const d = data.selected}
		<aside class="inspector" aria-label="Document details">
			<div class="ins-head">
				<h2 class="ins-name">
					{d.name}
					{#if d.restricted}
						<span class="lock"><Icon name="lock" size={13} label="Restricted" /></span>
					{/if}
				</h2>
				<button type="button" class="btn small" onclick={() => navigate({ doc: null })}>Back</button
				>
			</div>

			<div class="preview">
				{#if d.hasFile}
					<a
						class="btn"
						href={documentFileHref(d.id)}
						target="_blank"
						rel="noopener"
						data-file-ext={d.ext}
					>
						Open file
					</a>
				{:else}
					<!-- Metadata-only: the dropzone takes the preview's place rather
					     than an "Open file" button that opens nothing. -->
					<form method="POST" action="?/replaceFile" enctype="multipart/form-data" use:enhance>
						<input type="hidden" name="id" value={d.id} />
						<span class="quiet">No file attached</span>
						<UploadDropzone name="file" idleText="Attach file" />
						<button type="submit" class="btn">Attach</button>
					</form>
				{/if}
			</div>

			{#if d.pending}
				<p class="quiet">Preparing contents for search…</p>
			{:else if d.extraction && !d.extraction.complete}
				<div class="state-line">
					<p class="quiet">
						Pages 1–<span class="mono">{d.extraction.pagesExtracted}</span> are searchable. This file
						is larger than the automatic extraction limit.
					</p>
					<form method="POST" action="?/continueExtraction" use:enhance>
						<input type="hidden" name="id" value={d.id} />
						<button type="submit" class="link">Continue extracting</button>
					</form>
				</div>
			{:else if d.hasFile && !d.extraction}
				<div class="state-line">
					<p class="quiet">
						Couldn't read searchable text from this file. The document itself is safe and still
						available.
					</p>
					{#if data.isAdmin}
						<form method="POST" action="?/reExtract" use:enhance>
							<input type="hidden" name="id" value={d.id} />
							<button type="submit" class="link">Retry</button>
						</form>
					{/if}
				</div>
			{/if}

			{#if replacing}
				<!-- The same dropzone every document upload goes through: drag,
				     click and the camera in one place rather than a bare input
				     each screen wires up its own way. -->
				<form
					class="replace"
					method="POST"
					action="?/replaceFile"
					enctype="multipart/form-data"
					use:enhance={() =>
						async ({ update }) => {
							await update();
							replacing = false;
						}}
				>
					<input type="hidden" name="id" value={d.id} />
					<UploadDropzone name="file" idleText="Drop the replacement here, or click to browse" />
					<div class="ins-actions">
						<button type="submit" class="btn btn-primary">Replace</button>
						<button type="button" class="btn" onclick={() => (replacing = false)}>Cancel</button>
					</div>
				</form>
			{/if}

			{#if editing}
				<form class="ins-form" method="POST" action="?/updateDocument" use:enhance>
					<input type="hidden" name="id" value={d.id} />
					<label><span class="eyebrow">Name</span><input name="name" value={d.name} /></label>
					<label>
						<span class="eyebrow">Filed in</span>
						<select name="shelf" value={d.shelfKey}>
							{#each data.shelves.filter((s) => s.key !== 'all') as s (s.key)}
								<option value={s.key}>{s.label}</option>
							{/each}
						</select>
					</label>
					<label>
						<span class="eyebrow">Type</span>
						<select name="type" value={d.type}>
							{#each Object.entries(TYPE_LABELS) as [code, label] (code)}
								<option value={code}>{label}</option>
							{/each}
						</select>
					</label>
					<div class="field">
						<span class="eyebrow">About</span>
						<div class="checks">
							{#each [...data.people.map( (p) => ({ ...p, kind: 'person' }) ), ...data.properties.map( (p) => ({ ...p, kind: 'property' }) ), ...data.subjects.map( (s) => ({ ...s, kind: 'subject' }) )] as target (target.id)}
								<label class="check">
									<input
										type="checkbox"
										name="linkIds"
										value={target.id}
										checked={d.links.some((l) => l.id === target.id)}
									/>
									{target.name}
								</label>
							{/each}
						</div>
					</div>
					<div class="field expiry-field">
						<span class="eyebrow">Expiry</span>
						<select name="expiryVerb" value={d.expiryVerb}>
							{#each EXPIRY_VERBS as verb (verb)}<option value={verb}>{verb}</option>{/each}
						</select>
						<!-- Native date input, never a text mask: 12/01/2027 is a
						     DD/MM-vs-MM/DD bug waiting to happen in a Czech household. -->
						<input type="date" name="expiresOn" value={d.expiresOn ?? ''} />
					</div>
					<label
						><span class="eyebrow">Note</span><textarea name="note">{d.note ?? ''}</textarea></label
					>
					{#if data.isAdmin}
						<label class="check">
							<input
								type="checkbox"
								name="sensitivity"
								value="restricted"
								checked={d.sensitivity === 'restricted'}
							/>
							Restricted
						</label>
						<span class="quiet">
							Restricted documents do not appear in search, document lists, briefing, calendar or
							downloads for household members.
						</span>
					{/if}
					<div class="ins-actions">
						<button type="submit" class="btn btn-primary">Save</button>
						<button type="button" class="btn" onclick={() => (editing = false)}>Cancel</button>
					</div>
				</form>
			{:else}
				<dl class="ins-read">
					<dt class="eyebrow">Filed in</dt>
					<dd>{d.shelfLabel}</dd>
					<dt class="eyebrow">Type</dt>
					<dd>{typeLabel(d.type)}</dd>
					<dt class="eyebrow">About</dt>
					<dd>{d.entities.length ? d.entities.join(', ') : '—'}</dd>
					<dt class="eyebrow">Expiry</dt>
					<dd class="mono">{d.expiresOn ? `${d.expiryVerb} ${d.expiresOn}` : '—'}</dd>
					<dt class="eyebrow">Tags</dt>
					<dd>{d.tags.length ? d.tags.join(', ') : '—'}</dd>
					<dt class="eyebrow">Note</dt>
					<dd>{d.note ?? '—'}</dd>
				</dl>
				<!-- Pinned to exactly this order — Replace file, Re-extract,
				     Download, Delete — so the destructive one is never where the
				     harmless one was a moment ago. -->
				<div class="ins-actions">
					<button type="button" class="btn btn-primary" onclick={() => (editing = true)}
						>Edit</button
					>
					{#if d.hasFile}
						<button type="button" class="btn" onclick={() => (replacing = !replacing)}>
							Replace file
						</button>
					{/if}
					{#if data.isAdmin}
						<form method="POST" action="?/reExtract" use:enhance>
							<input type="hidden" name="id" value={d.id} />
							<button type="submit" class="link">Retry</button>
						</form>
					{/if}
				</div>
			{/if}

			{#if editing}
				<form class="ins-form" method="POST" action="?/updateDocument" use:enhance>
					<input type="hidden" name="id" value={d.id} />
					<label><span class="eyebrow">Name</span><input name="name" value={d.name} /></label>
					<label>
						<span class="eyebrow">Filed in</span>
						<select name="shelf" value={d.shelfKey}>
							{#each data.shelves.filter((s) => s.key !== 'all') as s (s.key)}
								<option value={s.key}>{s.label}</option>
							{/each}
						</select>
					</label>
					<label>
						<span class="eyebrow">Type</span>
						<select name="type" value={d.type}>
							{#each Object.entries(TYPE_LABELS) as [code, label] (code)}
								<option value={code}>{label}</option>
							{/each}
						</select>
					</label>
					<div class="field">
						<span class="eyebrow">About</span>
						<div class="checks">
							{#each [...data.people.map( (p) => ({ ...p, kind: 'person' }) ), ...data.properties.map( (p) => ({ ...p, kind: 'property' }) ), ...data.subjects.map( (s) => ({ ...s, kind: 'subject' }) )] as target (target.id)}
								<label class="check">
									<input
										type="checkbox"
										name="linkIds"
										value={target.id}
										checked={d.links.some((l) => l.id === target.id)}
									/>
									{target.name}
								</label>
							{/each}
						</div>
					</div>
					<div class="field expiry-field">
						<span class="eyebrow">Expiry</span>
						<select name="expiryVerb" value={d.expiryVerb}>
							{#each EXPIRY_VERBS as verb (verb)}<option value={verb}>{verb}</option>{/each}
						</select>
						<!-- Native date input, never a text mask: 12/01/2027 is a
						     DD/MM-vs-MM/DD bug waiting to happen in a Czech household. -->
						<input type="date" name="expiresOn" value={d.expiresOn ?? ''} />
					</div>
					<label
						><span class="eyebrow">Note</span><textarea name="note">{d.note ?? ''}</textarea></label
					>
					{#if data.isAdmin}
						<label class="check">
							<input
								type="checkbox"
								name="sensitivity"
								value="restricted"
								checked={d.sensitivity === 'restricted'}
							/>
							Restricted
						</label>
						<span class="quiet">
							Restricted documents do not appear in search, document lists, briefing, calendar or
							downloads for household members.
						</span>
					{/if}
					<div class="ins-actions">
						<button type="submit" class="btn btn-primary">Save</button>
						<button type="button" class="btn" onclick={() => (editing = false)}>Cancel</button>
					</div>
				</form>
			{:else}
				<dl class="ins-read">
					<dt class="eyebrow">Filed in</dt>
					<dd>{d.shelfLabel}</dd>
					<dt class="eyebrow">Type</dt>
					<dd>{typeLabel(d.type)}</dd>
					<dt class="eyebrow">About</dt>
					<dd>{d.entities.length ? d.entities.join(', ') : '—'}</dd>
					<dt class="eyebrow">Expiry</dt>
					<dd class="mono">{d.expiresOn ? `${d.expiryVerb} ${d.expiresOn}` : '—'}</dd>
					<dt class="eyebrow">Tags</dt>
					<dd>{d.tags.length ? d.tags.join(', ') : '—'}</dd>
					<dt class="eyebrow">Note</dt>
					<dd>{d.note ?? '—'}</dd>
				</dl>
				<!-- Pinned to exactly this order — Replace file, Re-extract,
				     Download, Delete — so the destructive one is never where the
				     harmless one was a moment ago. -->
				<div class="ins-actions">
					<button type="button" class="btn btn-primary" onclick={() => (editing = true)}
						>Edit</button
					>
					{#if d.hasFile}
						<button type="button" class="btn" onclick={() => (replacing = !replacing)}>
							Replace file
						</button>
					{/if}
					{#if data.isAdmin}
						<form method="POST" action="?/reExtract" use:enhance>
							<input type="hidden" name="id" value={d.id} />
							<button type="submit" class="btn">Re-extract</button>
						</form>
					{/if}
					{#if d.hasFile}
						<!-- `download` on the anchor: the file overlay leaves a save
						     alone, which is why it checks for the attribute. -->
						<a class="btn" href={documentFileHref(d.id)} download>Download</a>
					{/if}
					{#if confirmingDelete}
						<form method="POST" action="?/deleteDocument" use:enhance>
							<input type="hidden" name="id" value={d.id} />
							<button type="submit" class="btn danger">
								Delete — this removes the file and every link to it
							</button>
						</form>
					{:else}
						<button type="button" class="btn" onclick={() => (confirmingDelete = true)}
							>Delete</button
						>
					{/if}
				</div>
				{#if data.isAdmin && d.extraction}
					<details class="tech">
						<summary class="quiet">Technical details</summary>
						<p class="quiet mono">
							{d.extraction.engine} · {d.extraction.languages}
							{#if d.extraction.meanConfidence !== null}
								· confidence {Math.round(d.extraction.meanConfidence)}
							{/if}
						</p>
					</details>
				{/if}
			{/if}
		</aside>
	{/if}
</section>

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.ack {
		display: flex;
		align-items: center;
		gap: var(--space-5);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.search {
		position: relative;
		flex: 1 1 280px;
		max-width: 420px;
	}
	.search-icon {
		position: absolute;
		left: 11px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--fg3);
		pointer-events: none;
	}
	.search input {
		width: 100%;
		height: var(--control-h);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--fg1);
		padding: 0 12px 0 34px;
		font-size: var(--text-md);
	}
	.sort,
	.bulk select,
	.bulk input,
	.ins-form input,
	.ins-form select,
	.ins-form textarea {
		height: var(--control-h);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--fg1);
		padding: 0 10px;
		font-size: var(--text-md);
	}
	.ins-form textarea {
		height: auto;
		min-height: calc(var(--control-h) * 2);
		padding: 8px 10px;
		font-family: inherit;
	}
	.add {
		margin-left: auto;
	}
	.capture {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--card);
		padding: var(--space-7);
	}
	.capture-foot {
		display: flex;
		align-items: center;
		gap: var(--space-5);
	}
	.capture-foot .quiet {
		margin-right: auto;
	}
	.layout {
		display: grid;
		grid-template-columns: 218px minmax(0, 1fr);
		gap: 28px;
		align-items: start;
	}
	.layout.with-inspector {
		grid-template-columns: 218px minmax(0, 1fr) 460px;
	}
	.rail {
		position: sticky;
		top: 14px;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		/* A1: the shelf list uses the viewport it has rather than a fixed height
		   that scrolls while the page still has room. */
		max-height: calc(100vh - 120px);
		min-height: 0;
	}
	.rail-shelves {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-height: 0;
		overflow-y: auto;
	}
	.rail-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-5);
		padding: 8px 10px;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--fg2);
		font-size: var(--text-md);
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.rail-item:hover {
		background: var(--card2);
	}
	.rail-item.active {
		background: var(--card3);
		color: var(--fg1);
	}
	.rail-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rail-count {
		font-size: var(--text-2xs);
		color: var(--fg3);
		font-variant-numeric: tabular-nums;
	}
	.rail-count.waiting {
		color: var(--yellow);
	}
	.rail-divider {
		height: 1px;
		background: var(--bd);
		margin: var(--space-3) 0;
	}
	.manage {
		color: var(--fg3);
	}
	.manage:hover {
		color: var(--fg2);
	}
	.area {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		min-width: 0;
	}
	.strip {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--card);
		padding: 11px 14px;
	}
	.strip-text {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.strip-act {
		margin-left: auto;
	}
	.archive-line {
		display: flex;
		align-items: center;
		gap: var(--space-5);
	}
	.tag-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}
	.tag-chip {
		border: 1px solid var(--bd);
		border-radius: var(--radius-chip);
		background: transparent;
		color: var(--fg2);
		padding: 3px 10px;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.tag-chip.active {
		background: var(--card3);
		color: var(--fg1);
	}
	.t-count {
		color: var(--fg3);
		font-size: var(--text-2xs);
	}
	.bulk {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--card);
		padding: 10px 14px;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.group-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 0 var(--space-4) var(--space-4);
		border-bottom: 1px solid var(--bd);
	}
	.group-label {
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--fg1);
	}
	.group-count {
		font-size: var(--text-2xs);
		color: var(--fg3);
		font-variant-numeric: tabular-nums;
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		border-radius: var(--radius-md);
	}
	.row:hover,
	.row.selected {
		background: var(--card2);
	}
	.pick {
		flex: none;
		margin-left: var(--space-4);
	}
	.row-main {
		flex: 1;
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr) 140px;
		align-items: center;
		gap: var(--space-5);
		padding: 9px var(--space-4);
		border: 0;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
		min-width: 0;
	}
	.ext {
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: var(--radius-xs);
		padding: 2px 0;
		text-align: center;
	}
	.names {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.row-name {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		font-size: var(--text-md);
		color: var(--fg1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lock {
		flex: none;
		color: var(--fg3);
		display: inline-flex;
	}
	.chip {
		flex: none;
		font-size: var(--text-2xs);
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: var(--radius-xl);
		padding: 0 7px;
	}
	.sub,
	.snippet,
	.match-label {
		font-size: var(--text-sm);
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.snippet {
		border-left: 1px solid var(--bd2);
		padding-left: var(--space-4);
		color: var(--fg2);
	}
	.expiry {
		display: flex;
		justify-content: flex-end;
	}
	.plain-expiry {
		font-size: var(--text-2xs);
		color: var(--fg3);
		font-variant-numeric: tabular-nums;
	}
	.empty {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		align-items: flex-start;
		padding: var(--space-8) 0;
	}
	.empty-title {
		font-size: var(--text-md);
		color: var(--fg1);
		margin: 0;
	}
	.quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
		margin: 0;
	}
	.link {
		border: 0;
		background: transparent;
		color: var(--brand);
		font-size: var(--text-sm);
		cursor: pointer;
		padding: 0;
	}
	.inspector {
		position: sticky;
		top: 14px;
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--card);
		padding: var(--space-7);
		max-height: calc(100vh - 120px);
		overflow-y: auto;
	}
	.ins-head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-5);
	}
	.ins-name {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
	}
	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.ins-read {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-1);
		margin: 0;
	}
	.ins-read dd {
		margin: 0 0 var(--space-5);
		font-size: var(--text-md);
		color: var(--fg1);
		min-height: var(--control-h);
		/* The same 10px inset the inputs use, so the read view and the edit view
		   do not shift the panel when they swap. */
		padding: 8px 10px;
	}
	.ins-form,
	.ins-actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.ins-actions {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
	}
	.ins-form label,
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.expiry-field {
		flex-direction: row;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.checks {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.replace {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.danger {
		border-color: var(--red);
		color: var(--red);
	}
	.tech summary {
		cursor: pointer;
	}
	.state-line {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
	}

	@media (max-width: 1200px) {
		.layout,
		.layout.with-inspector {
			grid-template-columns: 218px minmax(0, 1fr);
		}
		.layout.with-inspector .inspector {
			grid-column: 1 / -1;
		}
		.row-main {
			grid-template-columns: 32px minmax(0, 1fr) 128px;
			gap: var(--space-4);
		}
	}
	@media (max-width: 860px) {
		.layout,
		.layout.with-inspector {
			grid-template-columns: minmax(0, 1fr);
		}
		.rail {
			position: static;
			flex-direction: row;
			flex-wrap: wrap;
			max-height: none;
		}
		.rail-shelves {
			flex-direction: row;
			flex-wrap: wrap;
			overflow: visible;
		}
		.rail-divider {
			display: none;
		}
	}
	@media (max-width: 640px) {
		.row-main {
			grid-template-columns: 32px minmax(0, 1fr);
			row-gap: var(--space-3);
		}
		.row-name {
			white-space: normal;
			text-wrap: pretty;
		}
		.expiry {
			grid-column: 2;
			justify-content: flex-start;
		}
	}
</style>
