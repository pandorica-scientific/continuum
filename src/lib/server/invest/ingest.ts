import { randomUUID } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { brokerOperation, holding, portfolioSnapshot } from '$lib/server/db/schema';
import { parseXtb } from './xtb';

export interface XtbIngestResult {
	operationsAdded: number;
	operationsKnown: number;
	holdings: number;
	snapshotDay: string;
	replacedHoldings: boolean;
}

export async function ingestXtbReport(buffer: Uint8Array): Promise<XtbIngestResult> {
	const report = parseXtb(buffer);

	let added = 0;
	let known = 0;
	for (const op of report.operations) {
		const inserted = await db
			.insert(brokerOperation)
			.values({
				id: op.id,
				type: op.type,
				ticker: op.ticker,
				happenedAt: new Date(op.happenedAt),
				amountMinor: op.amountMinor,
				currency: report.accountCurrency,
				comment: op.comment
			})
			.onConflictDoNothing()
			.returning({ id: brokerOperation.id });
		if (inserted.length > 0) added++;
		else known++;
	}

	// Holdings are a snapshot: replace only when this report is newer than
	// what we already show — an old report re-uploaded must not roll back.
	const existing = await db.select().from(holding).orderBy(desc(holding.asOf)).limit(1);
	const reportTime = new Date(report.generatedAt);
	const replaced = !existing[0] || existing[0].asOf <= reportTime;
	if (replaced) {
		await db.delete(holding);
		for (const h of report.holdings) {
			await db.insert(holding).values({
				id: randomUUID(),
				ticker: h.ticker,
				name: h.name,
				category: h.category,
				units: String(h.units),
				valueMinor: h.valueMinor,
				currency: report.accountCurrency,
				netProfitPct: h.netProfitPct !== null ? String(h.netProfitPct) : null,
				asOf: reportTime
			});
		}
	}

	const snapshotDay = report.generatedAt.slice(0, 10);
	await db
		.insert(portfolioSnapshot)
		.values({
			day: snapshotDay,
			valueMinor: report.summaryValueMinor,
			currency: report.accountCurrency
		})
		.onConflictDoUpdate({
			target: portfolioSnapshot.day,
			set: { valueMinor: report.summaryValueMinor, currency: report.accountCurrency }
		});

	return {
		operationsAdded: added,
		operationsKnown: known,
		holdings: report.holdings.length,
		snapshotDay,
		replacedHoldings: replaced
	};
}
