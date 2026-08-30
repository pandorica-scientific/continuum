// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { and, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import type { IconName } from '$lib/icons';
import { BRIEFING_STRIP_SIZE } from '$lib/briefing';
import { displayCurrency, formatMinor, fromMajor } from '$lib/money';
import { getBaseCurrency } from '$lib/server/settings';
import { expenseSpendingByMonth, type GroupMonthSpend } from '$lib/server/cashflow/spending';
import {
	calendarAccount,
	calendarConflict,
	document,
	documentLink,
	entity,
	job,
	loan,
	loanFixationPeriod,
	property,
	shelf,
	tenancy,
	transaction
} from '$lib/server/db/schema';
import {
	archiveScopePredicate,
	visibleDocumentPredicate,
	type Actor
} from '$lib/server/documents/visibility';
import { loadRecordDates, ownedByLinkedRecord } from '$lib/server/documents/deadlines';
import { systemShelfId } from '$lib/server/documents/shelves';
import { isDocumentTargetKind, loadTargetNames } from '$lib/server/documents/targets';
import { aboutLine, briefingCaption, countTitle, latestJobPerDocument } from './pure';

/**
 * One card on the Overview's briefing strip.
 *
 * Exported because the panel that draws it needs the same shape. The component
 * used to restate it, and a second copy is a second place to remember whenever
 * a source gains a field.
 */
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

// Each source scans one domain for things that need attention, and the strip
// itself knows about none of them: a domain that grows a way of needing
// somebody adds a source to `SOURCES` and changes nothing else.
//
// The optional handle is what lets a source be exercised against a test
// database. Sources that do not take one still satisfy this — a function of
// fewer parameters is assignable — so the ones that read the singleton are
// untouched.
/**
 * A briefing source, optionally told who is reading.
 *
 * The actor arrives second so the handle stays the first argument every source
 * already took. Every source that reads `document` uses it, and must: a member
 * cannot be shown a restricted document's renewal date on the Overview, nor
 * infer one from a backlog count that is one too high. "No actor" is read as a
 * member rather than as an admin.
 */
type Source = (
	handle?: Queryable,
	actor?: Actor | null,
	shared?: BriefingShared
) => Promise<BriefingItem[]>;

/**
 * Work the caller has already done, or is about to do for something else.
 *
 * The Overview builds the briefing and the "month against its average" panel on
 * the same load, and both want every expense group's spending month by month —
 * which is the whole ledger, its splits and the rate table. Ran twice it was
 * the most expensive thing on the screen, done identically. Optional, because
 * every other caller (the API, a test, a screen that only wants the strip) has
 * nothing to share and must keep working with one argument.
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
 * The inbox is the one shelf whose contents are work rather than record —
 * capture, the scanner and every upload drop a document there and it sits until
 * somebody says what it is. Nothing else on the Overview can show it: an
 * unfiled document has no expiry date to remind about and no record to appear
 * beside, which is exactly why the backlog grows unnoticed.
 */
const inboxBacklog: Source = async (handle: Queryable = db, actor = null) => {
	let inboxId: string;
	try {
		inboxId = await systemShelfId('inbox', handle);
	} catch {
		// `systemShelfId` throws for a household that has no such shelf, and it is
		// right to: code that files INTO the inbox must not guess. A source that
		// only counts has no such stake, and letting the throw out would take the
		// whole strip down over a shelf nobody uses. Nothing to count, nothing to
		// say.
		return [];
	}
	const [row] = await handle
		.select({ count: sql<number>`count(*)::int` })
		.from(document)
		.where(and(eq(document.shelfId, inboxId), visibleDocumentPredicate(actor)));
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
			href: '/documents/review',
			rank: 25
		}
	];
};

/**
 * How far ahead each source looks, named rather than typed into its own loop.
 *
 * D7's suppression has to ask the same question the source asks — "would this
 * record's own reminder actually be raised?" — and two spellings of one horizon
 * are two numbers that will drift. The lease window being narrower than the
 * document one is exactly the case that made the suppression lose a deadline.
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

const documentExpiry: Source = async (_handle, actor = null) => {
	const today = new Date().toISOString().slice(0, 10);
	const docs = await db
		.select({ ...getTableColumns(document), shelfLabel: shelf.label })
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		// The invariant, not a screen filter: a member must not learn a restricted
		// document exists from a renewal date on the Overview. Archive scope is the
		// second, independent question — a document whose only subject is archived
		// (a sold car's insurance) is stale rather than secret, and drops out of the
		// default view the same way it does everywhere else.
		.where(and(visibleDocumentPredicate(actor), archiveScopePredicate(false)));
	// What each document belongs to, by current name, for the detail line. The
	// same `links` rows also answer D7 below — a second query over
	// `document_link` per source would be the "extend the load, don't add a
	// third" rule broken on day one.
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
	// The registry names all nine kinds a document can be filed against. The two
	// hand-written selects this replaces knew people and flats only, so a lease
	// filed against the tenancy it is the contract for — the commonest shape
	// there is — said "Filed under Tenancy." and stopped.
	//
	// Narrowed to the ids actually linked, because one of those nine kinds is
	// `transaction`: naming a receipt would otherwise read the entire ledger.
	const names = await loadTargetNames(
		undefined,
		links.map((link) => link.targetId)
	);
	const about = new Map<string, string[]>();
	for (const link of links) {
		// `entity` holds kinds a document is never filed against — a tag, another
		// document — and a link to one of those is not something to name.
		if (!isDocumentTargetKind(link.kind)) continue;
		const name = names.get(link.kind)?.get(link.targetId)?.name;
		if (name === undefined) continue;
		about.set(link.documentId, [...(about.get(link.documentId) ?? []), name]);
	}
	// What the two sources above will and will not have raised by the time this
	// one runs. `emits: true` for both — a briefing has no rule toggles; the
	// conditions that stop `fixationHorizon` raising anything (a paid-off loan,
	// a loan not on a fixed period) are answered by `loadRecordDates`, which
	// leaves such a loan out of the map entirely.
	const ownersOnTheOverview = {
		tenancy: { emits: true, remindsThrough: remindsThrough(LEASE_HORIZON_DAYS) },
		loan: {
			emits: true,
			// Stated in days like the other, from the months its own source counts
			// in. The boundary is approximate at the far end and never reached:
			// this source stops at 210 days, well inside it.
			remindsThrough: remindsThrough(Math.round(FIXATION_HORIZON_MONTHS * DAYS_PER_MONTH))
		}
	};

	const items: BriefingItem[] = [];
	for (const d of docs) {
		if (!d.expiresOn || d.expiresOn < today) continue;
		// D7: the record owns the deadline. A lease's contract dated the same as
		// the tenancy's own `ends_on` (or a re-fix letter dated the same as the
		// loan's current fixation) is the SAME deadline `leaseExpiry` or
		// `fixationHorizon` already surfaced above — reminding again here would
		// be the same date twice on one Overview.
		//
		// Only where those two DID surface it, which is what the horizons say.
		// This source looks 210 days ahead and the lease source 120, so a lease
		// five months out has no item above to be a duplicate of and the paper is
		// the household's only notice of it.
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
 * This is the quietest failure the product has. The document is on its shelf,
 * its file opens, its name and dates are all correct — only its CONTENTS were
 * never read, so a search for a phrase inside it finds nothing and looks like
 * an answer rather than a gap. Nobody goes looking for a document they have
 * already been told is not there, which is why it has to be said here.
 */
const extractionFailures: Source = async (handle: Queryable = db, actor = null) => {
	const rows = await handle
		.select({
			documentId: document.id,
			state: job.state,
			queuedAt: job.queuedAt,
			error: job.error
		})
		.from(job)
		.innerJoin(document, eq(document.id, job.subjectId))
		.where(
			and(
				eq(job.kind, 'extract_text'),
				// The same two questions every other read of `document` asks. A
				// member must not learn a restricted document exists from a count of
				// what could not be read, and a sold car's paperwork failing to
				// extract is not work anybody is going to do.
				visibleDocumentPredicate(actor),
				archiveScopePredicate(false)
			)
		)
		.orderBy(desc(job.queuedAt));

	// Attempts accumulate: a document read successfully on the second try still
	// has its failed row, for ever. Only the newest attempt says whether the
	// document has text today.
	const latest = latestJobPerDocument(rows);
	const failed = new Set(
		[...latest].filter(([, state]) => state === 'failed').map(([documentId]) => documentId)
	);
	if (failed.size === 0) return [];

	// Rows arrive newest first, so the first one belonging to a failed document
	// IS that document's newest attempt — the message somebody would act on.
	const message = rows.find((row) => failed.has(row.documentId))?.error ?? null;
	const [only] = failed;

	return [
		{
			icon: 'alert',
			kind: 'Paper',
			pill: `${failed.size} failed`,
			hue: 'yellow',
			title: countTitle(failed.size, 'document could not be read', 'documents could not be read'),
			// A reader's message can run to a stack trace and the card has one
			// line, so it is clipped rather than left to push the card open. Where
			// the job recorded no message, saying what the failure COSTS is more
			// use than repeating that it failed.
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

const overspend: Source = async (_handle, _actor, shared) => {
	// A category group running well past its twelve-month average this month.
	// The tally itself lives in `$lib/server/cashflow/spending`, shared with the
	// Overview panel that draws the same comparison as bars — two spellings of
	// "what Housing usually costs" are two figures that will disagree, and on
	// the Overview it is literally the same figure computed twice.
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
 * THIS IS WHAT MAKES LAST-WRITER-WINS ACCEPTABLE RATHER THAN RECKLESS. When two
 * people edit the same event on two devices, one version loses. Losing it
 * silently would mean someone's change simply evaporating with nothing to show
 * for it; recording it and saying so here is the difference.
 *
 * Write-backs are surfaced for a different reason: a calendar edit that moved a
 * mortgage payment day is a change to household finances, and it should not be
 * possible for that to happen without anyone being told.
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
 * A sync that fails quietly is worse than one that never ran: the calendar goes
 * on showing what it last saw, so it looks correct while drifting further from
 * the truth every day.
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
	calendarSyncFailures
];

/** Everything the strip could show, ranked, and how it describes itself. */
export interface Briefing {
	/** All of them, most urgent first. The panel shows four and offers the rest. */
	items: BriefingItem[];
	/** How many there are in all — what the "+N more" button counts against. */
	total: number;
	caption: string;
}

export async function buildBriefing(
	actor: Actor | null = null,
	shared: BriefingShared = {}
): Promise<Briefing> {
	// Settled, not all. Nine domains are queried here and any one of them can
	// fail on its own — a table a migration has not reached, a shelf that is not
	// there, a rate table that would not load — and under `Promise.all` the
	// first rejection took the whole strip with it. An Overview that says
	// "nothing needs you today" because one query threw is worse than one that
	// is short a card: it is the same screen a household with nothing to do
	// sees, so nothing about it looks wrong.
	const settled = await Promise.allSettled(
		SOURCES.map((source) => source(undefined, actor, shared))
	);
	const items: BriefingItem[] = [];
	settled.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			items.push(...result.value);
			return;
		}
		// Logged rather than swallowed. A source that has been throwing for a week
		// is a defect, and a strip that quietly grew shorter is how it goes
		// unnoticed for the second week.
		console.error(`Briefing source ${SOURCES[index].name} failed:`, result.reason);
	});
	items.sort((a, b) => a.rank - b.rank);
	return {
		items,
		total: items.length,
		caption: briefingCaption(items.slice(0, BRIEFING_STRIP_SIZE), items.length)
	};
}
