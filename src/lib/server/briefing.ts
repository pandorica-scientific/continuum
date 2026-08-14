import { isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { loadSplits } from '$lib/server/splits';
import { effectiveLines } from '$lib/transactions/lines';
import {
	category,
	document,
	documentPerson,
	documentProperty,
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
type Source = () => Promise<BriefingItem[]>;

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
		if (!t.endDate || t.endDate < today) continue;
		const days = Math.ceil((new Date(t.endDate).getTime() - Date.now()) / 86400000);
		if (days > 120) continue;
		const propertyName = properties.find((p) => p.id === t.propertyId)?.name ?? 'the flat';
		const noticeDue =
			t.renewalNoticeDate && t.renewalNoticeDate >= today ? t.renewalNoticeDate : null;
		items.push({
			emoji: '🔑',
			kind: 'Tenancy',
			pill: `${days} days`,
			hue: days <= 60 ? 'yellow' : 'grey',
			title: `${propertyName} lease ends ${t.endDate}`,
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
			(p) => p.loanId === l.id && p.startDate <= today && (p.endDate === null || p.endDate > today)
		);
		if (!current?.endDate) continue;
		const months = Math.round(
			(new Date(current.endDate).getTime() - Date.now()) / (30.44 * 86400000)
		);
		if (months > 30) continue;
		const end = new Date(current.endDate);
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
	const [dp, dr, people, properties] = await Promise.all([
		db.select().from(documentPerson),
		db.select().from(documentProperty),
		db.select().from(person),
		db.select().from(property)
	]);
	const personName = new Map(people.map((x) => [x.id, x.name]));
	const propertyName = new Map(properties.map((x) => [x.id, x.name]));
	const about = new Map<string, string[]>();
	for (const r of dp)
		about.set(r.documentId, [...(about.get(r.documentId) ?? []), personName.get(r.personId) ?? '']);
	for (const r of dr)
		about.set(r.documentId, [
			...(about.get(r.documentId) ?? []),
			propertyName.get(r.propertyId) ?? ''
		]);
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
	const [txns, categories] = await Promise.all([
		db.select().from(transaction).where(isNull(transaction.transferPairId)),
		db.select().from(category)
	]);
	const groupByCategory = new Map(categories.map((c) => [c.id, c.groupKey]));
	const splitsByTxn = await loadSplits(txns.map((t) => t.id));

	// Spending per group per month, as a positive number of minor units — the
	// same shape the loop below has always consumed.
	const tally = new Map<string, number>();
	for (const t of txns) {
		const month = (t.valueDate ?? t.bookedAt).slice(0, 7);
		for (const line of effectiveLines(t, splitsByTxn.get(t.id) ?? [])) {
			if (line.amountMinor >= 0n || !line.categoryId) continue;
			const groupKey = groupByCategory.get(line.categoryId);
			if (!groupKey || groupKey === 'income' || groupKey === 'savings') continue;
			const key = `${groupKey} ${month}`;
			tally.set(key, (tally.get(key) ?? 0) + Number(-line.amountMinor));
		}
	}
	const rows = [...tally].map(([key, spent]) => {
		const [groupKey, month] = key.split(' ');
		return { groupKey, month, spent: String(spent) };
	});

	const thisMonth = new Date().toISOString().slice(0, 7);
	const items: BriefingItem[] = [];
	const groups = [...new Set(rows.map((r) => r.groupKey))];
	for (const groupKey of groups) {
		const history = rows.filter((r) => r.groupKey === groupKey && r.month !== thisMonth);
		const current = rows.find((r) => r.groupKey === groupKey && r.month === thisMonth);
		if (!current || history.length < 3) continue; // not enough record to judge
		const average = history.reduce((s, r) => s + Number(r.spent), 0) / history.length;
		const spent = Number(current.spent);
		if (average <= 0 || spent < average * 1.35 || spent - average < 300000) continue;
		const pct = Math.round((spent / average - 1) * 100);
		items.push({
			emoji: '📊',
			kind: 'Spending',
			pill: `+${pct}%`,
			hue: 'yellow',
			title: `${groupKey === 'living' ? 'Food & lifestyle' : groupKey} is running ${pct}% over its average`,
			detail: `${Math.round(spent / 100)
				.toLocaleString('en')
				.replace(/,/g, ' ')} so far this month against a typical ${Math.round(average / 100)
				.toLocaleString('en')
				.replace(/,/g, ' ')}.`,
			href: '/cashflow',
			rank: 15
		});
	}
	return items;
};

const SOURCES: Source[] = [
	unreviewedImports,
	leaseExpiry,
	fixationHorizon,
	documentExpiry,
	overspend
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
