<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { SHELVES } from '$lib/documents';
	import { syncedDocumentState } from '$lib/ui/state';

	let { data, form } = $props();

	let query = $state(data.query);
	let adding = $state(data.prefill.open);
	let newSubjectOpen = $state(false);
	$effect(() => {
		const state = syncedDocumentState({ query: data.query, prefillOpen: data.prefill.open });
		query = state.query;
		adding = state.adding;
		newSubjectOpen = false;
	});

	function navigate(shelf: string, q: string, tag = '') {
		const parts: string[] = [];
		if (shelf !== 'all') parts.push(`shelf=${encodeURIComponent(shelf)}`);
		if (q) parts.push(`q=${encodeURIComponent(q)}`);
		if (tag) parts.push(`tag=${encodeURIComponent(tag)}`);
		goto(`?${parts.join('&')}`, { keepFocus: true, noScroll: true });
	}
</script>

<ScreenHeader
	emoji="🗂️"
	title="Documents"
	caption="One archive for the household — columns follow whoever the documents are about."
/>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<section class="toolbar">
	<input
		type="text"
		bind:value={query}
		placeholder="Search by name, person, flat, year or tag"
		onkeydown={(e) => e.key === 'Enter' && navigate(data.shelf, query)}
	/>
	<button
		type="button"
		class="btn"
		onclick={() => {
			query = '';
			navigate(data.shelf, '');
		}}
	>
		Clear
	</button>
	<button type="button" class="btn btn-primary add" onclick={() => (adding = !adding)}>
		➕ Add document
	</button>
</section>

{#if adding}
	<form
		method="POST"
		action="?/addDocument"
		use:enhance
		enctype="multipart/form-data"
		class="card add-form"
	>
		<div class="grid">
			<label><span>Name</span><input name="name" placeholder="Passport · Robert" /></label>
			<label
				><span>Shelf</span>
				<select name="shelf">
					{#each SHELVES as s (s.key)}
						<option value={s.key} selected={s.key === data.prefill.shelf}>{s.label}</option>
					{/each}
				</select></label
			>
			<div class="field belongs">
				<span>Belongs to</span>
				<div class="belong-groups">
					{#each data.people as p (p.id)}
						<label class="tick">
							<input
								type="checkbox"
								name="personIds"
								value={p.id}
								checked={data.prefill.personId === p.id}
							/>
							{p.name}
						</label>
					{/each}
					{#each data.properties as pr (pr.id)}
						<label class="tick">
							<input
								type="checkbox"
								name="propertyIds"
								value={pr.id}
								checked={data.prefill.propertyId === pr.id}
							/>
							{pr.name}
						</label>
					{/each}
					{#each data.accounts as a (a.id)}
						<label class="tick">
							<input type="checkbox" name="accountIds" value={a.id} />
							{a.name}
						</label>
					{/each}
					{#each data.subjects as s (s.id)}
						<label class="tick">
							<input type="checkbox" name="subjectIds" value={s.id} />
							{s.name}
						</label>
					{/each}
					{#if newSubjectOpen}
						<input
							class="new-subject"
							name="newSubject"
							placeholder="Car, Dog, …"
							aria-label="New subject name"
						/>
					{:else}
						<button
							type="button"
							class="btn tick-add"
							onclick={() => (newSubjectOpen = true)}
							aria-label="New subject"
						>
							＋ new subject
						</button>
					{/if}
				</div>
			</div>
			<label><span>File (optional)</span><input name="file" type="file" /></label>
			<div class="field">
				<span>Expiry (optional)</span>
				<div class="expiry">
					<select name="expiryVerb" aria-label="Expiry kind">
						<option value="expires">expires</option>
						<option value="ends">ends</option>
						<option value="renews">renews</option>
						<option value="due">due</option>
					</select>
					<input name="expiresOn" type="date" aria-label="Expiry date" />
				</div>
			</div>
			<label
				><span>Tags (comma separated)</span><input
					name="tags"
					placeholder="e.g. vaccination, lab, dentist"
				/></label
			>
		</div>
		<div class="row">
			<button type="submit" class="btn btn-primary">Add</button>
			<button type="button" class="btn" onclick={() => (adding = false)}>Cancel</button>
		</div>
	</form>
{/if}

<section class="layout">
	<div class="rail">
		<Eyebrow emoji="🗂️" label="Shelves" />
		<div class="shelves">
			{#each data.shelves as s (s.key)}
				<button
					type="button"
					class="shelf"
					class:active={data.shelf === s.key}
					onclick={() => navigate(s.key, query)}
				>
					<span class="s-label">{s.label}</span>
					<span class="mono s-count">{s.count}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="area">
		<div class="eyebrow-row">
			<span class="eyebrow">
				{data.shelves.find((s) => s.key === data.shelf)?.label ?? 'Everything'}
			</span>
			<span class="eyebrow-caption">
				{data.total === 0
					? 'nothing here yet'
					: `${data.total} document${data.total === 1 ? '' : 's'} · columns derive from who they are about`}
			</span>
		</div>
		{#if data.tags.length}
			<div class="tag-chips">
				{#each data.tags as t (t.name)}
					<button
						type="button"
						class="tag-chip"
						class:active={t.active}
						onclick={() => navigate(data.shelf, query, t.active ? '' : t.name)}
					>
						{t.name} <span class="mono t-count">{t.count}</span>
					</button>
				{/each}
			</div>
		{/if}
		<div class="columns">
			{#each data.columns as col (col.label)}
				<div class="col">
					<div class="col-head">
						<span class="col-label">{col.label}</span>
						<span class="mono col-count">{col.items.length}</span>
					</div>
					{#each col.items as d (d.id)}
						<div class="doc">
							<span class="mono ext">{d.ext}</span>
							<div class="names">
								{#if d.file}
									<a href="/files/{d.file}" target="_blank" class="doc-name">{d.name}</a>
								{:else}
									<span class="doc-name">{d.name}</span>
								{/if}
								<span
									class="meta"
									style:color={d.expired ? 'var(--red)' : d.amber ? 'var(--yellow)' : 'var(--fg3)'}
								>
									{d.meta}
								</span>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<span class="quiet"
					>Add the first document above — shelves and columns build themselves.</span
				>
			{/each}
		</div>
	</div>
</section>

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.toolbar input[type='text'] {
		border: 1px solid var(--bd2);
		border-radius: 8px;
		padding: 9px 12px;
		font-size: 13.5px;
		color: var(--fg1);
		background: var(--card);
		flex: 1 1 260px;
		max-width: 440px;
	}
	.add {
		margin-left: auto;
	}
	.layout {
		display: grid;
		grid-template-columns: 218px minmax(0, 1fr);
		gap: 28px;
		align-items: start;
	}
	@media (max-width: 860px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.rail {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.shelves {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.shelf {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
		width: 100%;
		text-align: left;
		border: 0;
		cursor: pointer;
		padding: 8px 10px;
		border-radius: 8px;
		background: transparent;
		color: var(--fg2);
		font-size: 13px;
	}
	.shelf:hover {
		background: var(--card2);
	}
	.shelf.active {
		background: var(--card3);
		color: var(--fg1);
	}
	.s-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.s-count {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.area {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}
	.tag-chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.tag-chip {
		border: 1px solid var(--bd);
		background: var(--card);
		color: var(--fg2);
		border-radius: 20px;
		padding: 5px 12px;
		font-size: 12px;
		cursor: pointer;
	}
	.tag-chip:hover {
		border-color: var(--bd2);
	}
	.tag-chip.active {
		border-color: var(--blue);
		background: var(--blue-tint);
		color: var(--blue);
	}
	.t-count {
		font-size: 10.5px;
		color: var(--fg3);
		margin-left: 3px;
	}
	.columns {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(258px, 1fr));
		gap: 16px;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.col-head {
		display: flex;
		align-items: baseline;
		gap: 9px;
		padding: 0 2px 8px;
		border-bottom: 1px solid var(--bd);
	}
	.col-label {
		font-size: 13px;
		font-weight: 500;
	}
	.col-count {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.doc {
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr);
		gap: 11px;
		align-items: center;
		padding: 10px 2px;
		border-bottom: 1px solid var(--bd);
	}
	.ext {
		font-size: 9.5px;
		letter-spacing: 0.04em;
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: 5px;
		padding: 4px 0;
		text-align: center;
	}
	.names {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.doc-name {
		font-size: 13px;
		color: var(--fg1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		font-size: 11px;
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
	}
	.add-form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 12px;
	}
	label,
	/* Checkboxes, not autocomplete: at household scale every possible owner
	   fits on one row and the "both of us" case is two visible ticks. */
	.belongs {
		grid-column: 1 / -1;
	}
	.belong-groups {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 14px;
		align-items: center;
	}
	.tick {
		flex-direction: row !important;
		align-items: center;
		gap: 6px;
		font-size: 13px !important;
		color: var(--fg1) !important;
	}
	.tick input {
		width: auto;
	}
	.tick-add {
		padding: 5px 10px;
		font-size: 12px;
	}
	.new-subject {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 7px 10px;
		font-size: 13px;
		width: 140px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		color: var(--fg3);
	}
	.add-form input,
	.add-form select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
	}
	.expiry {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		min-width: 0;
	}
	.expiry select {
		min-width: 0;
		flex: 0 1 auto;
	}
	.expiry input {
		flex: 1 1 130px;
		min-width: 0;
	}
	.row {
		display: flex;
		gap: 8px;
	}
</style>
