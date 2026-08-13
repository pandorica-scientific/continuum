import { randomUUID } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { brokerOperation, brokerPosition, holding, portfolioSnapshot } from '$lib/server/db/schema';
import { brokerAdapters, detectBroker, type BrokerReport } from './adapter';
import './xtb'; // adapters register themselves on import

export interface BrokerIngestResult {
	broker: string;
	operationsAdded: number;
	operationsKnown: number;
	holdings: number;
	snapshotDay: string;
	replacedHoldings: boolean;
}

/** Detect which broker's report this is and ingest it. */
export async function ingestBrokerFile(
	fileName: string,
	buffer: Uint8Array
): Promise<BrokerIngestResult> {
	const adapter = detectBroker(fileName, buffer);
	if (!adapter) {
		const known = brokerAdapters()
			.map((a) => a.label)
			.join(', ');
		throw new Error(`Not a recognised broker report. Supported: ${known}.`);
	}
	return { broker: adapter.label, ...(await ingestReport(adapter.parse(buffer))) };
}

async function ingestReport(report: BrokerReport): Promise<Omit<BrokerIngestResult, 'broker'>> {
	const existingOps = new Set(
		(await db.select({ id: brokerOperation.id }).from(brokerOperation)).map((r) => r.id)
	);
	let added = 0;
	let known = 0;
	for (const op of report.operations) {
		if (existingOps.has(op.id)) known++;
		else added++;
		await db
			.insert(brokerOperation)
			.values({
				id: op.id,
				type: op.type,
				ticker: op.ticker,
				happenedAt: new Date(op.happenedAt),
				amountMinor: op.amountMinor,
				currency: report.accountCurrency,
				comment: op.comment,
				positionId: op.positionId
			})
			// re-uploads backfill fields older ingests did not know about
			.onConflictDoUpdate({
				target: brokerOperation.id,
				set: { positionId: op.positionId }
			});
	}

	// Holding intervals. Closed rows are authoritative and may update an
	// earlier open lot; an open lot must never erase a recorded close (a stale
	// report re-uploaded after the position closed).
	for (const position of report.positions) {
		const values = {
			id: position.id,
			ticker: position.ticker,
			purchaseValueMinor: position.purchaseValueMinor,
			saleValueMinor: position.saleValueMinor,
			currency: report.accountCurrency,
			openedAt: new Date(position.openedAt),
			closedAt: position.closedAt ? new Date(position.closedAt) : null
		};
		if (position.closedAt) {
			await db
				.insert(brokerPosition)
				.values(values)
				.onConflictDoUpdate({
					target: brokerPosition.id,
					set: {
						purchaseValueMinor: position.purchaseValueMinor,
						saleValueMinor: position.saleValueMinor,
						closedAt: new Date(position.closedAt)
					}
				});
		} else {
			await db.insert(brokerPosition).values(values).onConflictDoNothing();
		}
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
