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
	import TagField from '$lib/components/TagField.svelte';
	import { documentFileHref } from '$lib/ui/file-viewer';
	import { EXPIRY_VERBS } from '$lib/documents';
	import {
		expiryTreatment,
		groupDocuments,
		honestyState,
		readableSize,
		rowVariant,
		splitSnippet,
		rowTags,
		sortDocuments,
		subLine,
		typeLabel,
		TYPE_LABELS,
		type GroupKey,
		type SortKey
	} from '$lib/documents-view';
	import { navigating } from '$app/state';

	let { data, form } = $props();

	let query = $state(untrack(() => data.query));
	let capturing = $state(untrack(() => data.prefill.open));
	let editing = $state(false);
	let selection = $state<string[]>([]);
	// Checkboxes appear on hover, or stay pinned once Select is on. A permanent
	// checkbox on every row makes the list look like a bulk-edit tool, which is
	// not what filing paper is.
	let selecting = $state(false);
	let overflowOpen = $state(false);
	let confirmingDelete = $state(false);
	let replacing = $state(false);

	$effect(() => {
		// A navigation is what carries new data in; nothing stays armed across it.
		void data.rows;
		confirmingDelete = false;
		selection = [];
		selecting = false;
	});
	$effect(() => {
		// The inspector opens read-only, whichever document it opens on.
		void data.selected?.id;
		editing = false;
		replacing = false;
		overflowOpen = false;
	});

	const today = new Date().toISOString().slice(0, 10);
	// What the preview can show inline. Anything else is handed to an iframe,
	// which is what a PDF needs and what everything else degrades to.
	const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];

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
	caption="One archive for the household. Shelf is where in life, type is what kind, links are what it concerns."
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

	<span class="eyebrow group-label">Group</span>
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
		<option value="newest">Sort · Newest first</option>
		<option value="oldest">Sort · Oldest first</option>
		<option value="name">Sort · Name A–Z</option>
		<option value="expiry">Sort · Expiry soonest</option>
	</select>

	<button
		type="button"
		class="btn select-toggle"
		class:active={selecting}
		onclick={() => {
			selecting = !selecting;
			if (!selecting) selection = [];
		}}
	>
		Select
	</button>
	<button type="button" class="btn btn-primary" onclick={() => (capturing = !capturing)}>
		Add document
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
				<span class="rail-label"
					>{#if s.emoji}<span class="rail-emoji">{s.emoji}</span>{/if}{s.label}</span
				>
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
					<span class="rail-label"><span class="rail-emoji">{s.emoji}</span>{s.label}</span>
					<span class="mono rail-count">{s.count}</span>
				</button>
			{/each}
		</div>

		<div class="rail-divider"></div>

		<a class="rail-item manage" href="/documents/settings">
			<span class="rail-label"><Icon name="plus" size={16} /> Manage shelves</span>
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
				<TagField known={data.knownTags} placeholder="Add tags…" />
				{#if data.isAdmin}
					<select name="sensitivity" aria-label="Set visibility">
						<option value="">Visibility…</option>
						<option value="normal">Everyone in the household</option>
						<option value="restricted">Admins only</option>
					</select>
				{/if}
				<button type="submit" class="btn btn-primary">Apply</button>
				<button
					type="button"
					class="btn cancel"
					onclick={() => {
						selection = [];
						selecting = false;
					}}>Cancel selection</button
				>
			</form>
		{/if}

		{#if navigating.to}
			<!-- Three static blocks, always three regardless of the real count: a
			     guessed count that then changes is worse than none. No shimmer —
			     the system has no animation. -->
			<div class="loading" aria-hidden="true">
				<div class="skeleton" style:opacity="1"></div>
				<div class="skeleton" style:opacity="0.7"></div>
				<div class="skeleton" style:opacity="0.45"></div>
			</div>
		{:else if data.rows.length === 0}
			{#if data.query}
				{@const state = honestyState(data.query, 0, data.honesty)}
				<div class="honesty">
					{#if state === 'archived-only'}
						<span class="mono h-key">ARCHIVED ONLY</span>
						<p class="h-head">No active documents match “{data.query}”.</p>
						<p class="h-body">
							<span class="mono">{data.honesty?.archivedOnly}</span>
							{data.honesty?.archivedOnly === 1 ? 'match belongs' : 'matches belong'} only to archived
							subjects.
						</p>
						<button type="button" class="btn h-act" onclick={() => navigate({ archived: '1' })}>
							Show archived matches
						</button>
					{:else if state === 'preparing'}
						<span class="mono h-key">STILL PREPARING</span>
						<p class="h-head">
							No match yet. <span class="mono">{data.honesty?.pending}</span> documents are still being
							prepared for content search.
						</p>
						<p class="h-body">
							Their contents are not searchable until that finishes. Names, notes and tags already
							are.
						</p>
					{:else}
						<span class="mono h-key">NO MATCH</span>
						<p class="h-head">
							No documents match “{data.query}”. Try fewer words or remove a filter.
						</p>
						<p class="h-body">
							No match in names, entities, tags, notes or searchable contents.
							{#if data.honesty?.notSearchable}
								<span class="mono">{data.honesty.notSearchable}</span> documents don't have searchable
								contents.
							{/if}
						</p>
						<button type="button" class="btn h-act" onclick={() => navigate({ q: null })}>
							Clear search
						</button>
					{/if}
				</div>
			{:else if data.total === 0 && data.shelf === 'all'}
				<!-- Fresh install: the dropzone IS the empty state, at full width.
				     Its dashed border is its own treatment, not a new one. -->
				<form
					class="fresh"
					method="POST"
					action="?/addDocument"
					enctype="multipart/form-data"
					use:enhance
				>
					<input type="hidden" name="shelf" value="inbox" />
					<p class="empty-title">No documents yet.</p>
					<p class="quiet">
						Drop files here, or click to browse. A name is generated and they go to the Inbox —
						nothing else is asked of you.
					</p>
					<UploadDropzone name="file" idleText="Drop files here, or click to browse" />
					<button type="submit" class="btn btn-primary">Add</button>
				</form>
			{:else}
				<div class="empty">
					<p class="empty-title">Nothing on {shelfLabel} yet.</p>
					<p class="quiet">
						Add a document from the toolbar and it lands in the Inbox — file it here from there.
					</p>
				</div>
			{/if}
		{:else}
			{#if honestyState(data.query, data.rows.length, data.honesty) === 'not-searchable'}
				<p class="quiet">
					<span class="mono">{data.honesty?.notSearchable}</span> documents cannot be searched by contents
					— photographs and scans without a text layer are matched on name, note and tags only.
				</p>
			{/if}
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
						{@const variant = rowVariant(d.match)}
						{@const parts = d.match?.snippet ? splitSnippet(d.match.snippet, data.query) : null}
						{@const nameParts = data.query ? splitSnippet(d.name, data.query) : null}
						<div
							class="row"
							class:selected={data.selected?.id === d.id}
							class:picked={selection.includes(d.id)}
							class:tall={variant !== 'metadata'}
						>
							<button
								type="button"
								class="row-main"
								onclick={() => navigate({ doc: d.id })}
								aria-label="Open {d.name}"
							>
								<span class="mono ext">{d.ext}</span>
								<span class="names">
									<span class="row-name">
										{#if nameParts}
											{nameParts.before}<SnippetMark>{nameParts.match}</SnippetMark
											>{nameParts.after}
										{:else}
											{d.name}
										{/if}
										{#if d.restricted}
											<!-- Inline in the title flow, not a flex sibling: on a
											     two-line name a sibling centres against the block and
											     reads as a second button. Quiet, and admins only —
											     restricted is an access state, not a warning. -->
											<span class="lock"><Icon name="lock" size={13} label="Restricted" /></span>
										{/if}
										{#if d.subjectArchived}
											<span class="chip">Archived subject</span>
										{/if}
									</span>
									<span class="sub">
										{subLine(d)}
										{#if d.tags.length}
											{@const t = rowTags(d.tags)}
											{#each t.shown as tagName (tagName)}<span class="chip tag">{tagName}</span
												>{/each}
											{#if t.more}<span class="chip tag">+{t.more}</span>{/if}
										{/if}
									</span>
									{#if variant !== 'metadata' && d.match?.snippet}
										<span class="snippet">
											{#if variant === 'note'}<span class="snippet-key">Note ·</span>{/if}
											{#if parts}
												„{parts.before}<SnippetMark>{parts.match}</SnippetMark>{parts.after}“
											{:else}
												„{d.match.snippet}“
											{/if}
										</span>
										<span class="mono match-label">
											{variant === 'content' ? 'Matched in contents' : 'Matched in note'}{d.match
												.pageNo
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
							<!-- Last in the DOM, positioned over the row: the grid stays
							     38px / 1fr / 140px whether or not anything is selectable. -->
							<label class="pick" class:shown={selecting || selection.includes(d.id)}>
								<input
									type="checkbox"
									aria-label="Select {d.name}"
									checked={selection.includes(d.id)}
									onchange={() => toggleSelected(d.id)}
								/>
							</label>
						</div>
					{/each}
				</div>
			{/each}
		{/if}
	</div>

	{#if data.selected}
		{@const d = data.selected}
		<aside class="inspector" aria-label="Document details">
			<!-- 1. Header. The lock is INLINE in the title text flow, wrapped with a
			     zero-width space so it trails the last word and wraps with it. As a
			     flex sibling it centres against a two-line name and reads as a
			     second toolbar button. -->
			<header class="ins-head">
				<div class="ins-title">
					<h2 class="ins-name">
						{d.name}{#if d.restricted}<span class="lock-wrap"
								>&#8203;<span class="lock"><Icon name="lock" size={15} label="Restricted" /></span
								></span
							>{/if}
					</h2>
					<p class="mono ins-meta">
						{d.ext}{#if readableSize(d.fileSize)}
							· {readableSize(d.fileSize)}{/if} · added
						{d.addedOn}
					</p>
				</div>
				<div class="ins-overflow">
					<button
						type="button"
						class="ins-more"
						aria-label="More for {d.name}"
						aria-expanded={overflowOpen}
						onclick={() => (overflowOpen = !overflowOpen)}>⋯</button
					>
					{#if overflowOpen}
						<!-- Pinned order, never contextual: Replace file · Re-extract ·
						     Download · Delete. Re-extract is GREYED for members rather
						     than hidden, so a member and an admin describing this menu
						     describe the same menu. -->
						<div class="menu" role="menu">
							{#if d.hasFile}
								<button
									type="button"
									class="menu-row"
									role="menuitem"
									onclick={() => {
										replacing = true;
										overflowOpen = false;
									}}>Replace file</button
								>
							{/if}
							<form method="POST" action="?/reExtract" use:enhance>
								<input type="hidden" name="id" value={d.id} />
								<button
									type="submit"
									class="menu-row"
									role="menuitem"
									disabled={!data.isAdmin}
									title={data.isAdmin ? undefined : 'Admins only'}>Re-extract</button
								>
							</form>
							{#if d.hasFile}
								<a class="menu-row" role="menuitem" href={documentFileHref(d.id)} download>
									Download
								</a>
							{/if}
							{#if confirmingDelete}
								<form method="POST" action="?/deleteDocument" use:enhance>
									<input type="hidden" name="id" value={d.id} />
									<button type="submit" class="menu-row danger" role="menuitem">
										Delete — removes the file and every link to it
									</button>
								</form>
							{:else}
								<button
									type="button"
									class="menu-row danger"
									role="menuitem"
									onclick={() => (confirmingDelete = true)}>Delete</button
								>
							{/if}
						</div>
					{/if}
				</div>
				<!-- Back closes too (the panel is a URL), but a person looking at a
				     panel expects a way out on the panel itself. -->
				<button
					type="button"
					class="ins-more"
					aria-label="Close"
					onclick={() => navigate({ doc: null })}>✕</button
				>
			</header>

			<!-- 2. Preview. A tall receipt letterboxes rather than crops — cropping
			     the top of a receipt hides the merchant. -->
			{#if d.hasFile}
				<!-- The preview IS the link: a click opens the same overlay viewer
				     every document link in the app opens. The iframe is inert so the
				     click reaches the anchor rather than the PDF plugin, and the
				     fragment asks the plugin to draw the page without its toolbar. -->
				<a
					class="ins-preview"
					href={documentFileHref(d.id)}
					data-file-ext={d.ext}
					aria-label="Open {d.name}"
				>
					{#if IMAGE_EXT.includes(d.ext.toLowerCase())}
						<img src={documentFileHref(d.id)} alt="" />
					{:else}
						<iframe
							title=""
							tabindex="-1"
							src="{documentFileHref(d.id)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH"
						></iframe>
					{/if}
				</a>
			{:else if !replacing}
				<!-- Metadata-only: the dropzone takes the preview's slot, sized to its
				     content. An empty A4-shaped hole reads as a failed load. -->
				<form
					class="ins-attach"
					method="POST"
					action="?/replaceFile"
					enctype="multipart/form-data"
					use:enhance
				>
					<input type="hidden" name="id" value={d.id} />
					<span class="quiet">No file attached</span>
					<UploadDropzone name="file" idleText="Attach file" />
					<button type="submit" class="btn">Attach</button>
				</form>
			{/if}

			{#if replacing}
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

			<!-- 3. Actions. Open file outranks the menu by fill and by width; on a
			     metadata-only document it is ABSENT rather than disabled, and Edit
			     becomes primary. -->
			{#if !editing}
				<div class="ins-primary">
					{#if d.hasFile}
						<a
							class="btn btn-primary open"
							href={documentFileHref(d.id)}
							target="_blank"
							rel="noopener"
							data-file-ext={d.ext}>Open file</a
						>
						<button type="button" class="btn" onclick={() => (editing = true)}>Edit</button>
					{:else}
						<button type="button" class="btn btn-primary open" onclick={() => (editing = true)}>
							Edit
						</button>
					{/if}
				</div>
			{/if}

			{#if d.pending}
				<p class="quiet state-line">Preparing contents for search…</p>
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

			<!-- 4. Full-bleed rule, then 5. the sections. Read and edit share the
			     eyebrow, the rule and the 10px inset, so the panel does not jump
			     when they swap — only the border and the caret appear. -->
			<div class="ins-rule"></div>

			{#if editing}
				<form class="ins-sections" method="POST" action="?/updateDocument" use:enhance>
					<input type="hidden" name="id" value={d.id} />
					<div class="sec">
						<span class="eyebrow">Name</span>
						<input name="name" value={d.name} />
					</div>
					<div class="sec">
						<span class="eyebrow">Shelf</span>
						<select name="shelf" value={d.shelfKey}>
							{#each data.shelves.filter((s) => s.key !== 'all') as s (s.key)}
								<option value={s.key}>{s.label}</option>
							{/each}
						</select>
					</div>
					<div class="sec">
						<span class="eyebrow">Type</span>
						<select name="type" value={d.type}>
							{#each Object.entries(TYPE_LABELS) as [code, label] (code)}
								<option value={code}>{label}</option>
							{/each}
						</select>
					</div>
					<div class="sec">
						<span class="eyebrow">About</span>
						<!-- Chips, grouped by what kind of thing they are. A chip is as wide
						     as its name, so a street address and a first name share one flow
						     without a grid forcing them to the same width. -->
						<div class="about">
							{#each [{ label: 'People', items: data.people }, { label: 'Property', items: data.properties }, { label: 'Subjects', items: data.subjects }] as group (group.label)}
								{#if group.items.length}
									<div class="about-group">
										<span class="mono about-kind">{group.label}</span>
										<div class="chips">
											{#each group.items as target (target.id)}
												<label class="pick-chip">
													<input
														type="checkbox"
														name="linkIds"
														value={target.id}
														checked={d.links.some((l) => l.id === target.id)}
													/>
													<span>{target.name}</span>
												</label>
											{/each}
										</div>
									</div>
								{/if}
							{/each}
						</div>
					</div>
					<div class="sec">
						<span class="eyebrow">Expiry</span>
						<div class="expiry-grid">
							<select name="expiryVerb" value={d.expiryVerb}>
								{#each EXPIRY_VERBS as verb (verb)}<option value={verb}>{verb}</option>{/each}
							</select>
							<!-- Native date input, never a text mask: 12/01/2027 is a
							     DD/MM-vs-MM/DD bug waiting to happen in a Czech household. -->
							<input type="date" name="expiresOn" value={d.expiresOn ?? ''} />
						</div>
					</div>
					<div class="sec">
						<span class="eyebrow">Tags</span>
						<TagField tags={[...d.tags]} known={data.knownTags} />
					</div>
					<div class="sec last">
						<span class="eyebrow">Note</span>
						<textarea name="note">{d.note ?? ''}</textarea>
					</div>
					{#if data.isAdmin}
						<div class="sec last">
							<label class="check">
								<input
									type="checkbox"
									name="sensitivity"
									value="restricted"
									checked={d.sensitivity === 'restricted'}
								/>
								Restricted
							</label>
							<span class="quiet">Absent for members, not locked.</span>
						</div>
					{/if}
					<div class="ins-actions">
						<button type="submit" class="btn btn-primary">Save</button>
						<button type="button" class="btn" onclick={() => (editing = false)}>Cancel</button>
					</div>
				</form>
			{:else}
				<div class="ins-sections">
					<div class="sec">
						<span class="eyebrow">Filed in</span><span class="val">{d.shelfLabel}</span>
					</div>
					<div class="sec">
						<span class="eyebrow">Type</span><span class="val">{typeLabel(d.type)}</span>
					</div>
					<div class="sec">
						<span class="eyebrow">About</span>
						<span class="val">{d.entities.length ? d.entities.join(', ') : '—'}</span>
					</div>
					<div class="sec">
						<span class="eyebrow">Expiry</span>
						<span class="val mono">{d.expiresOn ? `${d.expiryVerb} ${d.expiresOn}` : '—'}</span>
					</div>
					<div class="sec">
						<span class="eyebrow">Tags</span>
						<span class="val">{d.tags.length ? d.tags.join(', ') : '—'}</span>
					</div>
					<div class="sec last">
						<span class="eyebrow">Note</span>
						<span class="val">{d.note ?? '—'}</span>
					</div>
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
	.sec input,
	.sec select,
	.sec textarea {
		height: var(--control-h);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--fg1);
		padding: 0 10px;
		font-size: var(--text-md);
	}
	.sec textarea {
		height: auto;
		min-height: 72px;
		resize: vertical;
		padding: 8px 10px;
		font-family: inherit;
	}
	.select-toggle {
		margin-left: auto;
	}
	.select-toggle.active {
		background: var(--card3);
		border-color: var(--bd2);
		color: var(--fg1);
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
	/* The shelf's own emoji, at the row level where emoji are allowed to live.
	   The design pass resolved this off; the household asked for it on. */
	.rail-emoji {
		display: inline-block;
		width: 22px;
		margin-right: var(--space-3);
		font-size: var(--text-lg);
		text-align: center;
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
	.manage .rail-label {
		display: flex;
		align-items: center;
		gap: var(--space-4);
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
		position: relative;
		border-radius: var(--radius-md);
	}
	.row:hover,
	.row.selected,
	.row.picked {
		background: var(--card2);
	}
	/* Over the row rather than in it, so the grid is the same three columns
	   whether or not anything is selectable. */
	.pick {
		position: absolute;
		left: -22px;
		top: 12px;
		opacity: 0;
		pointer-events: none;
	}
	.row:hover .pick,
	.pick.shown {
		opacity: 1;
		pointer-events: auto;
	}
	.row-main {
		width: 100%;
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
	/* A two-line row centred against a one-line badge reads as a misalignment
	   rather than as more information, so a snippet row aligns to the top. */
	.row.tall .row-main {
		align-items: start;
	}
	.row.tall .ext,
	.row.tall .expiry {
		margin-top: var(--space-1);
	}
	.names {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
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
	.sub {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip.tag {
		margin-left: var(--space-2);
	}
	.snippet {
		font-size: var(--text-sm);
		color: var(--fg2);
		border-left: 1px solid var(--bd2);
		padding-left: var(--space-5);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.snippet-key {
		color: var(--fg3);
	}
	.match-label {
		font-size: var(--text-2xs);
		color: var(--fg3);
		padding-left: var(--space-5);
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
	.loading {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.skeleton {
		height: 34px;
		border-radius: var(--radius-md);
		background: var(--card2);
	}
	.honesty {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-height: 160px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--card);
		padding: var(--space-7);
	}
	.h-key {
		font-size: var(--text-2xs);
		color: var(--fg3);
		letter-spacing: 0.1em;
	}
	.h-head {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.h-body {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.h-act {
		margin-top: auto;
		align-self: flex-start;
	}
	.fresh {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		align-items: flex-start;
	}
	.fresh :global(.dropzone),
	.fresh :global(label) {
		width: 100%;
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
		/* Bounded by the viewport, not by the list beside it: the sections scroll
		   inside the panel, and the page never has to scroll to reach the note.
		   dvh, so a phone's retreating browser chrome does not push the last
		   section below the fold. */
		max-height: calc(100dvh - 28px);
		min-height: 0;
		overflow-y: auto;
	}
	.state-line {
		margin: 0 var(--space-8);
	}
	.ins-head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-5);
		padding: var(--space-8) var(--space-8) var(--space-6);
	}
	.ins-title {
		flex: 1;
		min-width: 0;
	}
	.ins-name {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--fg1);
		text-wrap: pretty;
	}
	/* The lock trails the last word and wraps with it, rather than centring
	   against a two-line block as a flex sibling would. */
	.lock-wrap {
		white-space: nowrap;
	}
	.lock-wrap .lock {
		display: inline-flex;
		vertical-align: -1px;
		margin-left: 7px;
	}
	.ins-meta {
		margin: var(--space-3) 0 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.ins-overflow {
		position: relative;
		flex: none;
	}
	.ins-head > .ins-more {
		flex: none;
	}
	.ins-more {
		width: 36px;
		height: 36px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--fg2);
		font-size: var(--text-md);
		cursor: pointer;
	}
	.ins-more:hover {
		background: var(--card3);
	}
	.menu {
		position: absolute;
		right: 0;
		top: 40px;
		z-index: 5;
		width: 300px;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-lg);
		background: var(--bg2);
		overflow: hidden;
	}
	.menu-row {
		display: block;
		width: 100%;
		height: 36px;
		line-height: 36px;
		border: 0;
		background: transparent;
		color: var(--fg1);
		font-size: var(--text-md);
		text-align: left;
		text-decoration: none;
		padding: 0 var(--space-6);
		cursor: pointer;
	}
	.menu-row:hover {
		background: var(--card2);
	}
	.menu-row:disabled {
		color: var(--fg3);
		cursor: not-allowed;
	}
	.menu-row.danger {
		color: var(--red);
		height: auto;
		line-height: 1.4;
		padding: var(--space-5) var(--space-6);
	}
	.ins-preview {
		margin: 0 var(--space-8);
		max-height: 260px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		background: var(--card2);
		overflow: hidden;
	}
	.ins-preview img,
	.ins-preview iframe {
		max-width: 100%;
		max-height: 260px;
		width: 100%;
		height: 260px;
		border: 0;
		/* A tall receipt letterboxes rather than crops — cropping the top of a
		   receipt hides the merchant. */
		object-fit: contain;
		pointer-events: none;
	}
	.ins-preview:hover {
		border-color: var(--bd2);
	}
	.ins-attach,
	.replace {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		margin: 0 var(--space-8);
	}
	.ins-primary {
		display: flex;
		gap: var(--space-5);
		margin: 0 var(--space-8);
	}
	.open {
		flex: 1;
	}
	.ins-rule {
		height: 1px;
		background: var(--bd);
	}
	.ins-sections {
		display: flex;
		flex-direction: column;
		padding: var(--space-6) var(--space-8) var(--space-8);
	}
	.sec {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5) 0;
		border-bottom: 1px solid var(--bd);
	}
	.sec.last,
	.sec:last-of-type {
		border-bottom: 0;
	}
	/* Read values carry the input's own inset and height, so swapping to edit
	   moves nothing above the note. */
	.val {
		min-height: var(--control-h);
		display: flex;
		align-items: center;
		padding: 0 10px;
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.expiry-grid {
		display: grid;
		grid-template-columns: 108px minmax(0, 1fr);
		gap: var(--space-4);
	}
	.ins-actions {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-5);
		padding-top: var(--space-5);
	}
	.about {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
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
	/* The checkbox is the control and stays in the accessibility tree; the chip
	   is its face. Checked is a fill change, not a tint: it is a selection. */
	.pick-chip {
		position: relative;
		display: inline-flex;
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
	.pick-chip:has(input:focus-visible) {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
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
	.danger,
	.cancel {
		border-color: var(--red);
		color: var(--red);
	}
	.tech {
		margin: 0 var(--space-8) var(--space-8);
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
