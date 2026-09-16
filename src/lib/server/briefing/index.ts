// SPDX-License-Identifier: AGPL-3.0-or-later
import { and, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import type { IconName } from '$lib/icons';
import { BRIEFING_STRIP_SIZE } from '$lib/briefing';
import { displayCurrency, formatMinor, fromMajor } from '$lib/money';
import { getBaseCurrency } from '$lib/server/settings';
import { expenseSpendingByMonth, type GroupMonthSpend } from '$lib/server/cashflow/spending';
import {
	account,
	calendarAccount,
	calendarConflict,
	currencyRate,
	document,
	documentLink,
	engagement,
	entity,
	equityGrant,
	holding,
	job,
	lane,
	loan,
	loanFixationPeriod,
	person,
	property,
	propertyValuation,
	shelf,
	taxStatement,
	tenancy,
	transaction
} from '$lib/server/db/schema';
import { archiveScopePredicate } from '$lib/server/documents/visibility';
import { loadRecordDates, ownedByLinkedRecord } from '$lib/server/documents/deadlines';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
import { listShelves, systemShelfId } from '$lib/server/documents/shelves';
import { isDocumentTargetKind, loadTargetNames } from '$lib/server/documents/targets';
import { loadDossier } from '$lib/server/documents/dossier-load';
import { grantsWithTranches } from '$lib/server/equity';
import { trancheState } from '$lib/equity';
import { isStale } from '$lib/prices';
import { latestPrices } from '$lib/server/prices';
import { getPriceSettings } from '$lib/server/prices/settings';
import { attributeSalary } from '$lib/server/salary';
import { getBriefingSettings } from './settings';
import {
	aboutLine,
	briefingCaption,
	countTitle,
	daysBetween,
	laneJudgeable,
	laneShortfall,
	latestJobPerDocument,
	monthsBetween,
	settlementOverdue,
	taxYearToChase
} from './pure';

/** One card on the Overview's briefing strip; exported since the drawing panel needs the same shape. */
export interface BriefingItem {
	icon: IconName;
	kind: string;
	pill: string;
	hue: 'green' | 'yellow' | 'red' | 'blue' | 'grey';
	title: string;
	detail: string;
	href: string;
	/** lower = more urgent; the strip shows the top four */
	rank: number;
}

// Each source scans one domain for things that need attention; the strip
// itself knows about none of them. The optional handle lets a source be
// exercised against a test database.
/** A briefing source. */
type Source = (handle?: Queryable, shared?: BriefingShared) => Promise<BriefingItem[]>;

/**
 * Work the caller has already done, or is about to do for something else.
 *
 * The Overview builds the briefing and the "month against its average" panel
 * on the same load, and both want the same expensive spending query. Optional,
 * since every other caller has nothing to share.
 */
export interface BriefingShared {
	spending?: () => Promise<GroupMonthSpend[]>;
}

const unreviewedImports: Source = async () => {
	const rows = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(transaction)
		.where(sql`${transaction.reviewState} = 'needs_review'`);
	const count = rows[0].count;
	if (count === 0) return [];
	return [
		{
			icon: 'inbox',
			kind: 'Import',
			pill: 'waiting',
			hue: 'blue',
			title: `${count} transaction${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} a decision`,
			detail:
				'Mostly counterparties the categoriser has not seen before. Correcting them teaches it.',
			href: '/import',
			rank: 20
		}
	];
};

/**
 * Paper that arrived and was never filed.
 *
 * The inbox is the one shelf whose contents are work rather than record. An
 * unfiled document has no expiry date and no record to appear beside, so
 * nothing else on the Overview can surface a growing backlog.
 */
const inboxBacklog: Source = async (handle: Queryable = db) => {
	let inboxId: string;
	try {
		inboxId = await systemShelfId(SYSTEM_SHELF_KEYS.inbox, handle);
	} catch {
		// `systemShelfId` throws for a household with no such shelf. A source that
		// only counts has no stake in that, and letting the throw out would take
		// the whole strip down over a shelf nobody uses.
		return [];
	}
	const [row] = await handle
		.select({ count: sql<number>`count(*)::int` })
		.from(document)
		.where(eq(document.shelfId, inboxId));
	const waiting = row.count;
	if (waiting === 0) return [];
	return [
		{
			icon: 'inbox',
			kind: 'Paper',
			pill: `${waiting} waiting`,
			hue: 'blue',
			title: countTitle(waiting, 'document waiting to be filed', 'documents waiting to be filed'),
			detail: 'Until they are filed, no record shows them and no expiry date is watched.',
			href: '/documents?shelf=inbox',
			rank: 25
		}
	];
};

/**
 * How far ahead each source looks, named rather than typed into its own loop.
 *
 * D7's suppression has to ask the same "would this record's own reminder
 * actually be raised?" question, so two spellings of one horizon must not
 * drift apart.
 */
const LEASE_HORIZON_DAYS = 120;
const FIXATION_HORIZON_MONTHS = 30;
const DOCUMENT_HORIZON_DAYS = 210;
/** The average month `fixationHorizon` counts in, so its horizon can be stated in days. */
const DAYS_PER_MONTH = 30.44;

/** The last date a source looking `days` ahead still reaches. */
const remindsThrough = (days: number) =>
	new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const leaseExpiry: Source = async () => {
	const today = new Date().toISOString().slice(0, 10);
	const [tenancies, properties] = await Promise.all([
		db.select().from(tenancy),
		db.select().from(property)
	]);
	const items: BriefingItem[] = [];
	for (const t of tenancies) {
		if (!t.endsOn || t.endsOn < today) continue;
		const days = Math.ceil((new Date(t.endsOn).getTime() - Date.now()) / 86400000);
		if (days > LEASE_HORIZON_DAYS) continue;
		const propertyName = properties.find((p) => p.id === t.propertyId)?.name ?? 'the flat';
		const noticeDue = t.renewalNoticeOn && t.renewalNoticeOn >= today ? t.renewalNoticeOn : null;
		items.push({
			icon: 'key',
			kind: 'Tenancy',
			pill: `${days} days`,
			hue: days <= 60 ? 'yellow' : 'grey',
			title: `${propertyName} lease ends ${t.endsOn}`,
			detail: noticeDue
				? `${t.tenantName} is the tenant. Renewal notice is due by ${noticeDue}.`
				: `${t.tenantName} is the tenant.`,
			// The flat the lease is on, not the top of the property screen: a
			// household with three flats made the reader find the right tab again.
			href: `/property?p=${t.propertyId}`,
			rank: days
		});
	}
	return items;
};

const fixationHorizon: Source = async () => {
	const today = new Date().toISOString().slice(0, 10);
	const [loans, periods] = await Promise.all([
		db.select().from(loan),
		db.select().from(loanFixationPeriod)
	]);
	const items: BriefingItem[] = [];
	for (const l of loans) {
		if (l.owedMinor <= 0n || l.regime !== 'fixed_period') continue;
		const current = periods.find(
			(p) => p.loanId === l.id && p.startsOn <= today && (p.endsOn === null || p.endsOn > today)
		);
		if (!current?.endsOn) continue;
		const months = Math.round(
			(new Date(current.endsOn).getTime() - Date.now()) / (DAYS_PER_MONTH * 86400000)
		);
		if (months > FIXATION_HORIZON_MONTHS) continue;
		const end = new Date(current.endsOn);
		const pill = `${end.toLocaleString('en', { month: 'short' })} ${end.getFullYear()}`;
		items.push({
			icon: 'bank',
			kind: 'Mortgage',
			pill,
			hue: months <= 6 ? 'yellow' : 'grey',
			title: `${l.name} fixation runs to ${pill}`,
			detail:
				months <= 6
					? 'Time to collect refinancing quotes.'
					: `Nothing to do yet. Refinancing quotes are worth collecting from ${end.getFullYear() - 1}.`,
			// The loan's own card, which the screen carries an id for exactly this.
			href: `/loans#loan-${l.id}`,
			rank: 30 + months
		});
	}
	return items;
};

const documentExpiry: Source = async () => {
	const today = new Date().toISOString().slice(0, 10);
	const docs = await db
		.select({ ...getTableColumns(document), shelfLabel: shelf.label })
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		// A document whose only subject is archived (a sold car's insurance) is
		// stale, dropped from the default view like everywhere else.
		.where(archiveScopePredicate(false));
	// What each document belongs to, by current name. The same `links` rows
	// also answer D7 below, avoiding a second query per source.
	const [links, recordDates] = await Promise.all([
		// One table for every kind of target, so the kind comes from `entity`.
		db
			.select({
				documentId: documentLink.documentId,
				targetId: documentLink.targetId,
				kind: entity.kind
			})
			.from(documentLink)
			.innerJoin(entity, eq(entity.id, documentLink.targetId)),
		loadRecordDates()
	]);
	// Narrowed to the ids actually linked: one of the nine target kinds is
	// `transaction`, and naming a receipt would otherwise read the entire ledger.
	const names = await loadTargetNames(
		undefined,
		links.map((link) => link.targetId)
	);
	const about = new Map<string, string[]>();
	for (const link of links) {
		// `entity` holds kinds a document is never filed against (a tag, another
		// document); a link to one of those is not something to name.
		if (!isDocumentTargetKind(link.kind)) continue;
		const name = names.get(link.kind)?.get(link.targetId)?.name;
		if (name === undefined) continue;
		about.set(link.documentId, [...(about.get(link.documentId) ?? []), name]);
	}
	// What the two sources above will and will not have raised by the time this
	// one runs. `emits: true` for both; the conditions that stop `fixationHorizon`
	// raising anything are answered by `loadRecordDates` already.
	const ownersOnTheOverview = {
		tenancy: { emits: true, remindsThrough: remindsThrough(LEASE_HORIZON_DAYS) },
		loan: {
			emits: true,
			// Stated in days like the other, from the months its own source counts in.
			remindsThrough: remindsThrough(Math.round(FIXATION_HORIZON_MONTHS * DAYS_PER_MONTH))
		}
	};

	const items: BriefingItem[] = [];
	for (const d of docs) {
		if (!d.expiresOn || d.expiresOn < today) continue;
		// D7: the record owns the deadline. Skip when `leaseExpiry` or
		// `fixationHorizon` already surfaced this same deadline above — but only
		// where their (narrower) horizons mean they actually did.
		if (ownedByLinkedRecord(d, links, recordDates, ownersOnTheOverview)) continue;
		const days = Math.ceil((new Date(d.expiresOn).getTime() - Date.now()) / 86400000);
		if (days > DOCUMENT_HORIZON_DAYS) continue;
		const months = Math.round(days / DAYS_PER_MONTH);
		items.push({
			icon: 'folders',
			kind: 'Document',
			pill: days <= 45 ? `${days} days` : `${months} month${months === 1 ? '' : 's'}`,
			hue: days <= 60 ? 'yellow' : 'grey',
			title: `${d.name} ${d.expiryVerb} ${d.expiresOn}`,
			detail: aboutLine(d.shelfLabel, about.get(d.id) ?? []),
			// The paper itself, open beside the list, rather than a list to find it in.
			href: `/documents?doc=${d.id}`,
			rank: days + 5
		});
	}
	return items;
};

/** How much of a job's error fits on a card's second line. */
const MAX_ERROR_CHARS = 90;

/**
 * Paper the reader could not get through.
 *
 * The quietest failure the product has: the document looks fine everywhere
 * else, only its CONTENTS were never read, so a content search finds nothing
 * and looks like an answer rather than a gap.
 */
const extractionFailures: Source = async (handle: Queryable = db) => {
	const rows = await handle
		.select({
			documentId: document.id,
			state: job.state,
			queuedAt: job.queuedAt,
			error: job.error
		})
		.from(job)
		.innerJoin(document, eq(document.id, job.subjectId))
		.where(and(eq(job.kind, 'extract_text'), archiveScopePredicate(false)))
		.orderBy(desc(job.queuedAt));

	// Attempts accumulate: a document read successfully on the second try still
	// has its failed row. Only the newest attempt says whether it has text today.
	const latest = latestJobPerDocument(rows);
	const failed = new Set(
		[...latest].filter(([, state]) => state === 'failed').map(([documentId]) => documentId)
	);
	if (failed.size === 0) return [];

	// Rows arrive newest first, so the first one belonging to a failed document
	// is that document's newest attempt.
	const message = rows.find((row) => failed.has(row.documentId))?.error ?? null;
	const [only] = failed;

	return [
		{
			icon: 'alert',
			kind: 'Paper',
			pill: `${failed.size} failed`,
			hue: 'yellow',
			title: countTitle(failed.size, 'document could not be read', 'documents could not be read'),
			// Clipped since the card has one line; where no message was recorded,
			// say what the failure costs instead of repeating that it failed.
			detail:
				message === null
					? 'Search by contents will not find them.'
					: message.length > MAX_ERROR_CHARS
						? `${message.slice(0, MAX_ERROR_CHARS - 1).trimEnd()}…`
						: message,
			href: failed.size === 1 ? `/documents?doc=${only}` : '/documents',
			rank: 40
		}
	];
};

const overspend: Source = async (_handle, shared) => {
	// A category group running well past its average this month. The tally
	// itself is shared with the Overview panel that draws the same comparison,
	// so the two figures cannot disagree.
	const baseCurrency = await getBaseCurrency();
	const rows = await (shared?.spending?.() ?? expenseSpendingByMonth(baseCurrency));

	const thisMonth = new Date().toISOString().slice(0, 7);
	const items: BriefingItem[] = [];
	const groups = [...new Set(rows.map((r) => r.groupKey))];
	for (const groupKey of groups) {
		const history = rows.filter((r) => r.groupKey === groupKey && r.month !== thisMonth);
		const current = rows.find((r) => r.groupKey === groupKey && r.month === thisMonth);
		if (!current || history.length < 3) continue; // not enough record to judge
		const average = history.reduce((sum, row) => sum + row.spentMinor, 0n) / BigInt(history.length);
		const spent = current.spentMinor;
		if (
			average <= 0n ||
			spent * 100n < average * 135n ||
			spent - average < fromMajor(3000, baseCurrency)
		)
			continue;
		const pct = Number(((spent - average) * 100n + average / 2n) / average);
		items.push({
			icon: 'bars',
			kind: 'Spending',
			pill: `+${pct}%`,
			hue: 'yellow',
			title: `${groupKey === 'living' ? 'Food & lifestyle' : groupKey} is running ${pct}% over its average`,
			detail: `${formatMinor(spent, baseCurrency)} ${displayCurrency(baseCurrency)} so far this month against a typical ${formatMinor(average, baseCurrency)} ${displayCurrency(baseCurrency)}.`,
			href: '/cashflow',
			rank: 15
		});
	}
	return items;
};

/**
 * Edits that sync discarded, and dates it wrote back into the ledger.
 *
 * Last-writer-wins is acceptable rather than reckless only because losses are
 * recorded here rather than silent. Write-backs are surfaced separately: a
 * calendar edit that moved a mortgage payment day must not happen unnoticed.
 */
export const calendarConflicts: Source = async (handle: Queryable = db) => {
	const rows = await handle
		.select()
		.from(calendarConflict)
		.where(isNull(calendarConflict.acknowledgedAt))
		.orderBy(calendarConflict.detectedAt);
	if (rows.length === 0) return [];

	const wroteBack = rows.filter((row) => row.resolution === 'wrote-back');
	const discarded = rows.filter((row) => row.resolution !== 'wrote-back');
	const items: BriefingItem[] = [];

	if (wroteBack.length > 0) {
		items.push({
			icon: 'calendar',
			kind: 'calendar',
			pill: wroteBack.length === 1 ? '1 change' : `${wroteBack.length} changes`,
			// Red, not yellow: this changed ledger data, from outside the ledger.
			hue: 'red',
			title:
				wroteBack.length === 1
					? 'A calendar edit changed a date in the ledger'
					: `${wroteBack.length} calendar edits changed dates in the ledger`,
			detail: 'Moved in a connected calendar and applied here. Check it was meant.',
			href: '/calendar',
			rank: 5
		});
	}

	if (discarded.length > 0) {
		items.push({
			icon: 'calendar',
			kind: 'calendar',
			pill: discarded.length === 1 ? '1 edit' : `${discarded.length} edits`,
			hue: 'yellow',
			title:
				discarded.length === 1
					? 'One calendar edit was overwritten'
					: `${discarded.length} calendar edits were overwritten`,
			detail: 'The same event was changed in two places; the later change won.',
			href: '/calendar',
			rank: 45
		});
	}

	return items;
};

/**
 * A connected calendar that has stopped working.
 *
 * A sync that fails quietly is worse than one that never ran: the calendar
 * keeps showing what it last saw, looking correct while drifting from the truth.
 */
export const calendarSyncFailures: Source = async (handle: Queryable = db) => {
	const accounts = await handle.select().from(calendarAccount);
	const failing = accounts.filter((account) => account.lastError);
	if (failing.length === 0) return [];

	const stale = failing.filter(
		(account) =>
			!account.lastSyncAt || Date.now() - account.lastSyncAt.getTime() > 24 * 60 * 60 * 1000
	);

	return [
		{
			icon: 'calendar',
			kind: 'calendar',
			pill: failing.length === 1 ? '1 account' : `${failing.length} accounts`,
			// A connection that has been broken for over a day has stopped being a
			// blip; below that it may just be a router.
			hue: stale.length > 0 ? 'red' : 'yellow',
			title:
				failing.length === 1
					? `${failing[0].label} is not syncing`
					: `${failing.length} calendars are not syncing`,
			detail: failing[0].lastError ?? 'The last sync failed.',
			href: '/settings',
			rank: 15
		}
	];
};

// ---- Equity, paper and prices ----

/** A month: long enough to act unhurried, short enough a four-year schedule doesn't fill the strip. */
const VEST_HORIZON_DAYS = 30;
/** Settlement isn't instant — a fortnight is past every plan's delivery window. */
const SETTLEMENT_GRACE_DAYS = 14;
/** A close older than this is no longer a price anybody should be shown. */
const RATE_STALE_DAYS = 7; // the CNB fixes every working day
/** A valuation older than this no longer says what a flat is worth. */
const VALUATION_STALE_MONTHS = 12;

const equityVesting: Source = async (handle: Queryable = db) => {
	const today = new Date().toISOString().slice(0, 10);
	const grants = await grantsWithTranches(handle);
	const items: BriefingItem[] = [];
	for (const { grant, tranches } of grants) {
		for (const tranche of tranches) {
			// Asked through the same function the salary screen asks with, so the
			// two cannot disagree about what has vested.
			if (trancheState(tranche, today) !== 'pending') continue;
			const days = daysBetween(today, tranche.vestsOn);
			if (days > VEST_HORIZON_DAYS) continue;
			items.push({
				icon: 'coins',
				kind: 'Equity',
				pill: `${days} days`,
				// A week is when a sell-to-cover election stops being a thing that
				// can wait for the weekend.
				hue: days <= 7 ? 'yellow' : 'grey',
				title: `${tranche.units} ${grant.ticker} units vest on ${tranche.vestsOn}`,
				detail: grant.label
					? `From the ${grant.label} grant. Record what is delivered once it settles.`
					: `From the grant of ${grant.grantedOn}. Record what is delivered once it settles.`,
				href: '/salary',
				rank: days
			});
		}
	}
	return items;
};

/**
 * Shares that became the person's and were never written down.
 *
 * The cost of not recording it is not the shares — net worth is short by them,
 * and what was withheld for tax is a figure nobody can reconstruct later.
 */
const equityUnsettled: Source = async (handle: Queryable = db) => {
	const today = new Date().toISOString().slice(0, 10);
	const grants = await grantsWithTranches(handle);
	const waiting = grants.flatMap(({ tranches }) =>
		tranches.filter((tranche) => settlementOverdue(tranche, today, SETTLEMENT_GRACE_DAYS))
	);
	if (waiting.length === 0) return [];
	return [
		{
			icon: 'coins',
			kind: 'Equity',
			pill: `${waiting.length} waiting`,
			hue: 'yellow',
			title: countTitle(
				waiting.length,
				'vested tranche was never settled',
				'vested tranches were never settled'
			),
			detail: 'Record the units delivered and the units withheld for tax.',
			href: '/investments',
			rank: 20
		}
	];
};

/**
 * A grant nothing can value.
 *
 * Unlike a holding, a grant carries no value of its own, so a ticker with no
 * close is a grant worth zero everywhere it appears, quietly.
 */
const equityWithoutPrice: Source = async (handle: Queryable = db) => {
	const today = new Date().toISOString().slice(0, 10);
	const grants = await grantsWithTranches(handle);
	const tickers = [...new Set(grants.map(({ grant }) => grant.ticker))];
	if (tickers.length === 0) return [];
	const [prices, { staleAfterDays }] = await Promise.all([
		latestPrices(tickers, handle),
		getPriceSettings(handle)
	]);
	// `isStale` covers both "no close at all" and "a close from last spring",
	// the same rule the investments screen labels prices with.
	const stale = tickers.filter((ticker) =>
		isStale(prices.get(ticker)?.day ?? null, today, staleAfterDays)
	);
	if (stale.length === 0) return [];
	return [
		{
			icon: 'chart',
			kind: 'Equity',
			pill: stale.length === 1 ? '1 ticker' : `${stale.length} tickers`,
			hue: 'yellow',
			title:
				stale.length === 1
					? `${stale[0]} has no recent close`
					: `${stale.length} grant tickers have no recent close`,
			detail: `${stale.join(', ')}. Until a close is recorded the grant is valued at nothing.`,
			href: '/investments',
			rank: 25
		}
	];
};

// ---- Paperwork, tax and pay ----

/**
 * A rhythm of paper that has stopped: the most recent period that could hold
 * something, holding nothing. `loadDossier` computes the same cells the ribbon
 * draws; this just reads their states.
 */
const laneGaps: Source = async (handle: Queryable = db) => {
	const today = new Date().toISOString().slice(0, 10);
	// Cheap first question, so a household with no lanes pays one small query.
	const laned = await handle
		.selectDistinct({ kind: entity.kind })
		.from(lane)
		.innerJoin(entity, eq(entity.id, lane.entityId))
		.where(sql`${lane.cadence} in ('monthly', 'yearly')`);
	// Employers and banks only — a correspondent who has stopped writing, not
	// e.g. a car's road tax, which is the same shape but drawn on its own shelf.
	const kinds = new Set<string>(
		laned.map((row) => row.kind).filter((kind) => kind === 'organisation' || kind === 'account')
	);
	if (kinds.size === 0) return [];

	const shelves = (await listShelves(handle)).filter((shelfRow) => kinds.has(shelfRow.unit));
	const thisYear = Number(today.slice(0, 4));
	const items: BriefingItem[] = [];
	for (const shelfRow of shelves) {
		let payload = await loadDossier(shelfRow, thisYear, handle, today);
		// In January a monthly lane's whole year is "not arrived yet" and says
		// nothing about whether paper stopped; the year before does.
		if (!payload.cards.some((card) => card.lanes.some((l) => laneJudgeable(l.cells)))) {
			payload = await loadDossier(shelfRow, thisYear - 1, handle, today);
		}
		for (const card of payload.cards) {
			if (card.id === null) continue;
			const missing = card.lanes.reduce((n, l) => n + laneShortfall(l.cells), 0);
			if (missing === 0) continue;
			items.push({
				icon: 'folders',
				kind: 'Paper',
				pill: `${missing} missing`,
				hue: 'yellow',
				title: `${card.name} is behind on ${missing === 1 ? 'a period' : `${missing} periods`}`,
				detail: `The ${shelfRow.label} shelf expects paper from ${card.name} and the latest one is not there.`,
				// The shelf that draws the card: no screen takes a card of its own.
				href: `/documents?shelf=${encodeURIComponent(shelfRow.key)}`,
				rank: 35
			});
		}
	}
	return items;
};

/**
 * Last year's tax, unrecorded. Only for people with a job on record — saying
 * it for a member with no engagement would put a permanent card on a child's
 * behalf.
 */
const taxUnfiled: Source = async (handle: Queryable = db) => {
	const today = new Date().toISOString().slice(0, 10);
	const { taxReminderMonth } = await getBriefingSettings(handle);
	const year = taxYearToChase(today, taxReminderMonth);
	if (year === null) return [];
	const [employed, filed] = await Promise.all([
		handle
			.selectDistinct({ id: person.id, name: person.name })
			.from(person)
			.innerJoin(engagement, eq(engagement.personId, person.id)),
		handle
			.select({ personId: taxStatement.personId })
			.from(taxStatement)
			.where(eq(taxStatement.year, year))
	]);
	const done = new Set(filed.map((row) => row.personId));
	return employed
		.filter((who) => !done.has(who.id))
		.map((who) => ({
			icon: 'receipt' as const,
			kind: 'Tax',
			pill: String(year),
			hue: 'yellow' as const,
			title: `${who.name} has no ${year} tax statement`,
			detail: 'What was earned and what was paid for that year are not recorded here.',
			href: '/tax',
			rank: 30
		}));
};

/**
 * Pay that arrived in a joint account and belongs to nobody. Until it is
 * attributed, the credit is filed as salary in the ledger but missing from
 * the salary history — two screens disagreeing with no sign of it on either.
 */
const salaryUnattributed: Source = async (handle: Queryable = db) => {
	const credits = await handle
		.select({
			accountId: transaction.accountId,
			accountName: account.name,
			counterparty: transaction.counterparty
		})
		.from(transaction)
		.innerJoin(account, eq(account.id, transaction.accountId))
		// `salary` is a category id, not a label.
		.where(and(eq(transaction.categoryId, 'salary'), isNull(account.ownerPersonId)));
	if (credits.length === 0) return [];

	// Asked once per employer per account rather than once per payday: a year
	// of monthly pay is one answer, not twelve.
	const perAccount = new Map<string, { name: string; count: number }>();
	const asked = new Map<string, boolean>();
	for (const credit of credits) {
		const key = `${credit.accountId}|${credit.counterparty ?? ''}`;
		if (!asked.has(key)) {
			const { personId } = await attributeSalary(
				{
					accountOwnerPersonId: null,
					counterparty: credit.counterparty,
					accountId: credit.accountId
				},
				handle
			);
			asked.set(key, personId === null);
		}
		if (!asked.get(key)) continue;
		const held = perAccount.get(credit.accountId) ?? { name: credit.accountName, count: 0 };
		perAccount.set(credit.accountId, { ...held, count: held.count + 1 });
	}

	return [...perAccount.values()].map((row) => ({
		icon: 'people' as const,
		kind: 'Salary',
		pill: `${row.count} credit${row.count === 1 ? '' : 's'}`,
		hue: 'yellow' as const,
		title: `${countTitle(row.count, 'salary credit', 'salary credits')} in ${row.name} ${row.count === 1 ? 'belongs' : 'belong'} to nobody`,
		detail: 'Say whose pay it is and the salary history fills in from the ledger.',
		href: '/salary',
		rank: 28
	}));
};

// ---- Figures going quietly out of date ----

/**
 * A currency the rate table has stopped following. A stale rate does not look
 * stale — the numbers still add up, in last month's money.
 */
const staleRates: Source = async (handle: Queryable = db) => {
	const today = new Date().toISOString().slice(0, 10);
	const [base, accounts, holdings, grants, rates] = await Promise.all([
		getBaseCurrency(),
		handle.selectDistinct({ code: account.currency }).from(account),
		handle.selectDistinct({ code: holding.currency }).from(holding),
		handle.selectDistinct({ code: equityGrant.currency }).from(equityGrant),
		handle
			.select({ code: currencyRate.code, day: sql<string>`max(${currencyRate.day})` })
			.from(currencyRate)
			.groupBy(currencyRate.code)
	]);
	const latest = new Map(rates.map((row) => [row.code, row.day]));
	const inUse = new Set([...accounts, ...holdings, ...grants].map((row) => row.code));
	// CZK is quoted, never has its own rate; base is the currency shown in.
	inUse.delete('CZK');
	inUse.delete(base);

	const stale = [...inUse].filter((code) =>
		isStale(latest.get(code) ?? null, today, RATE_STALE_DAYS)
	);
	if (stale.length === 0) return [];
	return [
		{
			icon: 'globe',
			kind: 'Rates',
			pill: stale.length === 1 ? '1 currency' : `${stale.length} currencies`,
			hue: 'grey',
			title: `${stale.join(', ')} ${stale.length === 1 ? 'has' : 'have'} no recent exchange rate`,
			detail: 'Every figure in that currency is being converted at an old fixing.',
			href: '/settings',
			rank: 45
		}
	];
};

/**
 * An account nothing has been imported into for a long time. It does not go
 * blank — it goes wrong slowly, and keeps being counted in net worth the
 * whole time.
 */
const quietAccounts: Source = async (handle: Queryable = db) => {
	const today = new Date().toISOString().slice(0, 10);
	const { statementStaleDays } = await getBriefingSettings(handle);
	const [accounts, movements] = await Promise.all([
		handle
			.select({ id: account.id, name: account.name, balanceOn: account.balanceOn })
			.from(account),
		handle
			.select({
				accountId: transaction.accountId,
				last: sql<string | null>`max(${transaction.bookedOn})`
			})
			.from(transaction)
			.groupBy(transaction.accountId)
	]);
	const lastMovement = new Map(movements.map((row) => [row.accountId, row.last]));
	const items: BriefingItem[] = [];
	for (const acct of accounts) {
		const days = [acct.balanceOn, lastMovement.get(acct.id) ?? null].filter(
			(day): day is string => day !== null
		);
		// No statement and no movement means never used, not falling behind.
		if (days.length === 0) continue;
		const newest = days.sort()[days.length - 1];
		if (!isStale(newest, today, statementStaleDays)) continue;
		items.push({
			icon: 'bank',
			kind: 'Account',
			pill: `${daysBetween(newest, today)} days`,
			hue: 'grey',
			title: `${acct.name} has had nothing new since ${newest}`,
			detail: 'Its balance is the last statement’s, and net worth still counts it.',
			// Its own ledger: `/accounts` takes no account of its own.
			href: `/transactions?account=${acct.id}`,
			rank: 40
		});
	}
	return items;
};

/** A flat whose worth is last year's figure, in net worth as if it were today's. */
const oldValuations: Source = async (handle: Queryable = db) => {
	const today = new Date().toISOString().slice(0, 10);
	const [properties, valuations] = await Promise.all([
		handle.select({ id: property.id, name: property.name }).from(property),
		handle
			.select({
				propertyId: propertyValuation.propertyId,
				last: sql<string | null>`max(${propertyValuation.valuedOn})`
			})
			.from(propertyValuation)
			.groupBy(propertyValuation.propertyId)
	]);
	const latest = new Map(valuations.map((row) => [row.propertyId, row.last]));
	const items: BriefingItem[] = [];
	for (const flat of properties) {
		const valuedOn = latest.get(flat.id) ?? null;
		// A flat never valued is a different card, one this source cannot date.
		if (valuedOn === null) continue;
		const months = monthsBetween(valuedOn, today);
		if (months < VALUATION_STALE_MONTHS) continue;
		items.push({
			icon: 'house',
			kind: 'Property',
			pill: `${months} months`,
			hue: 'grey',
			title: `${flat.name} was last valued ${valuedOn}`,
			detail: 'Net worth is carrying that figure as if it were current.',
			href: `/property?p=${flat.id}`,
			rank: 50
		});
	}
	return items;
};

// Declaration order, not display order: `rank` decides what a person sees
// first, and a source moved up this list must not be able to change that.
const SOURCES: Source[] = [
	unreviewedImports,
	inboxBacklog,
	leaseExpiry,
	fixationHorizon,
	documentExpiry,
	extractionFailures,
	overspend,
	calendarConflicts,
	calendarSyncFailures,
	equityVesting,
	equityUnsettled,
	equityWithoutPrice,
	laneGaps,
	taxUnfiled,
	salaryUnattributed,
	staleRates,
	quietAccounts,
	oldValuations
];

/** Everything the strip could show, ranked, and how it describes itself. */
export interface Briefing {
	/** All of them, most urgent first. The panel shows four and offers the rest. */
	items: BriefingItem[];
	/** How many there are in all — what the "+N more" button counts against. */
	total: number;
	caption: string;
}

export async function buildBriefing(shared: BriefingShared = {}): Promise<Briefing> {
	// Settled, not all: one source failing must not take the whole strip down
	// and silently say "nothing needs you today".
	const settled = await Promise.allSettled(SOURCES.map((source) => source(undefined, shared)));
	const items: BriefingItem[] = [];
	settled.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			items.push(...result.value);
			return;
		}
		// Logged rather than swallowed, or a failing source goes unnoticed.
		console.error(`Briefing source ${SOURCES[index].name} failed:`, result.reason);
	});
	items.sort((a, b) => a.rank - b.rank);
	return {
		items,
		total: items.length,
		caption: briefingCaption(items.slice(0, BRIEFING_STRIP_SIZE), items.length)
	};
}
