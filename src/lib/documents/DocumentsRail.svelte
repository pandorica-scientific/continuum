<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// The archive's left rail: the shelves, the subjects, and the five dialogs
	// that edit them.
	//
	// Its own component because it is its own thing, and because the documents
	// screen was three thousand lines with a style block two and a half times the
	// size of any other in the repository. Nothing here is shared with the list or
	// the inspector: every class it draws with is a `rail-`, `subject-` or
	// `shelf-dialog-` one, which is what made it the piece that could leave
	// without duplicating a single style.
	//
	// It owns its edit-mode state rather than taking it as props. Edit mode is not
	// a fact about the archive — it is a fact about this control, it does not
	// survive a navigation, and hoisting it would have put ten `$state` lines and
	// two `$effect`s on the page for the rail's benefit alone.
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import ShelfRow from '$lib/components/ShelfRow.svelte';
	import SubjectRow from '$lib/components/SubjectRow.svelte';
	import OrganisationRow from '$lib/components/OrganisationRow.svelte';
	import { railSubjects } from '$lib/documents/view';
	import { ENUMS, type DocumentTypeKey } from '$lib/enums';

	/** A shelf as the rail draws it, and as its editor rewrites it. */
	export interface RailShelf {
		id: string;
		key: string;
		label: string;
		emoji: string;
		system: boolean;
		count: number;
		/** What this shelf offers first in a type picker. Editable from here. */
		types: DocumentTypeKey[];
	}

	/** An organisation as the rail draws it: an employer, an authority, an insurer. */
	export interface RailOrganisation {
		id: string;
		name: string;
		kind: string;
		emoji: string;
		documentCount: number;
		peopleCount: number;
		/** Every role period, oldest first — a promotion is a second one. */
		people: {
			engagementId: string;
			personId: string;
			personName: string;
			role: string | null;
			startsOn: string | null;
			endsOn: string | null;
		}[];
	}

	/** A subject as the rail draws it. Archived ones travel too, and are dimmed. */
	export interface RailSubject {
		id: string;
		name: string;
		emoji: string;
		archived: boolean;
		count: number;
	}

	/**
	 * Exactly what the rail reads, rather than the page's whole payload.
	 *
	 * Narrow on purpose: a component in `$lib` that takes `PageData` is coupled
	 * to every field that screen happens to load, and the next field added to the
	 * page silently becomes part of this component's contract.
	 */
	interface RailData {
		shelves: RailShelf[];
		subjects: RailSubject[];
		organisations: RailOrganisation[];
		/** From the app layout: who the household is, for the role-period picker. */
		householdPeople: { id: string; name: string }[];
		documentTypes: { key: string; label: string; builtin: boolean }[];
		knownTags: string[];
		filters: { tags: string[]; type: string; entity: string };
		shelf: string;
		view: string;
		includeArchived: boolean;
	}

	let {
		data,
		/** The page's own URL writer: the rail navigates, it does not own the URL. */
		navigate
	}: {
		data: RailData;
		navigate: (next: Record<string, string | string[] | null>) => void;
	} = $props();

	let editingRail = $state(false);
	let railOrder = $state<string[]>([]);
	let dragging = $state<string | null>(null);
	let renaming = $state<string | null>(null);
	let deleting = $state<string | null>(null);
	let reassignTo = $state('');
	let addingShelf = $state(false);
	let newEmoji = $state('🗂️');
	let reorderForm = $state<HTMLFormElement | null>(null);

	const railShelves = $derived(
		(railOrder.length
			? railOrder.map((id) => data.shelves.find((s) => s.id === id)).filter(Boolean)
			: data.shelves.filter((s) => s.key !== 'all' && s.key !== 'inbox')) as typeof data.shelves
	);
	const deletingShelf = $derived(data.shelves.find((s) => s.id === deleting) ?? null);
	const shelfBeingTyped = $derived(data.shelves.find((s) => s.id === typingShelf) ?? null);
	const elsewhere = $derived(
		data.shelves.filter((s) => s.key !== 'all' && s.key !== 'inbox' && s.id !== deleting)
	);

	$effect(() => {
		void data.shelves;
		railOrder = [];
		renaming = null;
		deleting = null;
		addingShelf = false;
	});

	// The SUBJECTS section keeps its own pencil rather than sharing the shelves'.
	// One toggle driving two heads would mean pressing the pencil beside SHELVES
	// put drag handles on subjects that cannot be dragged, and vice versa; what
	// is shared is the mechanism, not the state.
	let editingSubjects = $state(false);
	let renamingSubject = $state<string | null>(null);
	let subjectMenu = $state<string | null>(null);
	let addingSubject = $state(false);
	let newSubjectEmoji = $state('📁');

	/**
	 * Archived subjects revealed for editing, which is not the same question as
	 * the list's archive scope.
	 *
	 * This used to write `?archived=1` — the parameter that also unhides archived
	 * paper in the centre column — so bringing a sold car's row back to rename it
	 * changed what the whole screen was showing, and pressing Done did not undo
	 * it because a URL is not edit-mode state. `Include archived subjects` above
	 * the list is still the control for the list.
	 */
	let revealArchived = $state(false);
	// The third section's own pencil, for the same reason SUBJECTS keeps one
	// rather than sharing the shelves': two lists edited by one control would
	// put a delete on a row the other list cannot delete.
	let editingOrganisations = $state(false);
	let renamingOrganisation = $state<string | null>(null);
	let organisationMenu = $state<string | null>(null);
	let addingOrganisation = $state(false);
	let newOrgEmoji = $state('🏛️');

	const menuOrganisation = $derived(
		data.organisations.find((o) => o.id === organisationMenu) ?? null
	);

	// Which subjects the rail draws, and how many the archive scope is keeping
	// back — the decision itself lives in `$lib/documents-view`, where a test can
	// reach it without a page.
	const subjects = $derived(railSubjects(data.subjects, data.includeArchived));
	/** The rail's editing list, which may show archived rows the list does not. */
	const editableSubjects = $derived(
		railSubjects(data.subjects, data.includeArchived || revealArchived)
	);
	const menuSubject = $derived(data.subjects.find((s) => s.id === subjectMenu) ?? null);

	$effect(() => {
		void data.subjects;
		renamingSubject = null;
		subjectMenu = null;
		addingSubject = false;
	});

	function moveOver(id: string) {
		if (!dragging || dragging === id) return;
		const ids = railShelves.map((s) => s.id);
		const from = ids.indexOf(dragging);
		const to = ids.indexOf(id);
		if (from < 0 || to < 0) return;
		ids.splice(to, 0, ids.splice(from, 1)[0]);
		railOrder = ids;
	}
	/** Which shelf's type list is open, if any. */
	let typingShelf = $state<string | null>(null);
	/** A household type about to be removed, asked once because it cannot come back. */
	let removingType = $state<string | null>(null);
</script>

<nav class="rail" aria-label="Shelves and subjects">
	{#each data.shelves.filter((s) => s.key === 'all' || s.key === 'inbox') as s (s.key)}
		<button
			type="button"
			class="rail-item"
			class:active={data.view !== 'tags' && data.shelf === s.key}
			onclick={() => navigate({ shelf: s.key === 'all' ? null : s.key, doc: null, view: null })}
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

	<!-- The pencil turns the rail into its own settings: drag to reorder,
		     click a name to rename, ⋯ to remove. Done puts it back. -->
	<div class="rail-head">
		<span class="eyebrow">Shelves</span>
		<button
			type="button"
			class="rail-tool"
			class:active={editingRail}
			aria-label={editingRail ? 'Done editing shelves' : 'Edit shelves'}
			aria-pressed={editingRail}
			onclick={() => {
				editingRail = !editingRail;
				renaming = null;
				railOrder = [];
			}}
		>
			{#if editingRail}Done{:else}<Icon name="pencil" size={14} />{/if}
		</button>
	</div>

	{#if editingRail}
		<div class="rail-shelves" role="list">
			{#each railShelves as s (s.id)}
				{#if renaming === s.id}
					<form class="rail-rename" method="POST" action="?/renameShelf" use:enhance>
						<input type="hidden" name="id" value={s.id} />
						<EmojiPicker name="emoji" value={s.emoji} />
						<input name="label" value={s.label} aria-label="Shelf name" />
						<button type="submit" class="btn small btn-primary">Save</button>
						<button type="button" class="btn small" onclick={() => (renaming = null)}>✕</button>
					</form>
				{:else}
					<ShelfRow
						shelf={s}
						dragging={dragging === s.id}
						ondragstart={() => (dragging = s.id)}
						ondragover={() => moveOver(s.id)}
						ondrop={() => {
							dragging = null;
							// Saved as soon as the row lands; nothing to press afterwards.
							if (railOrder.length) reorderForm?.requestSubmit();
						}}
						onrename={() => (renaming = s.id)}
						ontypes={() => (typingShelf = s.id)}
						ondelete={() => {
							deleting = s.id;
							reassignTo = elsewhere[0]?.id ?? '';
						}}
					/>
				{/if}
			{/each}
		</div>
		<form method="POST" action="?/reorderShelves" use:enhance bind:this={reorderForm} hidden>
			<input type="hidden" name="order" value={railOrder.join(',')} />
		</form>
		<button type="button" class="rail-item manage" onclick={() => (addingShelf = true)}>
			<span class="rail-label"><Icon name="plus" size={16} /> New shelf</span>
		</button>
	{:else}
		<div class="rail-shelves">
			{#each railShelves as s (s.key)}
				<button
					type="button"
					class="rail-item"
					class:active={data.view !== 'tags' && data.shelf === s.key}
					onclick={() => navigate({ shelf: s.key, doc: null, view: null })}
				>
					<span class="rail-label"><span class="rail-emoji">{s.emoji}</span>{s.label}</span>
					<span class="mono rail-count">{s.count}</span>
				</button>
			{/each}
		</div>
	{/if}

	<div class="rail-divider"></div>

	<!-- The other axis of the same archive: a shelf says where paper lives, a
		     subject says who or what it is about. Same eyebrow, same pencil, and
		     the same rows — with Archive where a shelf has Delete, because a
		     subject that once held paper is history rather than a mistake. -->
	<div class="rail-head">
		<span class="eyebrow">Subjects</span>
		<button
			type="button"
			class="rail-tool"
			class:active={editingSubjects}
			aria-label={editingSubjects ? 'Done editing subjects' : 'Edit subjects'}
			aria-pressed={editingSubjects}
			onclick={() => {
				editingSubjects = !editingSubjects;
				renamingSubject = null;
				// Done puts the archived rows away again; the list's own scope is
				// untouched either way.
				revealArchived = false;
			}}
		>
			{#if editingSubjects}Done{:else}<Icon name="pencil" size={14} />{/if}
		</button>
	</div>

	{#if editingSubjects}
		<div class="rail-shelves" role="list">
			{#each editableSubjects.shown as s (s.id)}
				{#if renamingSubject === s.id}
					<form class="rail-rename" method="POST" action="?/renameSubject" use:enhance>
						<input type="hidden" name="id" value={s.id} />
						<EmojiPicker name="emoji" value={s.emoji} />
						<input name="name" value={s.name} aria-label="Subject name" />
						<button type="submit" class="btn small btn-primary">Save</button>
						<button type="button" class="btn small" onclick={() => (renamingSubject = null)}
							>✕</button
						>
					</form>
				{:else}
					<SubjectRow
						subject={s}
						onrename={() => (renamingSubject = s.id)}
						onmenu={() => (subjectMenu = s.id)}
					/>
				{/if}
			{/each}
		</div>
		<!-- Archived subjects are hidden, not gone, and the only control that
			     brings one back lives on its row — so the rail says how many rows
			     it is holding rather than leaving a one-way door. -->
		{#if editableSubjects.hidden > 0}
			<button type="button" class="rail-item manage" onclick={() => (revealArchived = true)}>
				<span class="rail-label">Show {editableSubjects.hidden} archived</span>
			</button>
		{/if}
		<button type="button" class="rail-item manage" onclick={() => (addingSubject = true)}>
			<span class="rail-label"><Icon name="plus" size={16} /> New subject</span>
		</button>
	{:else}
		<div class="rail-shelves">
			{#each subjects.shown as s (s.id)}
				<!-- A subject narrows the list without leaving the shelf: `?entity=`
					     is the same filter the About dropdown writes, so the rail and
					     the filter can never disagree. Pressing the active one clears
					     it, which is how the day filter on the calendar already reads. -->
				<button
					type="button"
					class="rail-item"
					class:active={data.view !== 'tags' && data.filters.entity === s.id}
					class:dim={s.archived}
					onclick={() =>
						navigate({
							entity: data.filters.entity === s.id ? null : s.id,
							doc: null,
							view: null
						})}
				>
					<span class="rail-label"><span class="rail-emoji">{s.emoji}</span>{s.name}</span>
					<span class="mono rail-count">{s.count}</span>
				</button>
			{/each}
		</div>
	{/if}

	<div class="rail-divider"></div>

	<!-- ORGANISATIONS: a third section on the same argument SUBJECTS makes.
	     A shelf says where in life, a subject says what it is about, and an
	     organisation says who it was with — an employer, the tax office, an
	     insurer. Same eyebrow, same pencil, same rows, with Delete where a
	     subject has Archive: an organisation holds no paper of its own to
	     demote, so there is nothing to keep by dimming it. -->
	<div class="rail-head">
		<span class="eyebrow">Organisations</span>
		<button
			type="button"
			class="rail-tool"
			class:active={editingOrganisations}
			aria-label={editingOrganisations ? 'Done editing organisations' : 'Edit organisations'}
			aria-pressed={editingOrganisations}
			onclick={() => {
				editingOrganisations = !editingOrganisations;
				renamingOrganisation = null;
			}}
		>
			{#if editingOrganisations}Done{:else}<Icon name="pencil" size={14} />{/if}
		</button>
	</div>

	{#if editingOrganisations}
		<div class="rail-shelves" role="list">
			{#each data.organisations as o (o.id)}
				{#if renamingOrganisation === o.id}
					<form class="rail-rename" method="POST" action="?/renameOrganisation" use:enhance>
						<input type="hidden" name="id" value={o.id} />
						<EmojiPicker name="emoji" value={o.emoji} />
						<input name="name" value={o.name} aria-label="Organisation name" />
						<select name="kind" value={o.kind} aria-label="What it is to the household">
							{#each ENUMS['organisation.kind'] as kind (kind)}
								<option value={kind}>{kind}</option>
							{/each}
						</select>
						<button type="submit" class="btn small btn-primary">Save</button>
						<button type="button" class="btn small" onclick={() => (renamingOrganisation = null)}
							>✕</button
						>
					</form>
				{:else}
					<OrganisationRow
						organisation={{
							id: o.id,
							name: o.name,
							emoji: o.emoji,
							kind: o.kind,
							count: o.documentCount,
							people: o.peopleCount
						}}
						onrename={() => (renamingOrganisation = o.id)}
						onmenu={() => (organisationMenu = o.id)}
					/>
				{/if}
			{/each}
		</div>
		<button type="button" class="rail-item manage" onclick={() => (addingOrganisation = true)}>
			<span class="rail-label"><Icon name="plus" size={16} /> New organisation</span>
		</button>
	{:else}
		<div class="rail-shelves">
			{#each data.organisations as o (o.id)}
				<!-- Filters the list the same way a subject does: `?entity=` is one
				     filter, whatever kind of record wrote it. -->
				<button
					type="button"
					class="rail-item"
					class:active={data.view !== 'tags' && data.filters.entity === o.id}
					onclick={() =>
						navigate({
							entity: data.filters.entity === o.id ? null : o.id,
							doc: null,
							view: null
						})}
				>
					<span class="rail-label"><span class="rail-emoji">{o.emoji}</span>{o.name}</span>
					<span class="mono rail-count">{o.documentCount}</span>
				</button>
			{/each}
			{#if data.organisations.length === 0}
				<!-- Nothing to filter by yet, and no way in without the pencil: an
				     empty section that cannot be filled reads as broken. -->
				<button
					type="button"
					class="rail-item manage"
					onclick={() => {
						editingOrganisations = true;
						addingOrganisation = true;
					}}
				>
					<span class="rail-label"><Icon name="plus" size={16} /> Add an employer</span>
				</button>
			{/if}
		</div>
	{/if}

	<div class="rail-divider"></div>

	<!-- Tags cut across documents and money alike; a household reaches for
		     them from the paper far more often than from the register. -->
	<button
		type="button"
		class="rail-item"
		class:active={data.view === 'tags'}
		onclick={() => navigate({ view: 'tags', doc: null })}
	>
		<span class="rail-label"><span class="rail-emoji">🏷️</span>Tags</span>
		<span class="mono rail-count">{data.knownTags.length}</span>
	</button>
</nav>

{#if addingShelf}
	<Modal onclose={() => (addingShelf = false)} title="New shelf">
		<form class="shelf-dialog" method="POST" action="?/addShelf" use:enhance>
			<div class="shelf-dialog-row">
				<span class="shelf-dialog-emoji" aria-hidden="true">{newEmoji}</span>
				<input name="label" placeholder="Shelf name" aria-label="Shelf name" />
			</div>
			<EmojiPicker name="emoji" bind:value={newEmoji} inline />
			<div class="modal-actions">
				<button type="button" class="btn" onclick={() => (addingShelf = false)}>Cancel</button>
				<button type="submit" class="btn btn-primary">Add shelf</button>
			</div>
		</form>
	</Modal>
{/if}

{#if addingOrganisation}
	<Modal onclose={() => (addingOrganisation = false)} title="New organisation">
		<form class="shelf-dialog" method="POST" action="?/addOrganisation" use:enhance>
			<div class="shelf-dialog-row">
				<span class="shelf-dialog-emoji" aria-hidden="true">{newOrgEmoji}</span>
				<input name="name" placeholder="Organisation name" aria-label="Organisation name" />
			</div>
			<!-- What it IS to the household, not what industry it is in: the four
			     words change what is expected of it, and nothing else. -->
			<select name="kind" aria-label="What it is to the household">
				{#each ENUMS['organisation.kind'] as kind (kind)}
					<option value={kind}>{kind}</option>
				{/each}
			</select>
			<EmojiPicker name="emoji" bind:value={newOrgEmoji} inline />
			<div class="modal-actions">
				<button type="button" class="btn" onclick={() => (addingOrganisation = false)}
					>Cancel</button
				>
				<button type="submit" class="btn btn-primary">Add organisation</button>
			</div>
		</form>
	</Modal>
{/if}

{#if menuOrganisation}
	<Modal onclose={() => (organisationMenu = null)} title={menuOrganisation.name}>
		<div class="shelf-dialog org-menu">
			<p class="quiet">{menuOrganisation.documentCount} filed against it</p>

			<!-- ROLE PERIODS. Every one, not only the current: a promotion is a
			     second period, and showing only the latest would make "promoted in
			     2021" and "started in 2021" look identical — which is the exact
			     distinction the record exists to keep, because a lane counts the
			     filings it expected from the EARLIEST start. -->
			<span class="eyebrow">Roles</span>
			{#if menuOrganisation.people.length === 0}
				<p class="quiet">Nobody has a role here yet.</p>
			{:else}
				<div class="org-roles" role="list">
					{#each menuOrganisation.people as role (role.engagementId)}
						<div class="org-role" role="listitem">
							<span class="org-role-who">
								{role.personName}{#if role.role}<span class="quiet"> · {role.role}</span>{/if}
							</span>
							<span class="mono org-role-when">
								{role.startsOn ?? '—'} → {role.endsOn ?? 'now'}
							</span>
							{#if role.endsOn === null}
								<!-- Closed, never deleted: a period removed on promotion takes
								     its years with it and the expected count silently shrinks. -->
								<form class="org-role-act" method="POST" action="?/endEngagement" use:enhance>
									<input type="hidden" name="id" value={role.engagementId} />
									<input type="date" name="endsOn" aria-label="Last day in this role" />
									<button type="submit" class="btn small">End</button>
								</form>
							{:else}
								<form class="org-role-act" method="POST" action="?/deleteEngagement" use:enhance>
									<input type="hidden" name="id" value={role.engagementId} />
									<button type="submit" class="btn small" aria-label="Remove this role period">
										✕
									</button>
								</form>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<form class="org-add-role" method="POST" action="?/addEngagement" use:enhance>
				<input type="hidden" name="organisationId" value={menuOrganisation.id} />
				<select name="personId" aria-label="Who">
					{#each data.householdPeople as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
				<input name="role" placeholder="Role, if it has one" aria-label="Role" />
				<input type="date" name="startsOn" aria-label="First day in this role" />
				<button type="submit" class="btn small btn-primary">Add role</button>
			</form>

			<div class="rail-divider"></div>

			<!-- Deleted, not archived. A subject demotes the paper filed under it,
			     which is why archiving one is worth having; an organisation holds no
			     paper of its own, so there is nothing to keep by dimming it. The
			     refusal is what protects the paper filed AGAINST it. -->
			<form method="POST" action="?/deleteOrganisation" use:enhance>
				<input type="hidden" name="id" value={menuOrganisation.id} />
				<div class="modal-actions">
					<button type="button" class="btn" onclick={() => (organisationMenu = null)}>Close</button>
					<button type="submit" class="btn btn-danger">Remove organisation</button>
				</div>
			</form>
		</div>
	</Modal>
{/if}

{#if addingSubject}
	<Modal onclose={() => (addingSubject = false)} title="New subject">
		<form class="shelf-dialog" method="POST" action="?/addSubject" use:enhance>
			<div class="shelf-dialog-row">
				<span class="shelf-dialog-emoji" aria-hidden="true">{newSubjectEmoji}</span>
				<input name="name" placeholder="Subject name" aria-label="Subject name" />
			</div>
			<EmojiPicker name="emoji" bind:value={newSubjectEmoji} inline />
			<div class="modal-actions">
				<button type="button" class="btn" onclick={() => (addingSubject = false)}>Cancel</button>
				<button type="submit" class="btn btn-primary">Add subject</button>
			</div>
		</form>
	</Modal>
{/if}

<!-- Archiving is reversible and deletes nothing, so the dialog is a sentence
     about what moves rather than a warning: the number is how much paper leaves
     the list, and the same dialog brings it back. -->
{#if menuSubject}
	<Modal
		onclose={() => (subjectMenu = null)}
		title={menuSubject.archived
			? `Bring “${menuSubject.name}” back?`
			: `Archive “${menuSubject.name}”?`}
	>
		<form
			class="shelf-dialog"
			method="POST"
			action={menuSubject.archived ? '?/unarchiveSubject' : '?/archiveSubject'}
			use:enhance
		>
			<input type="hidden" name="id" value={menuSubject.id} />
			<p class="quiet">
				{#if menuSubject.archived}
					Its <span class="mono">{menuSubject.count}</span>
					{menuSubject.count === 1 ? 'document comes' : 'documents come'} back into the list, and its
					expiry dates read as dates to act on again.
				{:else}
					Its <span class="mono">{menuSubject.count}</span>
					{menuSubject.count === 1 ? 'document leaves' : 'documents leave'} the list. Nothing is deleted
					— <strong>Include archived subjects</strong> shows them again, and their expiry dates stop being
					alarms.
				{/if}
			</p>
			<div class="modal-actions">
				<button type="button" class="btn" onclick={() => (subjectMenu = null)}>Cancel</button>
				<button type="submit" class="btn btn-primary"
					>{menuSubject.archived ? 'Bring it back' : 'Archive'}</button
				>
			</div>
		</form>
	</Modal>
{/if}

{#if shelfBeingTyped}
	<Modal onclose={() => (typingShelf = null)} title={`What ${shelfBeingTyped.label} usually holds`}>
		<form
			class="shelf-dialog"
			method="POST"
			action="?/setShelfTypes"
			use:enhance={() =>
				async ({ update }) => {
					await update();
					typingShelf = null;
				}}
		>
			<input type="hidden" name="id" value={shelfBeingTyped.id} />
			<p class="quiet">
				These are offered first when filing to this shelf, and one is proposed during inbox review.
				Nothing is refused: any document can be filed here whatever its type.
			</p>
			<div class="type-picker">
				{#each data.documentTypes as t (t.key)}
					<span class="type-chip">
						<label class="pick-chip">
							<input
								type="checkbox"
								name="types"
								value={t.key}
								checked={shelfBeingTyped.types.includes(t.key)}
							/>
							<span>{t.label}</span>
						</label>
						{#if !t.builtin}
							<!-- Only on a type this household added, and only the ✕: the
							     seventeen the app ships are read by name by the salary
							     tracker, the importer and the wallet, so there is nothing
							     here to press for them. A type that is on a document is
							     refused with the reason rather than hidden. -->
							<button
								type="button"
								class="chip-x"
								aria-label="Remove the type {t.label}"
								onclick={() => (removingType = t.key)}>✕</button
							>
						{/if}
					</span>
				{/each}
			</div>
			<div class="dialog-actions">
				<button type="submit" class="btn btn-primary">Save</button>
				<button type="button" class="btn" onclick={() => (typingShelf = null)}>Cancel</button>
			</div>
		</form>

		{#if removingType}
			<form
				class="remove-type"
				method="POST"
				action="?/removeDocumentType"
				use:enhance={() =>
					async ({ update }) => {
						await update();
						removingType = null;
					}}
			>
				<input type="hidden" name="key" value={removingType} />
				<span class="quiet">
					Remove “{data.documentTypes.find((t) => t.key === removingType)?.label}” from this
					household?
				</span>
				<button type="submit" class="btn small danger">Remove</button>
				<button type="button" class="btn small" onclick={() => (removingType = null)}>
					Keep it
				</button>
			</form>
		{/if}

		<!-- Its own form, because it posts to a different action and must not
		     carry the checkboxes above with it. A type added here is added to the
		     household, not to this shelf: tick it afterwards to put it on the
		     shelf, which is the same two steps a new tag takes. -->
		<form
			class="new-type"
			method="POST"
			action="?/addDocumentType"
			use:enhance={() =>
				async ({ update }) => {
					await update({ reset: true });
				}}
		>
			<span class="eyebrow">A kind of paper this list is missing</span>
			<div class="new-type-row">
				<input name="label" placeholder="Vaccination book, lease annex…" />
				<button type="submit" class="btn">Add type</button>
			</div>
			<p class="quiet">
				Yours to name. The seventeen the app ships with cannot be removed — the salary tracker, the
				importer and the wallet each read one by name — but anything you add here is only a label,
				and can go again while nothing is filed as it.
			</p>
		</form>
	</Modal>
{/if}

{#if deletingShelf}
	<Modal onclose={() => (deleting = null)} title={`Delete “${deletingShelf.label}”?`}>
		<form class="shelf-dialog" method="POST" action="?/removeShelf" use:enhance>
			<input type="hidden" name="id" value={deletingShelf.id} />
			<p class="quiet">
				<span class="mono">{deletingShelf.count}</span>
				{deletingShelf.count === 1 ? 'document needs' : 'documents need'} another shelf first.
			</p>
			<label class="shelf-dialog-field">
				<span class="eyebrow">Move them to</span>
				<select name="reassignTo" bind:value={reassignTo}>
					{#each elsewhere as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
				</select>
			</label>
			<div class="modal-actions">
				<button type="button" class="btn" onclick={() => (deleting = null)}>Cancel</button>
				<button type="submit" class="btn btn-primary">Move &amp; delete</button>
			</div>
		</form>
	</Modal>
{/if}

<style>
	.org-menu {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.org-roles {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-height: 220px;
		overflow-y: auto;
		/* Two scrollable things on one screen take turns without this — see
		   docs/ui-guidelines.md. */
		overscroll-behavior: contain;
	}
	.org-role {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.org-role-who {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.org-role-when {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.org-role-act {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin-left: auto;
	}
	.org-add-role {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
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
		/* Scrolling stops at this panel's own end. Without it the wheel is handed
		   on to whatever scrolls behind, so reaching the bottom here quietly
		   starts scrolling the page — and scrolling back moves the wrong one
		   first. See docs/ui-guidelines.md. */
		overscroll-behavior: contain;
	}
	.rail-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-4) var(--space-5);
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
	/* An archived subject is dimmed, never hidden from its own section: the row
	   is how it is brought back. `--fg3` is the quiet colour in both themes, and
	   the emoji takes opacity because it has no colour of ours to quieten. */
	.rail-item.dim {
		color: var(--fg3);
	}
	.rail-item.dim .rail-emoji {
		opacity: 0.55;
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
	.rail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 10px;
		min-height: 24px;
	}
	.rail-tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 24px;
		height: 24px;
		padding: 0 var(--space-3);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--fg3);
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.rail-tool:hover {
		color: var(--fg1);
		background: var(--card2);
	}
	.rail-tool.active {
		color: var(--fg1);
		border-color: var(--bd);
		background: var(--card3);
	}
	.rail-rename {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 36px;
		padding: 0 var(--space-3);
	}
	.rail-rename input {
		flex: 1;
		min-width: 0;
		height: 28px;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-sm);
		background: var(--card);
		color: var(--fg1);
		padding: 0 var(--space-3);
		font-size: var(--text-md);
	}
	.rail-rename :global(.trigger) {
		width: 28px;
		height: 28px;
	}
	.shelf-dialog {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.shelf-dialog-row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.shelf-dialog-emoji {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: var(--control-h);
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		background: var(--card2);
		font-size: var(--text-xl);
		line-height: 1;
		flex: none;
	}
	.shelf-dialog-row input,
	.shelf-dialog select {
		flex: 1;
		height: var(--control-h);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--fg1);
		padding: 0 10px;
		font-size: var(--text-md);
	}
	.shelf-dialog-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	@media (max-width: 860px) {
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
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}
	/* Seventeen chips in a scrollable block: a column of seventeen rows is a
	   dialog taller than the screen it opens on. */
	.type-picker {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		max-height: 40vh;
		overflow-y: auto;
		/* Scrolling stops at this panel's own end. Without it the wheel is handed
		   on to whatever scrolls behind, so reaching the bottom here quietly
		   starts scrolling the page — and scrolling back moves the wrong one
		   first. See docs/ui-guidelines.md. */
		overscroll-behavior: contain;
	}
	/* The chip and its ✕ travel together, so the ✕ never wraps onto its own
	   line away from the type it belongs to. */
	.type-chip {
		display: inline-flex;
		flex-direction: row;
		align-items: center;
		gap: var(--space-3);
	}
	.remove-type {
		display: flex;
		flex-direction: row;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-top: var(--space-5);
	}
	.new-type {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: var(--space-7);
		padding-top: var(--space-7);
		border-top: 1px solid var(--bd);
	}
	.new-type-row {
		display: flex;
		flex-direction: row;
		gap: var(--space-4);
	}
	.new-type-row input {
		flex: 1;
	}
	.dialog-actions {
		display: flex;
		flex-direction: row;
		gap: var(--space-5);
	}
	/* The rail's own pencil row. Quiet until hovered: it is a mode switch, not
	   an action, and a rail with a bright control on every section reads as a
	   toolbar. */
	.manage {
		color: var(--fg3);
		cursor: pointer;
	}
	.manage .rail-label {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.manage:hover {
		color: var(--fg2);
	}
	/* Removing a household type cannot be undone, so the button says so. */
	.danger {
		border-color: var(--red);
		color: var(--red);
	}
</style>
