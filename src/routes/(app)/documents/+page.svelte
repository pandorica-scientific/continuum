<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// A very good filing cabinet with excellent search — not a document
	// management system. One rail, one list, one document per row, and an
	// inspector that opens beside the list rather than over it.
	//
	// Every decision worth testing lives in `$lib/documents-view`, because there
	// is no browser suite in this repository and anything automation must hold
	// has to be reachable without a page.
	import { untrack } from 'svelte';
	import { SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import SnippetMark from '$lib/components/SnippetMark.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import { DOCUMENT_ACCEPT } from '$lib/uploads';
	import TagField from '$lib/components/TagField.svelte';
	import TagsPanel from '$lib/components/TagsPanel.svelte';
	import ShelfBanner from '$lib/documents/ShelfBanner.svelte';
	import CoverageView from '$lib/statements/CoverageView.svelte';
	import WalletView from '$lib/documents/WalletView.svelte';
	import DocumentsRail from '$lib/documents/DocumentsRail.svelte';
	import { documentFileHref } from '$lib/ui/file-viewer';
	import {
		ALL_TYPES,
		EXPIRY_VERBS,
		EXPIRY_VERB_MEANINGS,
		IDENTITY_KINDS,
		IDENTITY_KIND_LABELS,
		identityKindLabel,
		mayProposeType,
		typeOptionsFor
	} from '$lib/documents';
	import { countryName, countryOptions, flagEmoji } from '$lib/countries';
	import { LAYOUT_LABELS } from '$lib/shelf-profiles';
	import {
		aboutOptionLabel,
		expiryTreatment,
		groupAboutOptions,
		groupDocuments,
		groupSummary,
		honestyState,
		readableSize,
		rowVariant,
		SOON_DAYS,
		splitSnippet,
		readableDate,
		sortDocuments,
		subLine,
		typeLabel,
		typeLabels,
		type GroupKey,
		type SortKey
	} from '$lib/documents/view';
	import { navigating, page } from '$app/state';
	import { tagHue } from '$lib/tag-hue';
	import { fitChips } from '$lib/actions/fit-chips';

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

	// The rail's edit mode: reorder by dragging, rename by clicking a name,
	// remove through ⋯ — in place, with the list still beside it. No settings
	// screen: managing shelves is a thing done to the rail, not somewhere else.
	// Groups follow the Tax table: closed on arrival, a chevron on every header,
	// and the count on the header is the summary the open group was answering.
	// Three exceptions open a group for you — there is only one, a search is on
	// (results must be visible), or the document open in the inspector is in it.
	let openGroups = new SvelteSet<string>();
	let touchedGroups = $state(false);
	$effect(() => {
		void data.rows;
		void data.group;
		touchedGroups = false;
		openGroups.clear();
	});
	function groupOpen(key: string): boolean {
		if (data.group === 'none' || data.query) return true;
		if (openGroups.has(key)) return true;
		if (touchedGroups) return false;
		if (groups.length === 1) return true;
		return Boolean(
			data.selected &&
			groups.find((g) => g.key === key)?.items.some((i) => i.id === data.selected?.id)
		);
	}
	function toggleGroup(key: string) {
		if (groupOpen(key)) {
			// Closing an implicitly-open group has to be remembered as a closing,
			// not as "no opinion", or it would spring open again on the next read.
			const stillOpen = groups.filter((g) => g.key !== key && groupOpen(g.key)).map((g) => g.key);
			touchedGroups = true;
			for (const k of stillOpen) openGroups.add(k);
			openGroups.delete(key);
		} else {
			openGroups.add(key);
		}
	}

	let confirmingDelete = $state(false);
	let replacing = $state(false);
	/**
	 * The type the FORM currently holds, which is what decides whether the
	 * Identity fields are on screen — `data.selected.type` is what was saved.
	 */
	let editType = $state('other');
	/** The shelf the FORM holds, which decides what the type picker offers. */
	let editShelf = $state('');
	/** Whether the type in the form was put there by a shelf rather than chosen. */
	let typeProposed = $state(false);
	/** Widened past the shelf's own list, for as long as the inspector is open. */
	let allTypes = $state(false);
	/** What this household calls each type: the built-ins, plus its own. */
	const labels = $derived(typeLabels(data.documentTypes));

	/**
	 * The amber window each kind of paper earns, looked up once for the page.
	 *
	 * A map rather than a lookup per row: two hundred documents would otherwise
	 * walk the type list two hundred times to answer the same question, and the
	 * answer only changes when the household edits a type.
	 */
	const reminderDays = $derived(
		new Map(data.documentTypes.map((t) => [t.key, t.reminderDays ?? SOON_DAYS]))
	);
	const editTypeOptions = $derived(
		typeOptionsFor(
			data.shelves.find((s) => s.key === editShelf)?.types ?? [],
			editType,
			labels,
			allTypes
		)
	);
	let numberShown = $state(false);
	/**
	 * The extra-number rows the form is currently showing.
	 *
	 * Local state rather than `$derived`, because the form is being edited: rows
	 * are added and removed before anything is saved, and a derived list would
	 * discard them on the next load. Seeded from the record whenever the
	 * inspector opens on a different document.
	 */
	let extraNumbers = $state<{ label: string; value: string }[]>([]);
	/** The identity fields of the open document, whatever its type says now. */
	const identity = $derived(data.selected?.identityDetail ?? null);
	/**
	 * The layout this shelf offers, or null when there is nothing to switch to.
	 *
	 * `data.shelfLayout` says what the shelf CAN draw and `data.view` says what
	 * it IS drawing. Null while searching, because a search forces the list —
	 * offering the switch there would be a control that undoes itself.
	 */
	const layoutSwitch = $derived(
		!data.query && data.shelfLayout && data.shelfLayout !== 'list' ? data.shelfLayout : null
	);

	$effect(() => {
		// A navigation is what carries new data in; nothing stays armed across it.
		void data.rows;
		confirmingDelete = false;
		selection = [];
		selecting = false;
	});
	$effect(() => {
		// The inspector opens read-only, whichever document it opens on.
		const selected = data.selected;
		editing = false;
		replacing = false;
		overflowOpen = false;
		// A number revealed on one document must not be revealed on the next.
		numberShown = false;
		editType = selected?.type ?? 'other';
		editShelf = selected?.shelfKey ?? '';
		typeProposed = false;
		allTypes = false;
		extraNumbers = (selected?.identityNumbers ?? []).map((n) => ({ ...n }));
	});

	const today = new Date().toISOString().slice(0, 10);
	// What the preview can show inline. Anything else is handed to an iframe,
	// which is what a PDF needs and what everything else degrades to.
	const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];

	function navigate(next: Record<string, string | string[] | null>) {
		const params = new SvelteURLSearchParams(window.location.search);
		for (const [key, value] of Object.entries(next)) {
			params.delete(key);
			if (Array.isArray(value)) for (const v of value) params.append(key, v);
			else if (value !== null && value !== '') params.set(key, value);
		}
		// Opening a different document must not keep the last one's scroll
		// position halfway down the list.
		goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	/**
	 * The parameters that decide WHICH documents the centre column holds.
	 *
	 * Everything else — the year or decade a band is showing, which document the
	 * inspector has open — rearranges what is already there.
	 */
	const ROW_SET_PARAMS = [
		'shelf',
		'q',
		'view',
		'group',
		'sort',
		'type',
		'entity',
		'tag',
		'archived'
	];

	/**
	 * Whether the navigation in flight is worth blanking the column for.
	 *
	 * It is, when the answer is about to be a different set of documents: there
	 * is nothing honest to leave on screen while that loads. It is NOT when only
	 * the year on the coverage ribbon changed — the table keeps its shape and
	 * every row, and replacing it with three grey blocks for the length of a
	 * query made stepping through years flicker hard enough to be unusable.
	 */
	const reloading = $derived.by(() => {
		const to = navigating.to;
		if (!to) return false;
		const now = page.url.searchParams;
		const next = to.url.searchParams;
		return ROW_SET_PARAMS.some(
			(key) => now.getAll(key).join('\u0000') !== next.getAll(key).join('\u0000')
		);
	});

	const groups = $derived(
		groupDocuments(
			sortDocuments(data.rows, data.sort as SortKey),
			data.group as GroupKey,
			today,
			labels
		)
	);
	const groupHeading = $derived(
		{ type: 'Type', entity: 'About', year: 'Year', expiry: 'Expiry', none: '' }[
			data.group as GroupKey
		] ?? ''
	);
	const shelfLabel = $derived(
		data.shelves.find((s) => s.key === data.shelf)?.label ?? 'Everything'
	);
	const captureShelf = $derived(data.prefill.shelf || 'inbox');
	const captureShelfLabel = $derived(
		data.shelves.find((s) => s.key === captureShelf)?.label ?? 'Inbox'
	);

	// A contextual add arrives pre-addressed. The pickable half of that is a
	// chip already ticked in the capture picker; the rest — a transaction, a tax
	// statement — has no list to be ticked in and travels as a hidden input, so
	// the two halves are kept apart here rather than posting the same id twice.
	const prefilled = $derived(new Set(data.prefill.targets.map((t) => t.id)));
	const prefillReadOnly = $derived(data.prefill.targets.filter((t) => !t.pickable));

	const toggleSelected = (id: string) =>
		(selection = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);

	// Read-only chips a person has taken off, until Save. They are not checkboxes
	// — there is no list of every transaction to tick one out of — so removing
	// one means the chip and its hidden input leave the form, and the diff on the
	// server sees a link the form no longer names.
	let unlinked = $state<string[]>([]);
	$effect(() => {
		// A fresh editor each time it opens, and on a different document: a chip
		// somebody removed and then cancelled must not come back removed.
		void editing;
		void data.selected?.id;
		unlinked = [];
	});

	/** One chip: enough to draw it and to post it. */
	interface AboutChip {
		id: string;
		name: string;
		meta?: string;
	}

	/**
	 * Every link the open document has, under the heading its kind belongs to.
	 *
	 * Pickable kinds come from the registry's list, so a chip appears for a
	 * record whether or not the document is filed against it yet. The kinds the
	 * document side may NOT pick come from the document's own links, because
	 * there is no list to offer — and they are here at all because a save posts
	 * what the form holds, and a link with no chip is a link a save forgets.
	 */
	const aboutGroups = $derived.by(() => {
		const groups: { label: string; pickable: boolean; items: AboutChip[] }[] = [];
		const groupFor = (label: string, pickable: boolean) => {
			const existing = groups.find((g) => g.label === label);
			if (existing) return existing;
			const fresh = { label, pickable, items: [] as AboutChip[] };
			groups.push(fresh);
			return fresh;
		};
		for (const target of data.pickableTargets) groupFor(target.groupLabel, true).items.push(target);
		for (const link of data.selected?.links ?? []) {
			if (link.pickable || unlinked.includes(link.id)) continue;
			groupFor(link.groupLabel, false).items.push(link);
		}
		return groups.filter((g) => g.items.length > 0);
	});
</script>

<ScreenHeader
	title="Documents"
	caption="One archive for the household. Shelf is where in life, type is what kind, links are what it concerns."
/>

{#if form?.message}
	<!-- The same slot carries a refusal and a report. A bulk edit that skipped a
	     payslip did what was asked of it everywhere else, so it is amber and
	     announced as a status; a refusal stays red and is announced as an alert. -->
	<div class="error" class:notice={form?.ok} role={form?.ok ? 'status' : 'alert'}>
		{form.message}
	</div>
{/if}

{#if form?.ok && form?.addedIds?.length}
	<div class="ack">
		<Pill hue="green">
			Added {form.addedIds.length > 1 ? `${form.addedIds.length} to` : 'to'}
			{form.addedShelf === 'inbox' ? 'Inbox' : form.addedShelf}
		</Pill>
		{#if form.addedIds.length === 1}
			<button
				type="button"
				class="link"
				onclick={() => navigate({ doc: form.addedIds[0], add: null })}
			>
				File it now
			</button>
		{:else}
			<a class="link" href="/documents/review">Review them now</a>
		{/if}
	</div>
{/if}

{#if data.bannerFacts}
	<!-- Above the toolbar, because it describes the shelf the toolbar is about
	     to filter. Absent on "Everything" and while searching: neither is a
	     shelf, and a banner over search results would be describing the one you
	     left. -->
	<ShelfBanner
		shelfKey={data.shelf}
		label={shelfLabel}
		emoji={data.shelves.find((s) => s.key === data.shelf)?.emoji ?? '🗂️'}
		system={data.shelves.find((s) => s.key === data.shelf)?.system ?? false}
		facts={data.bannerFacts}
		emptyHint={data.emptyHint}
	/>
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

	{#if layoutSwitch}
		<!-- Two segments and no third state: the shelf's own layout, or the list
		     it would otherwise be. A search removes this control rather than
		     disabling it, because a search always renders the list. -->
		<Segmented
			options={[
				{ value: 'shelf', label: LAYOUT_LABELS[layoutSwitch] },
				{ value: 'list', label: LAYOUT_LABELS.list }
			]}
			value={data.view === 'shelf' ? 'shelf' : 'list'}
			onchange={(value) => navigate({ view: value === 'list' ? 'list' : null })}
		/>
	{/if}

	<!-- Absent while a layout is showing, not disabled. None of the three has a
	     meaning against a wallet: the layout already decided the grouping and
	     the order, and bulk selection is a list gesture. They come back with
	     the list, one click away. -->
	{#if data.view !== 'shelf'}
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
			onchange={(value) => navigate({ group: value === data.defaultGroup ? null : value })}
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
	{/if}
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
		<!-- Capture REQUIRES nothing. A file, a generated name, the Inbox — filing
		     is a separate decision made later, or never. What it now offers is
		     the same picker the inspector draws, because the person who has just
		     scanned a lease usually knows whose lease it is, and a second pass to
		     say so is a second pass most paper never gets. -->
		<input type="hidden" name="shelf" value={captureShelf} />
		<!-- What the screen that sent us here already knows, and could not be
		     ticked in a list: the transaction a receipt was captured from. A
		     hidden input and a chip that states it, since there is no list of
		     every transaction to tick it out of. The pickable half of a prefill
		     is a ticked chip below instead — one input per link, never two. -->
		{#each prefillReadOnly as target (target.id)}
			<input type="hidden" name="linkIds" value={target.id} />
		{/each}
		<UploadDropzone
			name="file"
			accept={DOCUMENT_ACCEPT}
			multiple
			idleText="Drop files here, or click to browse"
			description="PDF, images, text and spreadsheets — several at once is fine"
		/>
		<div class="sec capture-about">
			<span class="eyebrow">About — optional</span>
			<div class="about">
				<!-- Registry order: the kinds the document side may pick, then the
				     prefill's read-only groups after — the same order `aboutGroups`
				     above puts them in for the inspector. A transaction is
				     deliberately absent from the pickable half: a list of every
				     payment the household has made is a list nobody can search by
				     eye, which is exactly why it arrives as a read-only prefill chip
				     instead. -->
				{#each groupAboutOptions(data.pickableTargets) as group (group.label)}
					<div class="about-group">
						<span class="mono about-kind">{group.label}</span>
						<div class="chips">
							{#each group.options as target (target.id)}
								<label class="pick-chip">
									<input
										type="checkbox"
										name="linkIds"
										value={target.id}
										checked={prefilled.has(target.id)}
									/>
									<span>{target.name}</span>
								</label>
							{/each}
						</div>
					</div>
				{/each}
				{#each groupAboutOptions(prefillReadOnly) as group (group.label)}
					<div class="about-group">
						<span class="mono about-kind">{group.label}</span>
						<div class="chips">
							{#each group.options as target (target.id)}
								<span class="link-chip">
									<span>{target.name}</span>
									{#if target.meta}<span class="quiet chip-meta">{target.meta}</span>{/if}
								</span>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			<!-- A subject nobody has made yet. The server upserts by name, so
			     typing one that already exists files against it rather than
			     making a second. -->
			<input name="newSubject" placeholder="Or a new subject — the boiler, the old car…" />
		</div>
		<div class="capture-foot">
			<span class="quiet">
				They go to {captureShelfLabel} with their own names. Everything above is optional.
			</span>
			<button type="submit" class="btn btn-primary">Add</button>
			<button type="button" class="btn" onclick={() => (capturing = false)}>Cancel</button>
		</div>
	</form>
{/if}

<section class="layout" class:with-inspector={data.selected}>
	<DocumentsRail {data} {navigate} />

	<div class="area">
		{#if data.view === 'tags' && data.tagsScreen}
			<TagsPanel screen={data.tagsScreen} message={form?.message} />
		{:else}
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

			{#if data.rows.length > 0 || data.filters.tags.length || data.filters.type || data.filters.entity}
				<!-- Filters narrow the list and never the rail. Each offers only what is
			     on the shelf in view, with the count it would leave, so no choice
			     empties the screen. Every filter is in the URL: a bookmark is the
			     saved view. -->
				<div class="filters">
					<select
						class="filter"
						aria-label="Filter by type"
						value={data.filters.type}
						onchange={(e) => navigate({ type: e.currentTarget.value, doc: null })}
					>
						<option value="">Type · any</option>
						{#each data.filterOptions.types as t (t.code)}
							<option value={t.code}>{typeLabel(t.code, labels)} · {t.count}</option>
						{/each}
					</select>
					<select
						class="filter"
						aria-label="Filter by what it is about"
						value={data.filters.entity}
						onchange={(e) => navigate({ entity: e.currentTarget.value, doc: null })}
					>
						<option value="">About · anything</option>
						<!-- Grouped, because every registered kind reaches this list now:
						     "Alza 2026-03-04" between "Robert" and "Vinohrady flat" says
						     nothing about which is a person and which is a payment. The
						     order is the load's; the view only buckets it. -->
						{#each groupAboutOptions(data.filterOptions.entities) as group (group.label)}
							<optgroup label={group.label}>
								{#each group.options as e (e.id)}
									<option value={e.id}>{aboutOptionLabel(e)}</option>
								{/each}
							</optgroup>
						{/each}
					</select>
					<div class="tag-filter">
						<TagField
							tags={[...data.filters.tags]}
							known={data.filterOptions.tags.map((t) => t.name)}
							placeholder={data.filters.tags.length ? 'and…' : 'Filter by tag…'}
							onchange={(tags) => navigate({ tag: tags, doc: null })}
						/>
					</div>
					{#if data.filters.tags.length || data.filters.type || data.filters.entity}
						<button
							type="button"
							class="link"
							onclick={() => navigate({ tag: null, type: null, entity: null })}
						>
							Clear filters
						</button>
					{/if}
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
						{#each Object.entries(labels) as [code, label] (code)}
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

			{#if reloading}
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
						<UploadDropzone
							name="file"
							accept={DOCUMENT_ACCEPT}
							multiple
							idleText="Drop files here, or click to browse"
						/>
						<button type="submit" class="btn btn-primary">Add</button>
					</form>
				{:else}
					<div class="empty">
						<p class="empty-title">Nothing on {shelfLabel} yet.</p>
						{#if data.emptyHint}
							<!-- What the shelf is for, in its own words: an empty shelf is the
							     one moment somebody is asking what belongs on it. -->
							<p class="quiet">{data.emptyHint}</p>
						{/if}
						<p class="quiet">
							Add a document from the toolbar and it lands in the Inbox — file it here from there.
						</p>
					</div>
				{/if}
			{:else if data.view === 'shelf' && data.layout === 'wallet'}
				<!-- Same rows, same inspector: a card is another way into the document
				     the list would have opened, not another screen. -->
				<WalletView
					rows={data.rows}
					people={data.householdPeople}
					{labels}
					{reminderDays}
					{today}
					selectedId={data.selected?.id}
					onopen={(id) => navigate({ doc: id })}
				/>
			{:else if data.view === 'shelf' && data.layout === 'completeness' && data.coverage}
				<!-- The one shelf drawn by what it is MISSING. Same inspector: a band
				     is another way into the document the list would have opened. -->
				<CoverageView
					coverage={data.coverage}
					onopen={(id) => navigate({ doc: id })}
					onyear={(year) => navigate({ year: String(year) })}
					ondecade={(firstYear) => navigate({ decade: String(firstYear) })}
				/>
			{:else}
				{#if honestyState(data.query, data.rows.length, data.honesty) === 'not-searchable'}
					<p class="quiet">
						<span class="mono">{data.honesty?.notSearchable}</span> documents cannot be searched by contents
						— photographs and scans without a text layer are matched on name, note and tags only.
					</p>
				{/if}
				<div class="matrix">
					{#if data.group !== 'none'}
						<!-- The same header the Tax and Salary tables carry: what each column
						     of a collapsed row means, so a closed group still says something. -->
						<div class="mhead">
							<span class="h-cell">{groupHeading}</span>
							<span class="h-cell right">Documents</span>
							<span class="h-cell right">Attention</span>
							<span class="h-cell right">Next expiry</span>
						</div>
					{/if}
					{#each groups as g (g.key)}
						{@const open = groupOpen(g.key)}
						{@const summary = groupSummary(g.items, today)}
						<div class="group" class:open>
							{#if g.label}
								<button
									type="button"
									class="group-head"
									class:open
									aria-expanded={open}
									onclick={() => toggleGroup(g.key)}
								>
									<span class="group-label">
										<span class="chevron" class:open>{open ? '▼' : '▶'}</span>
										{g.label}
									</span>
									<span class="cell right"><span class="mono c-main">{summary.count}</span></span>
									<span class="cell right">
										{#if summary.expired}
											<span class="c-main mono" style:color="var(--red)"
												>{summary.expired} expired</span
											>
										{/if}
										{#if summary.soon}
											<span class="c-sub mono" style:color="var(--yellow)">{summary.soon} soon</span
											>
										{/if}
										{#if !summary.expired && !summary.soon}<span class="absent">·</span>{/if}
									</span>
									<span class="cell right">
										{#if summary.nextExpiry}
											<span class="mono c-main">{readableDate(summary.nextExpiry)}</span>
										{:else}
											<span class="absent">·</span>
										{/if}
									</span>
								</button>
							{/if}
							{#each open ? g.items : [] as d (d.id)}
								{@const expiry = expiryTreatment(
									d,
									d.subjectArchived,
									today,
									'wide',
									reminderDays.get(d.type)
								)}
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
													<span class="lock"><Icon name="lock" size={13} label="Restricted" /></span
													>
												{/if}
												{#if d.subjectArchived}
													<span class="chip">Archived subject</span>
												{/if}
											</span>
											<span class="sub">
												<span class="sub-text">{subLine(d)}</span>
												{#if d.tags.length}
													<!-- As many as fit on the line, the rest counted. -->
													<span class="row-tags" use:fitChips={d.tags}>
														{#each d.tags as tagName (tagName)}<span
																class="chip tag"
																data-chip
																style:color="var({tagHue(tagName)})"
																style:border-color="color-mix(in srgb, var({tagHue(tagName)}) 45%,
																transparent)">{tagName}</span
															>{/each}
														<span class="chip tag" data-more hidden></span>
													</span>
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
													{variant === 'content' ? 'Matched in contents' : 'Matched in note'}{d
														.match.pageNo
														? ` · page ${d.match.pageNo}`
														: ''}
												</span>
											{/if}
										</span>
										<span class="expiry">
											{#if expiry?.kind === 'pill'}
												<Pill hue={expiry.hue}>{expiry.text}</Pill>
											{:else if expiry}
												<span class="mono outline-pill">{expiry.text}</span>
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
				</div>
			{/if}
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
					<UploadDropzone name="file" accept={DOCUMENT_ACCEPT} idleText="Attach file" />
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
					<UploadDropzone
						name="file"
						accept={DOCUMENT_ACCEPT}
						idleText="Drop the replacement here, or click to browse"
					/>
					<div class="ins-actions">
						<button type="submit" class="btn btn-primary">Replace</button>
						<button type="button" class="btn" onclick={() => (replacing = false)}>Cancel</button>
					</div>
				</form>
			{/if}

			<!-- 3. Actions. Open file outranks the menu by fill and by width; on a
			     metadata-only document it is ABSENT rather than disabled, and Edit
			     becomes primary. -->
			<!-- The preview above is the way to the file, so the one action here is
			     Edit. Download stays in the menu for a person who wants the bytes. -->
			{#if !editing}
				<div class="ins-primary">
					{#if d.shelfKey === 'inbox'}
						<!-- Unfiled paper opened from the Inbox: the one thing anybody
						     wants here is to file it, and sending them back to Everything
						     to press Review inbox is three navigations to reach a shelf
						     picker that is already two fields down this panel. Same edit
						     form, opened at the question being asked. -->
						<button type="button" class="btn btn-primary ins-edit" onclick={() => (editing = true)}>
							File it
						</button>
						<a class="btn" href="/documents/review">Review inbox →</a>
					{:else}
						<button type="button" class="btn btn-primary ins-edit" onclick={() => (editing = true)}>
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
					<!-- Where Edit was, not at the foot of the form.
					     Editing replaces the Edit button rather than appending a row
					     below fifteen fields: pressing Edit and then having to scroll
					     to the bottom to save is two journeys for one decision, and on
					     a long document the buttons were off the screen entirely. -->
					<div class="ins-actions ins-actions-top">
						<button type="submit" class="btn btn-primary">Save</button>
						<button type="button" class="btn" onclick={() => (editing = false)}>Cancel</button>
					</div>
					<div class="sec">
						<span class="eyebrow">Name</span>
						<input name="name" value={d.name} />
					</div>
					<div class="sec">
						<span class="eyebrow">Shelf</span>
						<!-- Bound, because the shelf decides what the Type picker below
						     offers — the same behaviour the inbox review screen has, so
						     filing from here and filing from there are one thing done in
						     two places rather than two things. -->
						<select
							name="shelf"
							value={editShelf}
							onchange={(e) => {
								editShelf = e.currentTarget.value;
								const first = data.shelves.find((s) => s.key === editShelf)?.types?.[0];
								if (first && mayProposeType(editType, typeProposed)) {
									editType = first;
									typeProposed = true;
								}
							}}
						>
							{#each data.shelves.filter((s) => s.key !== 'all') as s (s.key)}
								<option value={s.key}>{s.label}</option>
							{/each}
						</select>
					</div>
					<div class="sec">
						<span class="eyebrow">Type</span>
						<!-- Bound rather than set once: the Identity fields below appear
						     the moment the type says they apply, so somebody filing a
						     passport does not save, reopen and edit again to reach them. -->
						<select
							name="type"
							value={editType}
							onchange={(e) => {
								if (e.currentTarget.value === ALL_TYPES) {
									allTypes = true;
									e.currentTarget.value = editType;
									return;
								}
								editType = e.currentTarget.value;
								// Chosen, so no shelf may overwrite it from here on.
								typeProposed = false;
							}}
						>
							{#each editTypeOptions as [code, label] (code)}
								<option value={code}>{label}</option>
							{/each}
							{#if !allTypes && editTypeOptions.length < Object.keys(labels).length}
								<option value={ALL_TYPES}>Show all types…</option>
							{/if}
						</select>
					</div>
					{#if editType === 'id_document'}
						<div class="sec">
							<span class="eyebrow">Identity</span>
							<!-- Typed by hand, every field optional. Nothing reads the
							     document to fill these in: a number a recogniser guessed
							     wrong is worse than an empty box, because it is believed. -->
							<div class="id-grid">
								<label class="id-field">
									<span class="quiet">Kind</span>
									<select name="identityKind" value={identity?.kind ?? 'other'}>
										{#each IDENTITY_KINDS as kind (kind)}
											<option value={kind}>{IDENTITY_KIND_LABELS[kind]}</option>
										{/each}
									</select>
								</label>
								<label class="id-field">
									<span class="quiet">Country</span>
									<select name="identityCountry" value={identity?.country ?? ''}>
										<option value="">—</option>
										{#each countryOptions() as c (c.code)}
											<option value={c.code}>{c.name}</option>
										{/each}
									</select>
								</label>
								<label class="id-field">
									<span class="quiet">Number</span>
									<input class="mono" name="identityNumber" value={identity?.number ?? ''} />
								</label>
								<label class="id-field">
									<span class="quiet">Issued on</span>
									<input type="date" name="identityIssuedOn" value={identity?.issuedOn ?? ''} />
								</label>
								<label class="id-field wide">
									<span class="quiet">Issuer</span>
									<input name="identityIssuer" value={identity?.issuer ?? ''} />
								</label>
							</div>

							<!-- One document really can carry several numbers — a residence
							     permit with a card number and a personal number, a licence
							     with a national identifier beside it — and there is no
							     sensible ceiling to guess at, so the household adds as many
							     as it has. Clearing both halves of a row is how one goes:
							     Save writes exactly what the form holds. -->
							<div class="id-extra">
								{#each extraNumbers as extra, i (i)}
									<div class="id-extra-row">
										<input
											name="identityExtraLabel"
											placeholder="What it is called"
											value={extra.label}
										/>
										<input
											class="mono"
											name="identityExtraValue"
											placeholder="Number"
											value={extra.value}
										/>
										<button
											type="button"
											class="chip-x"
											aria-label="Remove {extra.label || 'this number'}"
											onclick={() => (extraNumbers = extraNumbers.filter((_, at) => at !== i))}
											>✕</button
										>
									</div>
								{/each}
								<button
									type="button"
									class="link id-add"
									onclick={() => (extraNumbers = [...extraNumbers, { label: '', value: '' }])}
								>
									+ Add another number
								</button>
							</div>
						</div>
					{/if}
					<div class="sec">
						<span class="eyebrow">About</span>
						<!-- Chips, grouped by what kind of thing they are. A chip is as wide
						     as its name, so a street address and a first name share one flow
						     without a grid forcing them to the same width. -->
						<div class="about">
							{#each aboutGroups as group (group.label)}
								<div class="about-group">
									<span class="mono about-kind">{group.label}</span>
									<div class="chips">
										{#each group.items as target (target.id)}
											{#if group.pickable}
												<label class="pick-chip">
													<input
														type="checkbox"
														name="linkIds"
														value={target.id}
														checked={d.links.some((l) => l.id === target.id)}
													/>
													<span>{target.name}</span>
												</label>
											{:else}
												<!-- Filed from its own screen, where the row was already in
												     front of the person. Shown as a fact with a way out, not
												     as one option among every transaction in the household.
												     The hidden input is what makes Save keep it. -->
												<span class="link-chip">
													<input type="hidden" name="linkIds" value={target.id} />
													<span>{target.name}</span>
													{#if target.meta}<span class="quiet chip-meta">{target.meta}</span>{/if}
													<button
														type="button"
														class="chip-x"
														aria-label="Unlink {target.name}"
														onclick={() => (unlinked = [...unlinked, target.id])}>✕</button
													>
												</span>
											{/if}
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</div>
					<div class="sec">
						<span class="eyebrow">Expiry</span>
						<div class="expiry-grid">
							<select name="expiryVerb" value={d.expiryVerb}>
								{#each EXPIRY_VERBS as verb (verb)}<option value={verb}
										>{verb} — {EXPIRY_VERB_MEANINGS[verb]}</option
									>{/each}
							</select>
							<!-- Native date input, never a text mask: 12/01/2027 is a
							     DD/MM-vs-MM/DD bug waiting to happen in a Czech household. -->
							<input type="date" name="expiresOn" value={d.expiresOn ?? ''} />
						</div>
					</div>
					{#if d.type === 'bank_statement'}
						<!-- Which months this statement covers, for one nobody imported.
						     An accepted import fills both from the file, so these are
						     almost always already answered — but the reader refuses more
						     scanned statements than it reads, and a person holding a scan
						     their bank really sent has nowhere else to say which month it
						     is. Without them the document is filed and invisible: the
						     coverage ribbon draws periods, and nothing but an import can
						     write one. -->
						<div class="sec">
							<span class="eyebrow">Covers</span>
							<div class="expiry-grid">
								<input
									type="date"
									name="periodOn"
									value={d.periodOn ?? ''}
									aria-label="First day covered"
								/>
								<input
									type="date"
									name="periodEndOn"
									value={d.periodEndOn ?? ''}
									aria-label="Last day covered"
								/>
							</div>
						</div>
					{/if}
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
							<!-- Its own bordered row: the one decision on the form that
							     changes who can see the document. -->
							<label class="restricted">
								<input
									type="checkbox"
									name="sensitivity"
									value="restricted"
									checked={d.sensitivity === 'restricted'}
								/>
								<span class="lock"><Icon name="lock" size={15} /></span>
								<span class="restricted-text">
									<span class="restricted-title">Restricted — admins only</span>
									<span class="quiet">Absent for household members, not locked.</span>
								</span>
							</label>
						</div>
					{/if}
				</form>
			{:else}
				<div class="ins-sections">
					<div class="sec">
						<span class="eyebrow">Filed in</span><span class="val">{d.shelfLabel}</span>
					</div>
					<div class="sec">
						<span class="eyebrow">Type</span><span class="val">{typeLabel(d.type, labels)}</span>
					</div>
					{#if d.type === 'id_document'}
						<!-- Masked until asked for, and the same button whether it is the
						     document's own number or one of the extra ones beside it. The
						     inspector is the only place a number appears at all, and it is
						     read across a room as often as it is read by the person who
						     opened it — so one reveal, one mask, written once. -->
						{#snippet maskedNumber(value: string)}
							<button
								type="button"
								class="id-number mono"
								aria-label={numberShown ? 'Hide document number' : 'Show document number'}
								onclick={() => (numberShown = !numberShown)}
							>
								{numberShown ? value : '•'.repeat(value.length)}
							</button>
						{/snippet}
						<div class="sec">
							<span class="eyebrow">Identity</span>
							<span class="val id-read">
								<span class="id-line">
									{#if identity?.country}
										<span class="id-flag">{flagEmoji(identity.country)}</span>
										<span>{countryName(identity.country)}</span>
										<span class="quiet">·</span>
									{/if}
									<!-- The type already says "Identity document" two rows up, so
									     a kind of `other` adds nothing here and is left out. -->
									<span>{identityKindLabel(identity?.kind) ?? typeLabel(d.type, labels)}</span>
								</span>
								{#if identity?.number}
									{@render maskedNumber(identity.number)}
								{/if}
								{#each data.selected?.identityNumbers ?? [] as extra (extra.label + extra.value)}
									<span class="id-line">
										<span class="quiet id-sub">{extra.label}</span>
										{@render maskedNumber(extra.value)}
									</span>
								{/each}
								{#if identity?.issuedOn}
									<span class="quiet id-sub">
										Issued <span class="mono">{readableDate(identity.issuedOn)}</span>
										{#if identity.issuer}· {identity.issuer}{/if}
									</span>
								{:else if identity?.issuer}
									<span class="quiet id-sub">{identity.issuer}</span>
								{/if}
							</span>
						</div>
					{/if}
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
	/* Something was left as it was, on purpose. Amber is work, not an error —
	   the same distinction the Inbox count draws. */
	.error.notice {
		border-color: var(--yellow);
		background: var(--yellow-tint);
		color: var(--yellow);
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
		padding: var(--space-4) var(--space-5);
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
	/* The inspector's own About block, in the capture card. No rule under it:
	   `.sec:last-of-type` cannot see it as last, because the foot below is a
	   div too. */
	.capture-about {
		border-bottom: 0;
		padding-bottom: 0;
	}
	/* A household with two hundred contacts must not push the list off the
	   screen to offer them. The chips scroll inside the card instead. */
	.capture-about .about {
		max-height: 224px;
		overflow-y: auto;
		overscroll-behavior: contain;
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
	.filters {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
	}
	.filter {
		height: var(--control-h);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--fg1);
		padding: 0 10px;
		font-size: var(--text-md);
		max-width: 240px;
	}
	.tag-filter {
		flex: 1 1 260px;
		max-width: 520px;
	}
	.bulk {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--card);
		padding: var(--space-5) var(--space-7);
	}
	.matrix {
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--card);
		overflow: hidden;
	}
	.mhead,
	.group-head {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 90px 130px 130px;
		align-items: center;
		gap: var(--space-5);
		padding: 10px var(--space-6);
	}
	.mhead {
		background: var(--card2);
		border-bottom: 1px solid var(--bd2);
	}
	.h-cell {
		font-size: var(--text-xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg3);
		min-width: 0;
	}
	.right {
		justify-content: flex-end;
		text-align: right;
		align-items: flex-end;
	}
	.group {
		border-bottom: 1px solid var(--bd);
	}
	.group:last-child {
		border-bottom: 0;
	}
	.group-head {
		width: 100%;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
		/* The Tax table's open mark: a bar in the row's own edge. */
		box-shadow: inset 3px 0 0 transparent;
	}
	.group-head:hover {
		background: var(--card2);
	}
	.group-head.open {
		box-shadow: inset 3px 0 0 var(--teal);
		border-bottom: 1px solid var(--bd);
	}
	.group-label {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-lg);
		color: var(--fg1);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chevron {
		font-size: 9px;
		color: var(--fg3);
		flex: none;
	}
	.chevron.open {
		color: var(--teal);
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.c-main {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.c-sub {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.absent {
		color: var(--bd2);
	}
	.row {
		position: relative;
		border-bottom: 1px solid var(--bd);
		padding-left: var(--space-6);
	}
	.group .row:last-child {
		border-bottom: 0;
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
	.sub-text {
		flex: none;
		max-width: 60%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.row-tags {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		overflow: hidden;
		margin-left: var(--space-2);
	}
	.row-tags .chip {
		flex: none;
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
	/* The same shape as `Pill`, without the fill: a date nobody has to act on.
	   Matches Pill's own geometry so the column lines up. */
	.outline-pill {
		display: inline-block;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-xl);
		padding: var(--space-1) var(--space-5);
		font-size: var(--text-xs);
		line-height: 1.2;
		color: var(--fg3);
		white-space: nowrap;
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
		/* Two scrollable things on one screen, and without this they take turns:
		   reaching the end of the panel handed the wheel to the list behind it,
		   so scrolling the inspector scrolled the archive, and scrolling back up
		   moved the wrong one first. `contain` stops at this panel's own end. */
		overscroll-behavior: contain;
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
		/* Never shrunk to make room for what is below it. The panel is a flex
		   column with a viewport-bounded height, so every item in it is
		   shrinkable by default: on a short screen — or once a document carries
		   enough sections — the preview gave up its height first and became an
		   87px sliver of a photograph, which reads as a failed load rather than
		   as a full panel. The sections scroll instead, which is what
		   `overflow-y: auto` on the panel is for. */
		flex: none;
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
	/* Named for what it is, not `.open`: that class is the open-group modifier
	   on the list beside this panel, and a bare `.open { flex: 1 }` was
	   stretching the group header's first column. */
	.ins-edit {
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
	.sec label.restricted {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-5) var(--space-6);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card2);
		cursor: pointer;
	}
	.sec .restricted input {
		height: auto;
		width: 16px;
		padding: 0;
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
	.expiry-grid {
		display: grid;
		grid-template-columns: 108px minmax(0, 1fr);
		gap: var(--space-4);
	}
	/* Five fields in two columns, the issuer across both: a kind, a country and
	   a date are all short, and an issuing authority is a sentence. */
	.id-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-4);
	}
	.id-field {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: var(--text-xs);
	}
	.id-field.wide {
		grid-column: 1 / -1;
	}
	.id-extra {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: var(--space-4);
	}
	/* Name and number on one line, with the way to remove it at the end: the
	   pair is one fact, and stacking them would read as two. */
	.id-extra-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-4);
	}
	.id-add {
		align-self: flex-start;
		font-size: var(--text-xs);
	}
	.id-read {
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 3px;
		padding-top: var(--space-4);
		padding-bottom: var(--space-4);
	}
	.id-line {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--space-3);
	}
	.id-flag {
		font-size: var(--text-xl);
		line-height: 1;
	}
	/* A button because it does something, styled as the value it hides: the
	   dots are the number's own length, so revealing it moves nothing. */
	.id-number {
		min-height: auto;
		padding: 0;
		border: 0;
		background: none;
		color: var(--fg2);
		font-size: var(--text-md);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.id-number:hover {
		color: var(--fg1);
	}
	.id-sub {
		font-size: var(--text-xs);
	}
	.ins-actions {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-5);
		padding-top: var(--space-5);
	}
	/* The edit form's own row sits at the TOP, in the Edit button's place — so it
	   occupies that button's footprint: full width, split in two. The form's own
	   padding already matches `.ins-primary`'s margin, so no margin here.
	   Left-aligned and shrink-wrapped, the pair read as a different control that
	   happened to appear rather than as the one just pressed. */
	.ins-actions-top {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-5);
		padding-top: 0;
		padding-bottom: var(--space-5);
	}
	.ins-actions-top .btn {
		width: 100%;
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
	/* A link that is already there. It reads as a CHECKED `.pick-chip` — the
	   shared mark in app.css — because that is what it is; what differs is that
	   the way off it is the ✕, not a tick, so it is not a control. */
	.link-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		height: 28px;
		padding: 0 var(--space-6);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-chip);
		background: var(--card3);
		color: var(--fg1);
		font-size: var(--text-sm);
		cursor: default;
		white-space: nowrap;
	}
	.chip-meta {
		font-size: var(--text-2xs);
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
