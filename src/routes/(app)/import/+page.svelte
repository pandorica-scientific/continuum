<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { submitAction } from '$lib/actions/result';
	import CategoryPicker from '$lib/components/CategoryPicker.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import InfoHint from '$lib/components/InfoHint.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import IconTile from '$lib/components/IconTile.svelte';
	import { DATE_ORDER_CHOICES, DECIMAL_CHOICES, ROLE_CHOICES } from '$lib/transactions/roles';
	import SummaryBand from '$lib/components/SummaryBand.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Field from '$lib/components/Field.svelte';

	let { data, form } = $props();

	let assignAccountId = $state('');

	// Pre-answer the picker when the Statements ribbon sent you here from a gap.
	//
	// An effect rather than an initial value, because arriving by a client-side
	// navigation never re-runs an initialiser — the link from the ribbon is one,
	// so the initial-value version answered the picker on a full page load and
	// silently did nothing on a click. Still only a starting point: the picker
	// is yours to change afterwards, and nothing here reads it back.
	$effect(() => {
		if (data.prefill.accountId) assignAccountId = data.prefill.accountId;
	});

	/**
	 * The month this upload was asked for, in words, or null.
	 *
	 * Only shown when the ribbon named one. Arriving from a gap and seeing an
	 * ordinary upload box gives no sign the screen understood which month was
	 * missing — and the answer matters, because filing the wrong one leaves the
	 * gap exactly where it was.
	 */
	const askedFor = $derived.by(() => {
		const { from, accountId } = data.prefill;
		if (!from) return null;
		const account = data.accounts.find((a) => a.id === accountId);
		const month = new Date(`${from}T00:00:00Z`).toLocaleString('en-GB', {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
		return account ? `${month} · ${account.name}` : month;
	});

	// Categories picked since the page rendered, so Save can be disabled while
	// there is nothing to save. Deliberately NOT bind:value with a seeded record:
	// binding overrides the `selected` attributes below, and the server-rendered
	// markup then has nothing selected, so the browser falls back to the first
	// enabled option and an unguessed row reads as already filed with Salary.
	const ROLE_LABELS: Record<string, string> = {
		income: 'Money in',
		expense: 'Money out',
		savings: 'Money kept'
	};
	let addingCategory = $state(false);
	/** Blank means "put it in an existing group"; a name here creates one. */
	let newGroupLabel = $state('');
	let chosen = $state<Record<string, string>>({});
	const picked = (r: { id: string; suggestedCategoryId: string | null }) =>
		chosen[r.id] ?? r.suggestedCategoryId ?? '';

	// The choice disambiguates the upload it was made for. Holding it across
	// uploads forced every later batch into the same account, and resolveAccount
	// now validates the statement's bank, currency and number against it — so an
	// unrelated statement came back needsAccount with nothing imported, asking
	// again for the very choice that caused it. Keep it only while some file
	// still needs an answer.
	//
	// Scoped to the files THIS upload queued, which is what `form.queued` carries.
	// Reading the whole queue instead brought the bug straight back: settled jobs
	// linger for an hour, so one old `needsAccount` result kept the choice pinned
	// to every batch dropped after it — the exact thing the paragraph above says
	// was fixed.
	$effect(() => {
		const batch = new Set(form?.queued ?? []);
		if (batch.size === 0) return;
		const results = data.queue.files
			.filter((f) => batch.has(f.id))
			.map((f) => f.result)
			.filter((r) => r !== null);
		if (results.length > 0 && !results.some((result) => result.needsAccount)) assignAccountId = '';
	});

	// Watch the queue while it has work in it.
	//
	// The upload returns as soon as the files are accepted, so the page has to
	// find out for itself when each one has been read. Polling stops the moment
	// the queue empties — an idle import page should be as quiet as any other.
	const busy = $derived(data.queue.waiting + data.queue.running > 0);
	$effect(() => {
		if (!busy) return;
		const timer = setInterval(() => void invalidateAll(), 1500);
		return () => clearInterval(timer);
	});

	// FileList from a browse or a drop, File[] from the scan engine, which
	// builds its PDF in memory and has no FileList to hand over.
	async function uploadFiles(files: FileList | File[]) {
		const body = new FormData();
		for (const f of files) body.append('statements', f);
		if (assignAccountId) body.set('accountId', assignAccountId);
		return submitAction('?/upload', body);
	}
</script>

<ScreenHeader
	title="Import"
	caption="Statements in, transactions filed. Only the ambiguous ones ask for you."
/>

{#if form?.message && !form?.id}
	<!-- Failures that name a row render beside that row instead; showing the same
	     message here as well reads as two separate failures. -->
	<div class="error">{form.message}</div>
{/if}

<section class="section">
	{#if askedFor}
		<!-- What the ribbon asked for. The upload itself is unchanged — the file
		     still says which month it covers, and this is not a filter — but a
		     person who clicked a specific gap should see that the screen knows
		     which one. -->
		<p class="asked">Filing the statement for <strong>{askedFor}</strong></p>
	{/if}

	<UploadDropzone
		hero
		formats={['CSV', 'XLSX', 'PDF', 'CAMT.053', 'MT940', 'OFX', 'ABO/GPC', 'photo']}
		accept=".csv,.tsv,.txt,.pdf,.xlsx,.xls,.xml,.camt,.gpc,.abo,.sta,.mt940,.ofx,.qfx,.png,.jpg,.jpeg,.tiff"
		multiple={true}
		idleText="Drop statements here, or click to browse"
		heroNote="Read exactly as your bank wrote them, then checked against their own balances."
		busyText="Reading statements…"
		description="A CSV, spreadsheet or PDF from any bank — the layout is worked out from the file and checked against the statement's own balances, so no per-bank setup is needed. CAMT.053, MT940, OFX/QFX and ABO/GPC exports are read directly. A photograph or scan is read from the page image, in the background. Several files at once. Transfers between your own accounts are paired and dropped, and categories come from what you corrected last time."
		onfiles={uploadFiles}
	/>

	{#if data.accounts.length > 1}
		<label class="assign">
			<span>Assign to account</span>
			<select bind:value={assignAccountId} onclick={(e) => e.stopPropagation()}>
				<option value="">detect from the statement</option>
				{#each data.accounts as a (a.id)}
					<option value={a.id}>{a.name} · {a.currency}</option>
				{/each}
			</select>
			<span class="assign-note">
				needed when several accounts share a bank and currency — the statement cannot say which one
				it belongs to
			</span>
		</label>
	{/if}

	{#if data.queue.files.length > 0}
		<div class="card results">
			{#if busy}
				<p class="queue-depth">
					Reading {data.queue.running} of {data.queue.files.length} — {data.queue.waiting} waiting.
				</p>
			{/if}
			{#each data.queue.files as job (job.id)}
				<div class="result-row">
					<span class="r-name">{job.filename}</span>
					<span class="r-meta mono">
						{#if job.state === 'queued'}
							waiting
						{:else if job.state === 'running'}
							reading…
						{:else if job.error}
							{job.error}
							<!-- The bytes are still here, so the layout can be mapped by hand
							     rather than the file being uploaded again. -->
							<form method="POST" action="?/previewLayout" use:enhance class="inline-form">
								<input type="hidden" name="jobId" value={job.id} />
								<button type="submit" class="btn">Map its columns</button>
							</form>
						{:else if job.result?.error}
							{job.result.error}
							<form method="POST" action="?/previewLayout" use:enhance class="inline-form">
								<input type="hidden" name="jobId" value={job.id} />
								<button type="submit" class="btn">Map its columns</button>
							</form>
						{:else if job.result}
							{job.result.rowsAdded} added · {job.result.rowsDuplicate} known · {job.result
								.rowsPaired} paired
						{/if}
					</span>
					<!-- A read under way cannot be stopped from here, so the control says
					     so rather than pretending. Anything else can go: a cancellation
					     while it waits, a tidy-up once it has settled. A settled row also
					     leaves on its own after ten minutes. -->
					<form method="POST" action="?/dismissJob" use:enhance class="inline-form">
						<input type="hidden" name="jobId" value={job.id} />
						<button
							type="submit"
							class="r-dismiss"
							disabled={job.state === 'running'}
							title={job.state === 'running'
								? 'Being read right now — it can go once it finishes'
								: job.state === 'queued'
									? 'Cancel this file'
									: 'Clear this from the queue'}
							aria-label="Dismiss {job.filename}"
						>
							✕
						</button>
					</form>
				</div>
			{/each}
		</div>
	{/if}
</section>

{#if form?.preview}
	<section class="section">
		<Eyebrow
			hue="--teal"
			icon="layers"
			label="Map this layout"
			caption="say what the columns are — the balances still decide whether it adds up"
		/>
		<!--
			One question, asked of the person who has the statement in front of them:
			what is each column? That is the one thing they know better than the file.

			It is not permission to skip the proof. Whatever they confirm is read
			back through the same arithmetic as any other statement, and a mapping
			that produces movements contradicting the balances is refused exactly as
			an inferred reading would be.
		-->
		<form method="POST" action="?/confirmMapping" use:enhance class="card wizard">
			<input type="hidden" name="jobId" value={form.preview.jobId} />
			<input type="hidden" name="source" value={form.preview.source} />
			<input type="hidden" name="encoding" value={form.preview.encoding ?? ''} />
			<input type="hidden" name="delimiter" value={form.preview.delimiter ?? ''} />

			{#if form.preview.drift}
				<!--
					A layout we nearly know. Matching on labels rather than positions is
					what turns "the bank added a column" from a silent shift of every
					role into this: a named difference, with last time's answers already
					filled in.
				-->
				<input type="hidden" name="supersedes" value={form.preview.drift.profileId} />
				<p class="note">
					This looks like <strong>{form.preview.drift.profileName}</strong>, changed since it was
					last read{#if form.preview.drift.added.length}: {form.preview.drift.added.join(', ')}
						{form.preview.drift.added.length === 1 ? 'is' : 'are'} new{/if}{#if form.preview.drift.removed.length}{form
							.preview.drift.added.length
							? ', and'
							: ':'}
						{form.preview.drift.removed.join(', ')}
						{form.preview.drift.removed.length === 1 ? 'is' : 'are'} gone{/if}. The columns it
					already knew are filled in.
				</p>
			{/if}

			{#if form.preview.questions.length > 0}
				<p class="note">
					What stopped it: {form.preview.questions.join('; ')}
				</p>
			{/if}

			<div class="w-columns">
				{#each form.preview.headers as header, i (i)}
					<label class="w-col">
						<span class="w-head">{header || `Column ${i + 1}`}</span>
						<input type="hidden" name="header" value={header} />
						<select name="role">
							<option value="">Not used</option>
							{#each ROLE_CHOICES as choice (choice.value)}
								<option value={choice.value} selected={form.preview.roles[i] === choice.value}>
									{choice.label}
								</option>
							{/each}
						</select>
						<span class="w-sample mono">
							{form.preview.sample
								.map((row) => row[i] ?? '')
								.filter(Boolean)
								.slice(0, 3)
								.join(' · ')}
						</span>
					</label>
				{/each}
			</div>

			<div class="w-conventions">
				<Field label="Dates read as">
					<select name="dateOrder">
						{#each DATE_ORDER_CHOICES as choice (choice.value)}
							<option value={choice.value} selected={form.preview.dateOrder === choice.value}>
								{choice.label}
							</option>
						{/each}
					</select>
				</Field>
				<Field label="Decimal mark">
					<select name="decimalMark">
						{#each DECIMAL_CHOICES as choice (choice.value)}
							<option value={choice.value} selected={form.preview.decimalMark === choice.value}>
								{choice.label}
							</option>
						{/each}
					</select>
				</Field>
				<Field label="Name this layout">
					<input
						name="name"
						placeholder="e.g. Bank Mandiri current account"
						value={form.preview.drift?.profileName ?? ''}
						required
					/>
				</Field>
			</div>

			<button type="submit" class="btn primary">Read it this way</button>
		</form>
	</section>
{/if}

{#if data.imports.length > 0}
	<section class="section">
		<Eyebrow
			hue="--teal"
			icon="receipt"
			label="Recent imports"
			caption="what each statement was checked against"
		/>
		<!--
			What each statement was checked against before its movements were filed.

			The proof engine decided whether to accept these and then threw its
			reasoning away, so a figure that later looked wrong could not be traced
			to the reading that produced it. Showing the checks is what makes
			"accepted" mean something a person can inspect rather than take on trust.
		-->
		<div class="card imports">
			{#each data.imports as file (file.id)}
				<details class="import-row">
					<summary>
						<span class="i-name">{file.filename}</span>
						<span class="i-meta mono">
							{file.rowsAdded} filed{#if file.readAs}&nbsp;· {file.readAs}{/if}
						</span>
						<!-- Acknowledging hides the row. It deletes nothing: the import,
						     its transactions, its stored file and its document all stay,
						     and the content hash still makes a re-upload a duplicate. -->
						<form method="POST" action="?/acknowledgeImport" use:enhance class="inline-form">
							<input type="hidden" name="fileId" value={file.id} />
							<button type="submit" class="r-dismiss" aria-label="Acknowledge {file.filename}">
								✕
							</button>
						</form>
					</summary>
					<div class="i-body">
						{#if file.proofLabel}
							<p class="i-proof">{file.proofLabel}</p>
						{/if}
						{#if file.checks.length > 0}
							<ul class="i-checks">
								{#each file.checks as check (check.name)}
									<li class:failed={check.status === 'fail'}>
										<span class="c-name">{check.name}</span>
										<span class="c-detail">{check.detail}</span>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="note">This statement printed no figures to check its movements against.</p>
						{/if}
					</div>
				</details>
			{/each}
		</div>
	</section>
{/if}

<SummaryBand
	tiles={[
		{ label: 'Files this month', value: String(data.stats.filesThisMonth), wash: 'teal' },
		{ label: 'Transactions read', value: String(data.stats.transactionsRead), wash: 'blue' },
		{
			label: 'Filed automatically',
			value: data.stats.autoPct === null ? '—' : `${data.stats.autoPct}%`,
			note: 'corrections teach the categoriser',
			wash: 'green'
		},
		{
			label: 'Transfers paired',
			value: String(data.stats.transfersPaired),
			note: 'excluded from income and spending',
			wash: 'purple'
		}
	]}
/>

<!-- Two panels side by side, as the handoff draws them: what still needs a
     person, and where each account's record stops. -->
<div class="decide">
	<section class="section">
		<div class="eyebrow-row">
			<Eyebrow hue="--yellow" icon="alert" label="Needs a decision" />
			<span class="eyebrow-caption">
				{data.review.length === 0
					? 'nothing waiting'
					: `${data.review.length} rows the categoriser will not guess at`}
			</span>
		</div>

		{#if data.review.length === 0}
			<!-- The empty state IS the good state, so it is drawn as one: a green card
		     saying what happened, not a grey line saying nothing did. -->
			<div class="all-filed">
				<span class="filed-tile"><Icon name="check" size={20} /></span>
				<span class="filed-text">
					<span class="filed-title">Everything filed itself</span>
					<span class="filed-note">
						Only genuinely ambiguous rows appear here — a date column where every reading is valid,
						a counterparty no rule knows.
					</span>
				</span>
			</div>
		{/if}

		{#each data.review as r (r.id)}
			<div class="card review-row">
				<div class="r-facts">
					<span class="mono r-date">{r.date}</span>
					<div class="r-mid">
						<span class="r-merchant">{r.merchant}</span>
						<span class="r-reason">{r.reason} · {r.account}</span>
					</div>
					<span class="mono r-amount" style:color={r.negative ? 'var(--fg1)' : 'var(--green)'}>
						{r.amount}
					</span>
				</div>
				<div class="r-actions">
					{#if r.isTransfer}
						<form method="POST" action="?/confirmTransfer" use:enhance>
							<input type="hidden" name="id" value={r.id} />
							<button type="submit" class="btn">✓ Own transfer</button>
						</form>
						<form method="POST" action="?/rejectTransfer" use:enhance>
							<input type="hidden" name="id" value={r.id} />
							<button type="submit" class="btn">✕ Not a transfer</button>
						</form>
					{:else}
						<form method="POST" action="?/categorize" use:enhance class="cat-form">
							<input type="hidden" name="id" value={r.id} />
							<!-- Not a native select. Its popup is placed by the browser, and on
						     this screen — a long queue of rows, each with a chooser — opening
						     one near the bottom expanded downwards past the fold, so the
						     categories were off-screen until you scrolled to find them.
						     CategoryPicker measures the room it has and opens upwards when
						     there is more above. Without a suggestion the value starts empty,
						     so an unguessed row never looks as though it were already filed. -->
							<CategoryPicker
								name="categoryId"
								groups={data.categories}
								value={r.suggestedCategoryId}
								onpick={(id) => (chosen[r.id] = id)}
							/>
							<!-- The one category that needs a second answer, and only when the
						     account cannot give it: money into a JOINT account filed as
						     salary belongs to somebody, and nothing here knows who. An
						     account with an owner is never asked. -->
							{#if picked(r) === 'salary' && r.accountIsJoint && data.people.length > 1}
								<label class="whose">
									<span>Whose?</span>
									<select name="salaryPersonId" required>
										<option value="" disabled selected>Pick a person</option>
										{#each data.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
									</select>
								</label>
								<label class="whose remember">
									<input type="checkbox" name="rememberWhose" checked />
									<span>Remember for “{r.merchant}”</span>
								</label>
							{/if}
							<!-- Disabled until something is chosen: the placeholder posts an empty
						     category, which the action rejects with a message that used to have
						     nowhere to appear. The row read as an unresponsive button. -->
							<button type="submit" class="btn" disabled={!picked(r)}>Save</button>
						</form>
						<!-- Reachable from the row that prompted it. Nothing fitting is felt
					     here, not on a settings screen. -->
						<button type="button" class="btn" onclick={() => (addingCategory = true)}>
							➕ New category…
						</button>
						<!-- The second answer to the same question, so it is marked as an
					     alternative rather than lined up as a fourth control. This is the
					     case pairing cannot reach: money moved to an account whose
					     statements never arrive, so there is no second leg to match and
					     the row looks like unexplained spending. -->
						<form method="POST" action="?/markOneSided" use:enhance class="one-sided">
							<input type="hidden" name="id" value={r.id} />
							<InfoHint label="What “not spending” means">
								Money moved between your own accounts is neither income nor spending, so this row
								stops counting in either.
								<br /><br />
								Both sides are normally matched automatically when you import both statements. Use this
								when the other account's statements never arrive — a savings account you do not import
								— so there is no second half to match against.
							</InfoHint>
							<label class="os-phrase">
								<span>Moved to</span>
								<select name="toAccountId" required aria-label="Which of your accounts">
									<option value="" disabled selected>which account?</option>
									{#each data.accounts.filter((a) => a.id !== r.accountId) as a (a.id)}
										<option value={a.id}>{a.name}</option>
									{/each}
								</select>
							</label>
							<!-- Named for what it does to the figures, not for what it is
						     called internally: "It is a transfer" said nothing about why
						     you would press it. -->
							<button type="submit" class="btn">Not spending</button>
						</form>
					{/if}
				</div>

				{#if form?.message && form?.id === r.id}
					<p class="row-error" role="alert">{form.message}</p>
				{/if}
			</div>
		{/each}
	</section>

	<section class="section">
		<div class="eyebrow-row">
			<Eyebrow hue="--teal" icon="receipt" label="Statements" />
			<span class="eyebrow-caption">
				{data.statements.length}
				{data.statements.length === 1 ? 'account' : 'accounts'}
			</span>
		</div>
		<div class="card statements">
			{#each data.statements as a (a.id)}
				<div class="stmt">
					<IconTile hue="--teal" emoji={a.emoji} size={30} />
					<span class="stmt-mid">
						<span class="stmt-name">{a.name}</span>
						<span class="stmt-sub">
							{a.cadence ?? 'no rhythm yet'} · {a.to ? `statement to ${a.to}` : 'no statement yet'}
						</span>
					</span>
					{#if a.days !== null}
						<span class="mono stmt-days">{a.days} {a.days === 1 ? 'day' : 'days'}</span>
					{/if}
					{#if a.overdue}<Pill hue="yellow">overdue</Pill>{/if}
				</div>
			{:else}
				<p class="stmt-empty">
					No accounts yet. Add one on the Accounts screen and its statements land here.
				</p>
			{/each}
		</div>
	</section>
</div>

{#if addingCategory}
	<Modal title="New category" onclose={() => (addingCategory = false)}>
		<form
			method="POST"
			action="?/addCategory"
			use:enhance={() => {
				return async ({ result, update }) => {
					// Stay open on a refusal so the message lands next to the field that
					// caused it, rather than closing and losing what was typed.
					if (result.type === 'success') {
						addingCategory = false;
						newGroupLabel = '';
					}
					await update();
				};
			}}
			class="cat-modal"
		>
			<label>
				<span>Name</span>
				<input name="name" placeholder="Pharmacy" required />
			</label>
			<label>
				<span>Group</span>
				<select name="groupKey" disabled={newGroupLabel.trim() !== ''}>
					{#each data.groups as g (g.key)}
						<option value={g.key}>{g.label}</option>
					{/each}
				</select>
			</label>
			<div class="cat-newgroup">
				<label>
					<span>…or start a new group</span>
					<input name="newGroupLabel" bind:value={newGroupLabel} placeholder="Pets" />
				</label>
				{#if newGroupLabel.trim()}
					<label>
						<span>Is it money in, money out, or money kept?</span>
						<select name="newGroupRole">
							{#each data.groupRoles as role (role)}
								<option value={role}>{ROLE_LABELS[role] ?? role}</option>
							{/each}
						</select>
					</label>
					<!-- Colour is not asked for. The palette is ranked by how well each
					     colour separates from the others under colour-vision deficiency,
					     so the next one down is always the best remaining choice — and a
					     free colour picker would produce two series nobody can tell
					     apart. It can be changed afterwards from Settings. -->
					<p class="cat-note">It takes the next colour from the palette.</p>
				{/if}
			</div>
			{#if form?.message}
				<p class="cat-error" role="alert">{form.message}</p>
			{/if}
			<div class="cat-actions">
				<button type="submit" class="btn btn-primary">Add category</button>
				<button type="button" class="btn" onclick={() => (addingCategory = false)}>Cancel</button>
			</div>
		</form>
	</Modal>
{/if}

<style>
	.decide {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-7);
		align-items: start;
	}
	@media (max-width: 899px) {
		.decide {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.statements {
		display: flex;
		flex-direction: column;
		padding-top: var(--space-3);
		padding-bottom: var(--space-3);
	}
	.stmt {
		display: grid;
		grid-template-columns: 30px minmax(0, 1fr) auto auto;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-5) 0;
		border-top: 1px solid var(--bd);
	}
	.stmt:first-child {
		border-top: 0;
	}
	.stmt-mid {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.stmt-name {
		font-size: var(--text-md);
		font-weight: 500;
	}
	.stmt-sub {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.stmt-days {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.stmt-empty {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* The empty state is the answer, not the absence of one. */
	.all-filed {
		display: flex;
		align-items: center;
		gap: var(--space-7);
		padding: 18px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-tile);
		background: var(--green-wash);
	}
	.filed-tile {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--green) var(--tile-alpha-active), transparent);
		color: var(--green);
		flex: none;
	}
	.filed-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.filed-title {
		font-size: var(--text-lg);
		font-weight: 600;
	}
	.filed-note {
		font-size: 12.5px;
		color: var(--fg3);
		line-height: 1.5;
	}

	.whose {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.whose.remember {
		color: var(--fg3);
	}

	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	/* A taller, more prominent target than elsewhere — importing statements is
	   what this screen is for — but still a ROW: the dropzone is a one-line
	   control now, and a column layout drops its capture buttons onto a second
	   line under the copy. */
	.asked {
		margin: 0 0 var(--space-5);
		font-size: var(--text-base);
		color: var(--fg2);
	}
	:global(.dropzone) {
		padding: 34px 24px;
		justify-content: center;
		text-align: center;
		background: var(--card);
	}
	/* Do not let the copy claim the whole row, or the buttons are pushed to the
	   far edge instead of sitting with the text they belong to. */
	:global(.dropzone .title) {
		flex: 0 1 auto;
	}
	.assign {
		display: flex;
		align-items: baseline;
		gap: var(--space-5);
		flex-wrap: wrap;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.assign-note {
		font-size: var(--text-xs);
	}
	.wizard {
		display: grid;
		gap: 1rem;
	}

	.w-columns {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		/* Three bands — header, role, sample — owned by this grid rather than by
		   each column. Every .w-col opts into them with subgrid instead of
		   starting a grid of its own, which is what let one two-line header push
		   its own select down and nobody else's. */
		grid-auto-rows: auto;
		gap: 0.75rem;
	}

	.w-col {
		display: grid;
		grid-row: span 3;
		grid-template-rows: subgrid;
		gap: 0.25rem;
	}

	.w-head {
		font-weight: 600;
		font-size: var(--text-lg);
		overflow-wrap: anywhere;
	}

	.w-sample {
		font-size: var(--text-sm);
		opacity: 0.7;
		overflow-wrap: anywhere;
	}

	.w-conventions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.inline-form {
		display: inline;
	}

	.imports {
		display: grid;
		gap: 0.25rem;
	}

	.import-row summary {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		cursor: pointer;
		padding: 0.35rem 0;
		/* The same token .result-row uses for the queue above. Without it this
		   inherited body's --text-xl, so one filename was 16px in the recent list
		   and 13px in the queue. */
		font-size: var(--text-md);
	}

	.i-meta {
		opacity: 0.75;
		font-size: var(--text-md);
	}

	.i-body {
		padding: 0.25rem 0 0.75rem 1rem;
	}

	.i-proof {
		margin: 0 0 0.4rem;
		font-size: var(--text-lg);
	}

	.i-checks {
		margin: 0;
		padding-left: 1rem;
		display: grid;
		gap: 0.2rem;
		font-size: var(--text-md);
	}

	.i-checks .c-name {
		opacity: 0.7;
	}

	.i-checks li.failed .c-detail {
		color: var(--red);
	}

	.queue-depth {
		margin: 0 0 0.5rem;
		font-size: var(--text-md);
		opacity: 0.75;
	}

	.results {
		display: flex;
		flex-direction: column;
	}
	.result-row {
		display: flex;
		justify-content: space-between;
		gap: var(--space-7);
		/* A refused row carries a sentence and a button, not a word. Without this
		   it stayed on one line and pushed the page 817px wide at 390px. */
		flex-wrap: wrap;
		padding: 8px 0;
		border-top: 1px solid var(--bd);
		font-size: var(--text-md);
	}
	.result-row:first-child {
		border-top: 0;
	}
	.r-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.r-dismiss {
		background: none;
		border: 0;
		color: var(--fg3);
		cursor: pointer;
		padding: 0 var(--space-3);
		font-size: var(--text-md);
		line-height: 1;
	}
	.r-dismiss:hover:not(:disabled) {
		color: var(--fg1);
	}
	.r-dismiss:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.r-meta {
		color: var(--fg3);
		font-size: var(--text-sm);
		/* Was `white-space: nowrap`, which suits "waiting" and "12 added · 3 known
		   · 1 paired" and is catastrophic for the other thing this holds: the
		   reader's refusal sentence, followed by a "Map its columns" button. A
		   flex item will not shrink below its content without min-width:0, so on
		   a phone that single row became 1160px wide. */
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.review-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.one-sided {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.os-phrase {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.cat-modal {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.cat-modal label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.cat-newgroup {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding-top: 10px;
		border-top: 1px solid var(--bd);
	}
	.cat-note {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.cat-error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--red);
	}
	.cat-actions {
		display: flex;
		gap: var(--space-4);
	}
	.row-error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--red);
	}
	.r-facts {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr) auto;
		gap: var(--space-6);
		align-items: baseline;
	}
	.r-date {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.r-mid {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.r-merchant {
		font-size: var(--text-md);
		font-weight: 500;
	}
	.r-reason {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.r-amount {
		font-size: var(--text-lg);
	}
	.r-actions {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
		border-top: 1px solid var(--bd);
		padding-top: 10px;
	}
	/* Filing sits left, the transfer answer sits right. They answer the same
	   question, and opposite ends say they are alternatives far better than five
	   controls in one queue did. */
	.one-sided {
		margin-left: auto;
	}
	.cat-form {
		display: flex;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	@media (max-width: 640px) {
		.r-facts {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.r-date {
			grid-column: 1 / -1;
		}
	}
</style>
