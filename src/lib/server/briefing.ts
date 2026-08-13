import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { loan, loanFixationPeriod, property, tenancy, transaction } from '$lib/server/db/schema';

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

const SOURCES: Source[] = [unreviewedImports, leaseExpiry, fixationHorizon];

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
