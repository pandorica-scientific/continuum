<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// The Statements shelf as coverage: one band per account, across one year.
	//
	// A list of ninety-six statements looks exactly the same whether or not
	// April is among them, which is the whole problem — this shelf's only
	// failure is a month that never arrived, and absence has no row. So the
	// twelve months are drawn whether or not anything filled them.
	//
	// Two rules do the work and they are not the same rule. A FILED box spans
	// the months its statement covers, because a real statement says how far it
	// reaches. An EMPTY box is always one month, because nothing says whether a
	// hole is one missing quarterly statement or three missing monthly ones —
	// see `$lib/statements/coverage`, which decides all of it.
	import Icon from '$lib/components/Icon.svelte';
	import InfoHint from '$lib/components/InfoHint.svelte';
	import type { CoveragePayload } from '$lib/server/statements/coverage-load';
	import { DECADE, lastOfMonth } from '$lib/statements/coverage';

	let {
		coverage,
		onopen,
		onyear,
		ondecade
	}: {
		coverage: CoveragePayload;
		onopen: (documentId: string) => void;
		onyear: (year: number) => void;
		ondecade: (firstYear: number) => void;
	} = $props();

	const MONTHS = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];

	/** `2026`, `3` → `2026-04-01`. The month a box starts in. */
	const firstDay = (year: number, month: number): string =>
		`${year}-${String(month + 1).padStart(2, '0')}-01`;

	/**
	 * Where a missing month sends you: the import, already answered.
	 *
	 * The import and not a plain upload, because an accepted one does two jobs
	 * at once — it writes the ledger rows AND files the document with its period
	 * already known, so the month closes without anybody typing a date.
	 */
	const fileHref = (accountId: string, year: number, month: number): string => {
		const from = firstDay(year, month);
		return `/import?account=${accountId}&from=${from}&to=${lastOfMonth(from)}`;
	};

	const monthName = (year: number, month: number): string => `${MONTHS[month]} ${year}`;

	/**
	 * The period whose contents are listed below the band, if any.
	 *
	 * A period holding ONE document opens it: the list would be a menu of one.
	 * A period holding several cannot open "the" document, and splitting the box
	 * into halves — what this did before — stops meaning anything at three. So a
	 * crowded period opens a list of what it holds, and the list is where the
	 * choice is made.
	 */
	let open = $state<{ band: 'monthly' | 'yearly'; accountId: string; column: number } | null>(null);

	const isOpen = (band: 'monthly' | 'yearly', accountId: string, column: number): boolean =>
		open?.band === band && open.accountId === accountId && open.column === column;

	function pressed(
		band: 'monthly' | 'yearly',
		accountId: string,
		column: number,
		documentIds: string[]
	) {
		if (documentIds.length === 1) {
			onopen(documentIds[0]);
			return;
		}
		open = isOpen(band, accountId, column) ? null : { band, accountId, column };
	}

	/** `Apr 2026` or `2025` — what the open list is headed with. */
	const periodLabel = (band: 'monthly' | 'yearly', column: number): string =>
		band === 'monthly'
			? monthName(coverage.year, column)
			: String((coverage.yearly?.firstYear ?? coverage.year) + column);

	/** The documents an open period holds, in the order the band recorded them. */
	const openDocuments = $derived.by(() => {
		if (!open) return [];
		const rows = open.band === 'monthly' ? coverage.rows : (coverage.yearly?.rows ?? []);
		const row = rows.find((r) => r.accountId === open!.accountId);
		const box = row?.boxes.find((b) => b.startMonth === open!.column);
		return (box?.documentIds ?? []).map((id) => coverage.documents[id]).filter(Boolean);
	});

	const openRowLabel = $derived.by(() => {
		if (!open) return '';
		const rows = open.band === 'monthly' ? coverage.rows : (coverage.yearly?.rows ?? []);
		return rows.find((r) => r.accountId === open!.accountId)?.label ?? '';
	});

	// Nothing to see beyond either end: a future year is twelve months of "not
	// arrived yet", and a year before any account existed is twelve blanks.
	const canGoBack = $derived(coverage.year > coverage.firstYear);
	const canGoForward = $derived(coverage.year < coverage.lastYear);

	// The yearly band steps a decade at a time, bounded the same way: back to the
	// decade holding the earliest report, forward no further than this one.
	const decadeBack = $derived(
		coverage.yearly !== null && coverage.yearly.firstYear > coverage.yearly.earliestDecade
	);
	const decadeForward = $derived(
		coverage.yearly !== null && coverage.yearly.firstYear < coverage.yearly.latestDecade
	);

	/** `2020` → `['2020', … '2029']`, the columns of one decade band. */
	const decadeYears = (firstYear: number): number[] =>
		Array.from({ length: DECADE }, (_, i) => firstYear + i);

	/** A whole year, for the import link behind a missing annual report. */
	const yearHref = (accountId: string, year: number): string =>
		`/import?account=${accountId}&from=${year}-01-01&to=${year}-12-31`;
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		// The same bounds the buttons keep. A shortcut that can reach a year the
		// button refuses would be the rule holding in one place only.
		if (e.key === 'ArrowLeft' && canGoBack) onyear(coverage.year - 1);
		if (e.key === 'ArrowRight' && canGoForward) onyear(coverage.year + 1);
	}}
/>

<section class="coverage" aria-label="Statement coverage for {coverage.year}">
	<header>
		<div class="year">
			<button
				type="button"
				aria-label="Previous year"
				disabled={!canGoBack}
				onclick={() => onyear(coverage.year - 1)}
			>
				<Icon name="chevronLeft" size={16} />
			</button>
			<span class="mono y">{coverage.year}</span>
			<button
				type="button"
				aria-label="Next year"
				disabled={!canGoForward}
				onclick={() => onyear(coverage.year + 1)}
			>
				<Icon name="chevronRight" size={16} />
			</button>
		</div>

		<span class="summary" class:none={coverage.gaps === 0}>
			{coverage.gaps === 0
				? 'No gaps this year'
				: `${coverage.gaps} ${coverage.gaps === 1 ? 'gap' : 'gaps'} this year`}
		</span>

		{#if coverage.unplaced > 0}
			<!-- Everything on the shelf is either drawn above or counted here.
			     A document nobody imported has no period and often no account, so
			     there is no month to draw it in — and a broker report belongs to no
			     bank account at all. Named rather than silently absent: an
			     invisible document is worse than a missing one. -->
			<a class="unplaced" href="/documents?shelf=statements&view=list">
				{coverage.unplaced} not on the ribbon · not dated, or not linked to an account
			</a>
		{/if}

		<span class="hint">
			<InfoHint label="What this shelf expects">
				<p>
					Every month an account was open should be covered by a statement. A month that has ended
					with none is a <strong>gap</strong>; the current month and later ones have
					<strong>not arrived yet</strong>.
				</p>
				<p>
					A statement covering several months fills all of them, so a quarterly one draws as a
					single band three months wide. Nothing here guesses how often an account is meant to send
					a statement.
				</p>
				<p>← and → change the year.</p>
			</InfoHint>
		</span>
	</header>

	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th class="account-head" scope="col">Account</th>
					{#each MONTHS as month (month)}
						<th class="month-head mono" scope="col">{month}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each coverage.rows as row (row.accountId)}
					<tr>
						<th class="account" scope="row">
							<span class="account-name">{row.label}</span>
							{#if row.sublabel}<span class="mono account-tail">···· {row.sublabel}</span>{/if}
						</th>
						{#each row.boxes as box (box.startMonth)}
							<td colspan={box.months} class="cell {box.state}">
								{#if box.state === 'filed'}
									<button
										type="button"
										class="filed-box"
										class:open={isOpen('monthly', row.accountId, box.startMonth)}
										class:crowded={box.documentIds.length > 1}
										onclick={() =>
											pressed('monthly', row.accountId, box.startMonth, box.documentIds)}
										aria-expanded={box.documentIds.length > 1
											? isOpen('monthly', row.accountId, box.startMonth)
											: undefined}
										aria-label={box.documentIds.length > 1
											? `List the ${box.documentIds.length} documents covering ${monthName(coverage.year, box.startMonth)} for ${row.label}`
											: `Open the statement covering ${monthName(coverage.year, box.startMonth)} for ${row.label}`}
									>
										{#if box.documentIds.length > 1}
											<span class="mono many">{box.documentIds.length}</span>
										{/if}
									</button>
								{:else if box.state === 'before-account'}
									<span class="empty" aria-label="Before this account existed"></span>
								{:else}
									<a
										class="empty-link"
										href={fileHref(row.accountId, coverage.year, box.startMonth)}
										aria-label="File the statement for {monthName(
											coverage.year,
											box.startMonth
										)} for {row.label}"
									></a>
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if coverage.yearly}
		<!-- Paper that arrives once a year, in a band of its own.
		     A broker's annual report is not a statement that failed to be monthly;
		     it is a different rhythm, and putting it in the twelve-month grid
		     above would draw eleven gaps a year for an account that is perfectly
		     up to date. -->
		<div class="yearly">
			<header class="sub">
				<div class="year">
					<button
						type="button"
						aria-label="Previous decade"
						disabled={!decadeBack}
						onclick={() => ondecade(coverage.yearly!.firstYear - DECADE)}
					>
						<Icon name="chevronLeft" size={16} />
					</button>
					<span class="mono y sm">
						{coverage.yearly.firstYear}–{coverage.yearly.firstYear + DECADE - 1}
					</span>
					<button
						type="button"
						aria-label="Next decade"
						disabled={!decadeForward}
						onclick={() => ondecade(coverage.yearly!.firstYear + DECADE)}
					>
						<Icon name="chevronRight" size={16} />
					</button>
				</div>
				<span class="summary" class:none={coverage.yearly.gaps === 0}>
					{coverage.yearly.gaps === 0
						? 'Once a year · nothing missing'
						: `Once a year · ${coverage.yearly.gaps} ${coverage.yearly.gaps === 1 ? 'year' : 'years'} missing`}
				</span>
			</header>

			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th class="account-head" scope="col">Investment</th>
							{#each decadeYears(coverage.yearly.firstYear) as year (year)}
								<th class="month-head mono" scope="col">{year}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each coverage.yearly.rows as row (row.accountId)}
							<tr>
								<th class="account" scope="row">
									<span class="account-name">{row.label}</span>
									{#if row.sublabel}<span class="mono account-tail">···· {row.sublabel}</span>{/if}
								</th>
								{#each row.boxes as box (box.startMonth)}
									{@const year = coverage.yearly.firstYear + box.startMonth}
									<td colspan={box.months} class="cell {box.state}">
										{#if box.state === 'filed'}
											<button
												type="button"
												class="filed-box"
												class:open={isOpen('yearly', row.accountId, box.startMonth)}
												class:crowded={box.documentIds.length > 1}
												onclick={() =>
													pressed('yearly', row.accountId, box.startMonth, box.documentIds)}
												aria-expanded={box.documentIds.length > 1
													? isOpen('yearly', row.accountId, box.startMonth)
													: undefined}
												aria-label={box.documentIds.length > 1
													? `List the ${box.documentIds.length} documents for ${year} for ${row.label}`
													: `Open the ${year} report for ${row.label}`}
											>
												{#if box.documentIds.length > 1}
													<span class="mono many">{box.documentIds.length}</span>
												{/if}
											</button>
										{:else if box.state === 'before-account'}
											<span class="empty" aria-label="Before this account existed"></span>
										{:else}
											<a
												class="empty-link"
												href={yearHref(row.accountId, year)}
												aria-label="File the {year} report for {row.label}"
											></a>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	{#if open && openDocuments.length > 0}
		<!-- What a crowded period holds, under the band it was opened from.
		     Below rather than floating over: the band it came from stays visible,
		     so it is clear which cell is being explained. -->
		<div class="listing">
			<div class="listing-head">
				<span class="mono period">{periodLabel(open.band, open.column)}</span>
				<span class="listing-who">{openRowLabel}</span>
				<span class="listing-count">· {openDocuments.length} documents</span>
				<!-- The same glyph the inspector's close uses; there is no close icon
				     in the set, and inventing one for a single button would leave two
				     ways to draw the same gesture. -->
				<button
					type="button"
					class="listing-close"
					aria-label="Close the list"
					onclick={() => (open = null)}>✕</button
				>
			</div>
			{#each openDocuments as doc (doc.id)}
				<button type="button" class="listing-row" onclick={() => onopen(doc.id)}>
					<span class="mono listing-ext">{doc.ext}</span>
					<span class="listing-name">
						<span class="listing-title">{doc.name}</span>
						<span class="listing-type">{doc.typeLabel}</span>
					</span>
					<span class="mono listing-date">{doc.addedOn}</span>
				</button>
			{/each}
		</div>
	{/if}

	<footer>
		<span class="key"><span class="swatch filed"></span>filed</span>
		<span class="key"><span class="swatch not-arrived"></span>not arrived yet</span>
		<span class="key">
			<span class="swatch before-account"></span>before the account existed
		</span>
		<span class="key">
			<span class="swatch gap"></span>should be there and is not
		</span>
		<span class="how">Click a band to open it · click a gap to file one</span>
	</footer>
</section>

<style>
	.coverage {
		border: 1px solid var(--bd);
		border-radius: var(--radius-xl);
		background: var(--card);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		padding: 10px 14px;
		border-bottom: 1px solid var(--bd);
	}
	.year {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.year button {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--fg2);
		cursor: pointer;
	}
	.year button:hover:not(:disabled) {
		background: var(--card2);
		color: var(--fg1);
	}
	.year button:disabled {
		color: var(--fg3);
		cursor: default;
	}
	.y {
		font-size: var(--text-xl);
		font-weight: 600;
		min-width: 4ch;
		text-align: center;
	}
	.summary {
		font-size: var(--text-base);
		color: var(--red);
	}
	.summary.none {
		color: var(--fg3);
	}
	.unplaced {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.hint {
		margin-left: auto;
	}
	.yearly {
		border-top: 1px solid var(--bd);
	}
	header.sub {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.y.sm {
		font-size: var(--text-md);
		min-width: 9ch;
	}

	/* The one thing allowed to scroll sideways: twelve months plus a name do not
	   fit a phone, and squeezing them would make every band unreadable rather
	   than making one row inconvenient. */
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 3px;
		padding: var(--space-4) 11px;
	}
	.account-head,
	.month-head {
		font-size: var(--text-xs);
		font-weight: 400;
		color: var(--fg3);
		text-align: center;
		padding-bottom: var(--space-3);
	}
	.account-head {
		text-align: left;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.account {
		text-align: left;
		font-weight: 400;
		padding-right: var(--space-6);
		white-space: nowrap;
	}
	.account-name {
		display: block;
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.account-tail {
		display: block;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.cell {
		height: 30px;
		min-width: 44px;
	}

	/* Filed is the only state that spans, so it is the only one whose box is a
	   flex row: two statements sharing a month split it in half, and each half
	   opens its own document rather than one of them silently winning. */
	.filed-box {
		display: grid;
		place-items: center;
		width: 100%;
		height: 30px;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-sm);
		background: var(--card3);
		cursor: pointer;
	}
	.filed-box:hover {
		background: var(--card2);
	}
	/* A period holding more than one says so, and stays marked while its list is
	   open — otherwise pressing a cell moves content in below with nothing
	   pointing back at which cell did it. */
	.filed-box.crowded {
		color: var(--fg2);
		font-size: var(--text-xs);
	}
	.filed-box.open {
		border-color: var(--fg3);
	}
	.many {
		line-height: 1;
	}

	.listing {
		margin: 0 11px var(--space-5);
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--bg2);
		overflow: hidden;
	}
	.listing-head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding: 10px 12px;
		border-bottom: 1px solid var(--bd);
	}
	.period {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.listing-who {
		font-size: var(--text-base);
		color: var(--fg2);
	}
	.listing-count {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.listing-close {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--fg3);
		cursor: pointer;
	}
	.listing-close:hover {
		color: var(--fg1);
	}
	.listing-row {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		width: 100%;
		padding: 10px 12px;
		border: 0;
		border-top: 1px solid var(--bd);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.listing-row:first-of-type {
		border-top: 0;
	}
	.listing-row:hover {
		background: var(--card2);
	}
	.listing-ext {
		font-size: var(--text-xs);
		color: var(--fg3);
		min-width: 4ch;
	}
	.listing-name {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.listing-title {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.listing-type {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.listing-date {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.empty,
	.empty-link {
		display: block;
		height: 30px;
		border-radius: var(--radius-sm);
	}
	/* Faint, not absent. Drawn as nothing at all, the months before an account
	   existed read as a rendering failure rather than as a period the archive
	   has no opinion about — the row appeared to start halfway along for no
	   stated reason. A hairline says "there is a cell here, and it is not a
	   question". */
	.empty {
		border: 1px solid var(--bd);
		opacity: 0.35;
	}
	.empty-link {
		border: 1px dashed var(--bd2);
	}
	.empty-link:hover {
		border-style: solid;
		background: var(--card3);
	}
	/* Coloured borders are for traffic-light states, which is exactly what this
	   is: a month that should be there and is not. */
	.cell.gap .empty-link {
		border: 1px solid var(--red);
	}
	.cell.gap .empty-link:hover {
		background: color-mix(in srgb, var(--red) 12%, transparent);
	}

	footer {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3) var(--space-6);
		padding: 10px 14px;
		border-top: 1px solid var(--bd);
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.key {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
	}
	.swatch {
		width: 24px;
		height: 14px;
		border-radius: var(--radius-xs);
	}
	.swatch.filed {
		background: var(--card3);
		border: 1px solid var(--bd2);
	}
	.swatch.not-arrived {
		border: 1px dashed var(--bd2);
	}
	.swatch.before-account {
		border: 1px solid var(--bd);
		opacity: 0.35;
	}
	.swatch.gap {
		border: 1px solid var(--red);
	}
	.how {
		margin-left: auto;
	}
</style>
