import { eq, isNull, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { groupMonthlySpending } from '$lib/briefing';
import { displayCurrency, formatMinor, fromMajor } from '$lib/money';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { getBaseCurrency } from '$lib/server/settings';
import { loadSplits } from '$lib/server/splits';
import { effectiveLines } from '$lib/transactions/lines';
import {
	calendarAccount,
	calendarConflict,
	category,
	document,
	documentLink,
	entity,
	loan,
	loanFixationPeriod,
	person,
	property,
	tenancy,
	transaction
} from '$lib/server/db/schema';

export interface BriefingItem {
	emoji: string;
	kind: string;
	pill: string;
	hue: 'green' | 'yellow' | 'red' | 'blue' | 'grey';
	title: string;
	detail: string;
	href: string;
	/** lower = more urgent; the strip shows the top four */
	rank: number;
}

// Each source scans one domain for things that need attention. Phase 2+
// adds lease expiry, mortgage fixation, document expiry and overspend
// sources to this list — the strip itself never changes.
// The optional handle is what lets a source be exercised against a test
// database. Sources that do not take one still satisfy this — a function of
// fewer parameters is assignable — so the older five are untouched.
type Source = (handle?: Queryable) => Promise<BriefingItem[]>;

const unreviewedImports: Source = async () => {
	const rows = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(transaction)
		.where(sql`${transaction.reviewState} = 'needs_review'`);
	const count = rows[0].count;
	if (count === 0) return [];
	return [
		{
			emoji: '📥',
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
		if (days > 120) continue;
		const propertyName = properties.find((p) => p.id === t.propertyId)?.name ?? 'the flat';
		const noticeDue = t.renewalNoticeOn && t.renewalNoticeOn >= today ? t.renewalNoticeOn : null;
		items.push({
			emoji: '🔑',
			kind: 'Tenancy',
			pill: `${days} days`,
			hue: days <= 60 ? 'yellow' : 'grey',
			title: `${propertyName} lease ends ${t.endsOn}`,
			detail: noticeDue
				? `${t.tenantName} is the tenant. Renewal notice is due by ${noticeDue}.`
				: `${t.tenantName} is the tenant.`,
			href: '/property',
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
			(new Date(current.endsOn).getTime() - Date.now()) / (30.44 * 86400000)
		);
		if (months > 30) continue;
		const end = new Date(current.endsOn);
		const pill = `${end.toLocaleString('en', { month: 'short' })} ${end.getFullYear()}`;
		items.push({
			emoji: '🏦',
			kind: 'Mortgage',
			pill,
			hue: months <= 6 ? 'yellow' : 'grey',
			title: `${l.name} fixation runs to ${pill}`,
			detail:
				months <= 6
					? 'Time to collect refinancing quotes.'
					: `Nothing to do yet. Refinancing quotes are worth collecting from ${end.getFullYear() - 1}.`,
			href: '/loans',
			rank: 30 + months
		});
	}
	return items;
};

const documentExpiry: Source = async () => {
	const today = new Date().toISOString().slice(0, 10);
	const docs = await db.select().from(document);
	// What each document belongs to, by current name, for the detail line.
	const [links, people, properties] = await Promise.all([
		// One table for every kind of target, so the kind comes from `entity`. Only
		// people and properties are named on the detail line; other kinds are
		// skipped below rather than rendered as an empty string.
		db
			.select({
				documentId: documentLink.documentId,
				targetId: documentLink.targetId,
				kind: entity.kind
			})
			.from(documentLink)
			.innerJoin(entity, eq(entity.id, documentLink.targetId)),
		db.select().from(person),
		db.select().from(property)
	]);
	const personName = new Map(people.map((x) => [x.id, x.name]));
	const propertyName = new Map(properties.map((x) => [x.id, x.name]));
	const about = new Map<string, string[]>();
	for (const link of links) {
		const name =
			link.kind === 'person'
				? personName.get(link.targetId)
				: link.kind === 'property'
					? propertyName.get(link.targetId)
					: undefined;
		if (name === undefined) continue;
		about.set(link.documentId, [...(about.get(link.documentId) ?? []), name]);
	}
	const items: BriefingItem[] = [];
	for (const d of docs) {
		if (!d.expiresOn || d.expiresOn < today) continue;
		const days = Math.ceil((new Date(d.expiresOn).getTime() - Date.now()) / 86400000);
		if (days > 210) continue;
		const months = Math.round(days / 30.44);
		items.push({
			emoji: '🗂️',
			kind: 'Document',
			pill: days <= 45 ? `${days} days` : `${months} month${months === 1 ? '' : 's'}`,
			hue: days <= 60 ? 'yellow' : 'grey',
			title: `${d.name} ${d.expiryVerb} ${d.expiresOn}`,
			detail: about.get(d.id)?.length
				? `Filed under ${d.shelf}, about ${about.get(d.id)!.filter(Boolean).join(' and ')}.`
				: `Filed under ${d.shelf}.`,
			href: '/documents',
			rank: days + 5
		});
	}
	return items;
};

const overspend: Source = async () => {
	// A category group running well past its twelve-month average this month.
	// Aggregated in JavaScript rather than SQL because a transaction may be
	// split across categories, and effectiveLines is the only thing that knows.
	const [txns, categories, rates, baseCurrency] = await Promise.all([
		db.select().from(transaction).where(isNull(transaction.transferPairId)),
		db.select().from(category),
		loadRateTable(),
		getBaseCurrency()
	]);
	const groupByCategory = new Map(categories.map((c) => [c.id, c.groupKey]));
	const splitsByTxn = await loadSplits(txns.map((t) => t.id));

	const rows = groupMonthlySpending(
		txns.flatMap((t) => {
			const day = t.valueOn ?? t.bookedOn;
			return effectiveLines(t, splitsByTxn.get(t.id) ?? []).map((line) => ({
				day,
				currency: t.currency,
				amountMinor: line.amountMinor,
				categoryId: line.categoryId
			}));
		}),
		groupByCategory,
		baseCurrency,
		(amount, from, to, day) => convertOrFace(rates, amount, from, to, day)
	);

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
			emoji: '📊',
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
			emoji: '📆',
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
			emoji: '📆',
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
			emoji: '📆',
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

const SOURCES: Source[] = [
	unreviewedImports,
	leaseExpiry,
	fixationHorizon,
	documentExpiry,
	overspend,
	calendarConflicts,
	calendarSyncFailures
];

export async function buildBriefing(): Promise<{ items: BriefingItem[]; caption: string }> {
	const all = (await Promise.all(SOURCES.map((s) => s()))).flat();
	all.sort((a, b) => a.rank - b.rank);
	const items = all.slice(0, 4);
	const urgent = items.filter((i) => i.hue === 'red').length;
	const caption =
		items.length === 0
			? 'nothing needs you today'
			: urgent > 0
				? `${items.length} things, ${urgent} of them urgent`
				: `${items.length === 1 ? 'one thing' : `${['', 'one', 'two', 'three', 'four'][items.length]} things`}, none of them urgent today`;
	return { items, caption };
}
