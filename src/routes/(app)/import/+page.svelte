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
	import { stillInQueue } from '$lib/import/queue-view';
	import { UNTRACKED_ACCOUNT } from '$lib/import/transfer-target';
	import { LANE_LEGEND, laneStyle } from '$lib/import/review-lane';

	let { data, form } = $props();

	let assignAccountId = $state('');

	// Pre-answer the picker when the Statements ribbon sent you here from a gap.
	// An effect, not an initial value, because a client-side navigation never
	// re-runs an initialiser. Only a starting point — the picker is still yours to change.
	$effect(() => {
		if (data.prefill.accountId) assignAccountId = data.prefill.accountId;
	});

	/** The month this upload was asked for, in words, or null when the ribbon named none. */
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

	// Deliberately NOT bind:value with a seeded record: binding overrides the
	// `selected` attributes below, so the browser would fall back to the first
	// enabled option and an unguessed row would read as already filed with Salary.
	const ROLE_LABELS: Record<string, string> = {
		income: 'Money in',
		expense: 'Money out',
		savings: 'Money kept'
	};
	let addingCategory = $state(false);
	/** Blank means "put it in an existing group"; a name here creates one. */
	let newGroupLabel = $state('');
	let chosen = $state<Record<string, string>>({});
	/**
	 * Rows where the remembered person has been waved off for this one filing.
	 * Per row, not a screen-wide toggle: correcting one payday should not put
	 * every other salary row back to a blank question.
	 */
	let overriding = $state<Record<string, boolean>>({});
	const picked = (r: { id: string; suggestedCategoryId: string | null }) =>
		chosen[r.id] ?? r.suggestedCategoryId ?? '';

	// Cleared once none of THIS upload's files still need an account — keeping
	// it held across uploads forced every later batch into the same account.
	// Scoped to `form.queued` rather than the whole queue: settled jobs linger
	// for an hour, and reading the whole queue kept the choice pinned to every
	// batch dropped afterwards.
	$effect(() => {
		const batch = new Set(form?.queued ?? []);
		if (batch.size === 0) return;
		const results = data.queue.files
			.filter((f) => batch.has(f.id))
			.map((f) => f.result)
			.filter((r) => r !== null);
		if (results.length > 0 && !results.some((result) => result.needsAccount)) assignAccountId = '';
	});

	// Poll while the queue has work; the upload returns as soon as files are
	// accepted, so the page must find out for itself when each is read.
	const busy = $derived(data.queue.waiting + data.queue.running > 0);

	// The rule lives in `$lib/import/queue-view`, where it can be read and
	// tested as one sentence. `data.queue.files` keeps the full list: the
	// account-picker effect above reads results off it, settled ones included.
	const inFlight = $derived(data.queue.files.filter(stillInQueue));
	$effect(() => {
		if (!busy) return;
		const timer = setInterval(() => void invalidateAll(), 1500);
		return () => clearInterval(timer);
	});

	// FileList from a browse or drop; File[] from the scan engine, which
	// builds its PDF in memory with no FileList to hand over.
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

	{#if inFlight.length > 0}
		<div class="card results">
			{#if busy}
				<p class="queue-depth">
					Reading {data.queue.running} of {inFlight.length} — {data.queue.waiting} waiting.
				</p>
			{/if}
			{#each inFlight as job (job.id)}
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
					<!-- A read under way can't be stopped; anything else (cancel while
					     waiting, tidy up once settled) can. Settled rows also expire after ten minutes. -->
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
									: 'Clear this failure'}
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
		<!-- Confirming a mapping does not skip the proof: it is still checked
		     against the statement's own balances like any other reading. -->
		<form method="POST" action="?/confirmMapping" use:enhance class="card wizard">
			<input type="hidden" name="jobId" value={form.preview.jobId} />
			<input type="hidden" name="source" value={form.preview.source} />
			<input type="hidden" name="encoding" value={form.preview.encoding ?? ''} />
			<input type="hidden" name="delimiter" value={form.preview.delimiter ?? ''} />

			{#if form.preview.drift}
				<!-- Matched by label, not position, so an added column shows as a
				     named difference instead of shifting every role silently. -->
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
		<!-- Shows the checks that accepted each statement, so "accepted" is
		     inspectable rather than taken on trust. -->
		<div class="card imports">
			{#each data.imports as file (file.id)}
				<details class="import-row">
					<summary>
						<span class="i-name">{file.filename}</span>
						<!-- The count in its own right-aligned cell: as one string it moved
						     with the filename's length, so no two rows' figures lined up. -->
						<span class="i-count mono">{file.rowsAdded}</span>
						<span class="i-meta mono">
							filed{#if file.readAs}&nbsp;· {file.readAs}{/if}
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
				{data.reviewCount === 0
					? 'nothing waiting'
					: `${data.reviewCount} rows the categoriser will not guess at`}
			</span>
		</div>

		{#if data.reviewCount === 0}
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

		{#if data.reviewCount > 0}
			<div class="lane-legend">
				{#each LANE_LEGEND as key (key.lane)}
					<span class="lane-key" style:--lane="var({key.colour})">
						<span class="lane-dot"></span>{key.label}
					</span>
				{/each}
			</div>
		{/if}

		{#each data.reviewGroups as group (group.key)}
			{@const lane = laneStyle(group.rows[0])}
			<!-- One payee, one card. The strip says WHY the card is here, so a
			     queue can be scanned instead of read; the reason text under each
			     name still carries the detail. -->
			<div class="card review-row" data-lane={lane.lane} style:--lane="var({lane.colour})">
				<span class="sr-only">{lane.label}</span>

				{#if group.rows.length > 1}
					<!-- Only when there IS a group: a heading over a single row would
					     repeat the name directly beneath it. -->
					<div class="g-head">
						<span class="g-label">{group.label}</span>
						<!-- Built as one string rather than with inline {#if}s: Svelte
						     collapses the whitespace around a block, which ran the two
						     halves together as "4 rows· 2 at the same amount". -->
						<span class="g-count">
							{group.repeated.length > 0
								? `${group.rows.length} rows · ${group.repeated.length} at the same amount`
								: `${group.rows.length} rows`}
						</span>
					</div>
				{/if}

				{#each group.rows as r, index (r.id)}
					<div class="g-row" class:subsequent={index > 0}>
						{#if group.repeated.includes(r.id)}
							<!-- The ledger's own signature of a standing payment: the same
							     sum to the same place, month after month. A hint to read
							     the group as a series, not a claim of duplication. -->
							<span class="g-repeat">same amount again</span>
						{/if}
						<div class="r-facts">
							<span class="mono r-date">{r.date}</span>
							<div class="r-mid">
								<span class="r-merchant">
									{r.merchant}
									{#if r.detail.length > 0}
										<!-- The name on a Czech statement is often the payment method —
								     "QR Platba", "okamžitá" — and the payee is nowhere in the
								     document. What identifies it is the account number it went
								     to, so that is put one keypress away rather than nowhere. -->
										<InfoHint label="What the statement said about this row">
											<span class="detail-list">
												{#each r.detail as fact (fact.label)}
													<span class="detail-row">
														<span class="detail-label">{fact.label}</span>
														<span class="mono detail-value">{fact.value}</span>
													</span>
												{/each}
											</span>
										</InfoHint>
									{/if}
								</span>
								<span class="r-reason">{r.reason} · {r.account}</span>
							</div>
							<span class="mono r-amount" style:color={r.negative ? 'var(--fg1)' : 'var(--green)'}>
								{r.amount}
							</span>
						</div>
						{#if r.pairedWith}
							<!-- The other half, stacked under this one. Same shape as the row
					     above it, so the two read as a pair and the eye can check the
					     date, the account and that the amounts are opposite. -->
							<div class="r-facts paired">
								<span class="mono r-date">{r.pairedWith.date}</span>
								<div class="r-mid">
									<span class="r-merchant">
										{r.pairedWith.merchant}
										{#if r.pairedWith.detail.length > 0}
											<InfoHint label="What the statement said about the other leg">
												<span class="detail-list">
													{#each r.pairedWith.detail as fact (fact.label)}
														<span class="detail-row">
															<span class="detail-label">{fact.label}</span>
															<span class="mono detail-value">{fact.value}</span>
														</span>
													{/each}
												</span>
											</InfoHint>
										{/if}
									</span>
									<span class="r-reason">
										{r.pairedWith.account} ·
										{r.pairedWith.daysApart === 0
											? 'same day'
											: `${r.pairedWith.daysApart} day${r.pairedWith.daysApart === 1 ? '' : 's'} apart`}
									</span>
								</div>
								<span
									class="mono r-amount"
									style:color={r.pairedWith.negative ? 'var(--fg1)' : 'var(--green)'}
								>
									{r.pairedWith.amount}
								</span>
							</div>
						{/if}
						<div class="r-actions">
							{#if r.isTransfer}
								<form method="POST" action="?/confirmTransfer" use:enhance>
									<input type="hidden" name="id" value={r.id} />
									<button type="submit" class="btn">✓ Internal transfer</button>
								</form>
								<form method="POST" action="?/rejectTransfer" use:enhance>
									<input type="hidden" name="id" value={r.id} />
									<!-- Rejecting the MATCH, not the row: both legs go back to the
							     queue to be categorised separately, and either may still be a
							     transfer to somewhere else. "Not a transfer" read as a claim
							     about the one row on screen. -->
									<button type="submit" class="btn">✕ Not the same</button>
								</form>
							{:else}
								<form method="POST" action="?/categorize" use:enhance class="cat-form">
									<input type="hidden" name="id" value={r.id} />
									<!-- Not a native select: a long queue means the popup can open near
						     the bottom of the viewport, so it measures its room and opens
						     upwards when needed. -->
									<CategoryPicker
										name="categoryId"
										groups={data.categories}
										value={r.suggestedCategoryId}
										onpick={(id) => (chosen[r.id] = id)}
									/>
									<!-- Only asked when the account can't say whose it is: a JOINT
						     account gives no owner for salary money. -->
									{#if picked(r) === 'salary' && r.accountIsJoint && data.people.length > 1}
										{#if r.salaryFor && !overriding[r.id]}
											<!-- It already knows, so it says so instead of asking again.
									     Shown rather than applied silently: this decides whose
									     salary history and whose retirement projection the money
									     lands in, and the one screen that could show it did not. -->
											<span class="whose settled">
												<Icon name="check" size={14} />
												<span><strong>{r.salaryFor.name}</strong>'s pay</span>
												<input type="hidden" name="salaryPersonId" value={r.salaryFor.personId} />
												<button
													type="button"
													class="link-btn"
													onclick={() => (overriding[r.id] = true)}
												>
													{r.salaryFor.learned ? 'not theirs?' : 'change'}
												</button>
											</span>
										{:else}
											<label class="whose">
												<span>Whose?</span>
												<select name="salaryPersonId" required>
													<option value="" disabled selected>Pick a person</option>
													{#each data.people as p (p.id)}<option value={p.id}>{p.name}</option
														>{/each}
												</select>
											</label>
											<label class="whose remember">
												<input type="checkbox" name="rememberWhose" checked />
												<span>Remember for “{r.merchant}”</span>
											</label>
										{/if}
									{/if}
									<!-- Disabled until something is chosen — the placeholder posts an
						     empty category, which the action would reject as an unresponsive-looking button. -->
									<button type="submit" class="btn" disabled={!picked(r)}>Save</button>
								</form>
								<button type="button" class="btn" onclick={() => (addingCategory = true)}>
									➕ New category…
								</button>
								<!-- For the case pairing cannot reach: a transfer whose other account's
					     statements never arrive, so it looks like unexplained spending. -->
								<form method="POST" action="?/markOneSided" use:enhance class="one-sided">
									<input type="hidden" name="id" value={r.id} />
									<InfoHint label="What “not spending” means">
										Money moved between your own accounts is neither income nor spending, so this
										row stops counting in either.
										<br /><br />
										Both sides are normally matched automatically when you import both statements. Use
										this when the other account's statements never arrive — a savings account you do not
										import — so there is no second half to match against.
									</InfoHint>
									<!-- "to" or "from" by the SIGN of the row. Money arriving was asked
						     "Moved to which account?" while the reader was looking at the
						     account it had just arrived in, so the only true answer was the
						     one the question appeared to rule out. -->
									<label class="os-phrase">
										<span>{r.negative ? 'Moved to' : 'Came from'}</span>
										<select
											name="toAccountId"
											required
											aria-label={r.negative
												? 'Which of your accounts it went to'
												: 'Which of your accounts it came from'}
										>
											<option value="" disabled selected={!r.recalled}>which account?</option>
											{#each data.accounts.filter((a) => a.id !== r.accountId) as a (a.id)}
												<option value={a.id} selected={r.recalled?.toAccountId === a.id}>
													{a.name}
												</option>
											{/each}
											<!-- For an account that was closed, or a bank never added
									     here: still the household's own money moving, so still
									     neither income nor spending, but there is no row to
									     name. -->
											<option value={UNTRACKED_ACCOUNT} selected={r.recalled?.untracked === true}>
												another account · closed or not tracked
											</option>
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
					<IconTile hue="--teal" emoji={a.emoji} logo={a.logo} size={30} />
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
	/* Taller and more prominent, but still a ROW: a column layout drops the
	   capture buttons onto a second line under the copy. */
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
		/* Three bands (header, role, sample) owned by this grid; each .w-col uses
		   subgrid instead of its own grid, so a two-line header doesn't push only
		   its own select down. */
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

	/* A grid, not space-between: the name takes what is left, the count gets a
	   column of its own so every row's figure ends on the same edge, and the
	   label after it starts on the same edge too. */
	.import-row summary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto;
		align-items: baseline;
		gap: 0.5rem;
		cursor: pointer;
		padding: 0.35rem 0;
		/* Same token .result-row uses for the queue above, so filename sizing matches. */
		font-size: var(--text-md);
	}

	.i-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.i-count {
		text-align: right;
		/* Four digits without reflowing; a wider count simply takes more. */
		min-width: 4ch;
		opacity: 0.75;
	}

	.i-meta {
		opacity: 0.75;
		font-size: var(--text-md);
		/* Sits between the count and the ✕, with room before the button. */
		margin-right: 0.5rem;
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
		/* A refused row carries a sentence and a button, not a word, so it needs to wrap. */
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
		/* This also holds a refusal sentence plus button, not just short status
		   text, so nowrap overflows — needs min-width:0 to shrink on a phone. */
		min-width: 0;
		overflow-wrap: anywhere;
	}
	/*
	 * The lane colour IS the card's top border, rather than a strip drawn over
	 * it. An absolutely positioned strip has to be clipped to the card's corner
	 * radius or it squares the top two off, and `overflow: hidden` to do that
	 * also clips the category popup, which opens past the card's own edge. A
	 * border needs no clipping: the radius already curves it, and the card
	 * cannot swallow anything that opens out of it.
	 *
	 * Every row has a lane — `unknown` is the fallback, not an absence — so the
	 * extra two pixels are on every card in the list and nothing shifts.
	 */
	.review-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		border-top: 3px solid var(--lane);
	}

	/* Announced to a screen reader, which cannot see a colour. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	/* The answer the screen already has, stated rather than asked. */
	.whose.settled {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.whose.settled :global(svg) {
		color: var(--green);
	}
	.link-btn {
		padding: 0;
		border: none;
		background: none;
		color: var(--blue);
		font-size: var(--text-xs);
		cursor: pointer;
		text-decoration: underline;
	}

	/* Same dot and words above the queue, so the colours are readable without
	   having to work them out from context. */
	.lane-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-5);
		margin-bottom: var(--space-4);
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.lane-key {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.lane-dot {
		width: 9px;
		height: 3px;
		border-radius: 2px;
		background: var(--lane);
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
	/* Indented under the row it belongs to, with a rule up its left edge: the
	   two are one decision, not two rows that happen to be adjacent. */
	.r-facts.paired {
		margin-top: var(--space-4);
		padding-left: var(--space-5);
		border-left: 2px solid color-mix(in srgb, var(--teal) 40%, transparent);
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
		/* The name and its (i) share a line and wrap together. */
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	/*
	 * A grouped card: one payee heading, then its rows separated by a rule.
	 * Every row keeps its own picker and its own Save — grouping puts the same
	 * decision in one place, it does not make the decision once for all of them.
	 */
	.g-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.g-label {
		font-size: var(--text-lg);
		font-weight: 600;
	}
	.g-count {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.g-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	/* A hairline between rows of the same card, so they read as a list rather
	   than as one long undifferentiated block. */
	.g-row.subsequent {
		border-top: 1px solid var(--bd);
		padding-top: var(--space-5);
	}
	.g-repeat {
		align-self: flex-start;
		font-size: var(--text-xs);
		color: var(--teal);
	}

	/* Label/value pairs inside the (i): a small two-column grid so the values
	   line up under each other and an account number can be read at a glance. */
	.detail-list {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2) var(--space-5);
	}
	.detail-row {
		display: contents;
	}
	.detail-label {
		color: var(--fg3);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.detail-value {
		font-size: var(--text-sm);
		/* An "on the statement" line is a whole sentence; it wraps rather than
		   stretching the bubble past its max-width. */
		overflow-wrap: anywhere;
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
	/* Filing sits left, the transfer answer sits right — opposite ends read as alternatives. */
	.one-sided {
		margin-left: auto;
	}
	/*
	 * The picker is given a fixed width, so Save and "New category…" sit in the
	 * same place on every row.
	 *
	 * Sized to its own text, the trigger was as wide as whatever it happened to
	 * be showing — "Apple" one row, "Choose a category…" the next — and the two
	 * buttons after it slid left and right down the list. A control you press
	 * fifty times in a row should not move between presses. The label already
	 * ellipsises, so a long category name is truncated rather than pushing
	 * anything.
	 */
	.cat-form {
		display: flex;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.cat-form :global(.picker) {
		flex: 0 0 auto;
		width: 13rem;
	}
	/*
	 * On a phone the card's controls are laid out, not left to wrap.
	 *
	 * Wrapping put each control wherever the one before it happened to end: the
	 * picker took a line, "New category…" sat beside it, Save dropped below,
	 * the (i) landed alone on a line of its own and "Not spending" on another —
	 * four ragged rows that changed shape with the category name. Two explicit
	 * grids instead, so every card looks the same and the tap targets are where
	 * they were on the last one.
	 */
	@media (max-width: 640px) {
		.r-actions {
			align-items: stretch;
		}
		/* Choose, then save: the picker takes the line and Save sits at its end. */
		.cat-form {
			flex: 1 1 100%;
			align-items: center;
		}
		.cat-form :global(.picker) {
			flex: 1 1 auto;
			/* minmax-equivalent for flex: without min-width the trigger's own
			   content width would push Save off the screen edge instead of
			   shrinking, and the label already ellipsises. */
			min-width: 0;
			width: auto;
		}
		/* Whose salary it is — its own line, never squeezed beside a button. */
		.cat-form .whose {
			flex: 1 1 100%;
		}
		/* "New category…" is a sibling of the form, not part of it, so it gets a
		   line of its own rather than trailing whatever the row above ended on. */
		.r-actions > button[type='button'] {
			flex: 1 1 100%;
		}

		.one-sided {
			display: flex;
			width: 100%;
			margin-left: 0;
		}
		/*
		 * The (i) keeps its place beside the words rather than being pushed onto
		 * a line by itself; the select takes whatever is left, down to nothing —
		 * minmax(0, 1fr) rather than 1fr, or its own minimum width would push
		 * the label off the screen edge instead of shrinking.
		 */
		.os-phrase {
			/* Basis 0, not auto: with `auto` the phrase asks for the width its
			   label and select would like, which is more than the line has left
			   after the (i) — so it wrapped, and the (i) was left sitting on a
			   line of its own. Measured at 390px: the three sit on one row. */
			flex: 1 1 0;
			min-width: 0;
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
		}
		.os-phrase select {
			min-width: 0;
		}
		/* "Not spending" is the row's verb: its own full-width line under it. */
		.one-sided > button[type='submit'] {
			flex: 1 1 100%;
		}
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
