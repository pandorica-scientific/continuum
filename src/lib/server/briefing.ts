import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transaction } from '$lib/server/db/schema';

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

const SOURCES: Source[] = [unreviewedImports];

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
