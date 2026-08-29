// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { uuidv7 } from 'uuidv7';
import { desc, eq, sql } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import {
	brokerImportState,
	brokerOperation,
	brokerPosition,
	holding,
	portfolioSnapshot
} from '$lib/server/db/schema';
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

/**
 * Detect which broker's report this is and parse it, without writing
 * anything.
 *
 * Split out of `ingestBrokerFile` so the document filer (decision D8, Task
 * 21) can read the broker's own key and `report.generatedAt` before deciding
 * what to file the upload as, without parsing the workbook a second time to
 * get at the same report `ingestReport` is about to consume.
 */
export function parseBrokerReport(
	fileName: string,
	buffer: Uint8Array
): { id: string; label: string; report: BrokerReport } {
	const adapter = detectBroker(fileName, buffer);
	if (!adapter) {
		const known = brokerAdapters()
			.map((a) => a.label)
			.join(', ');
		throw new Error(`Not a recognised broker report. Supported: ${known}.`);
	}
	return { id: adapter.id, label: adapter.label, report: adapter.parse(buffer) };
}

/** Detect which broker's report this is and ingest it. */
export async function ingestBrokerFile(
	fileName: string,
	buffer: Uint8Array,
	handle: Db = db
): Promise<BrokerIngestResult> {
	const { label, report } = parseBrokerReport(fileName, buffer);
	return { broker: label, ...(await ingestReport(report, handle)) };
}

export async function ingestReport(
	report: BrokerReport,
	handle: Db
): Promise<Omit<BrokerIngestResult, 'broker'>> {
	return handle.transaction(async (tx) => {
		// A report replaces one global holdings snapshot. Serialize ingests so
		// two concurrent uploads cannot both decide they are the newest and let
		// the older one overwrite the newer one after its check.
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('continuum:broker-ingest'))`);

		const reportTime = new Date(report.generatedAt);
		if (Number.isNaN(reportTime.getTime())) throw new Error('The report timestamp is invalid.');
		const accountCurrency = report.accountCurrency.trim().toUpperCase();
		if (!/^[A-Z]{3}$/.test(accountCurrency)) {
			throw new Error('The report account currency must be a three-letter code.');
		}

		const stateRows = await tx
			.select()
			.from(brokerImportState)
			.where(eq(brokerImportState.id, 'global'))
			.for('update');
		const state = stateRows[0] ?? null;
		const storedCurrencies = state
			? []
			: await tx.execute<{ currency: string }>(sql`
					select distinct currency from (
						select ${brokerOperation.currency} as currency from ${brokerOperation}
						union all select ${brokerPosition.currency} from ${brokerPosition}
						union all select ${holding.currency} from ${holding}
						union all select ${portfolioSnapshot.currency} from ${portfolioSnapshot}
					) stored_currency
				`);
		const knownCurrencies = new Set(storedCurrencies.map((row) => row.currency.toUpperCase()));
		if (state) knownCurrencies.add(state.currency.toUpperCase());
		if (knownCurrencies.size > 1) {
			throw new Error('Existing investment data contains more than one account currency.');
		}
		const knownCurrency = [...knownCurrencies][0] ?? null;
		if (knownCurrency && knownCurrency !== accountCurrency) {
			throw new Error(
				`This portfolio uses ${knownCurrency}; a ${accountCurrency} report would mix account currencies.`
			);
		}

		const existingHolding = state
			? null
			: ((await tx.select().from(holding).orderBy(desc(holding.valuedAt)).limit(1))[0] ?? null);
		const existingSnapshot =
			state || existingHolding
				? null
				: ((
						await tx.select().from(portfolioSnapshot).orderBy(desc(portfolioSnapshot.day)).limit(1)
					)[0] ?? null);
		const inferredGeneratedAt = existingHolding
			? existingHolding.valuedAt
			: existingSnapshot
				? new Date(`${existingSnapshot.day}T23:59:59.999Z`)
				: null;
		const latestGeneratedAt = state?.latestGeneratedAt ?? inferredGeneratedAt;
		const replaced = !latestGeneratedAt || latestGeneratedAt <= reportTime;

		// Holding intervals. Closed rows are authoritative and may update an
		// earlier open lot; an open lot must never erase a recorded close (a stale
		// report re-uploaded after the position closed).
		//
		// These are written BEFORE the operations below, and the order is load-
		// bearing: `broker_operation.position_id` is a real, non-deferrable foreign
		// key into this table, so an operation naming a position this report also
		// carries aborted the entire transaction when the operations went first.
		// Positions reference only `currency`, so nothing here depends on the
		// operations existing.
		for (const position of report.positions) {
			const values = {
				id: position.id,
				ticker: position.ticker,
				purchaseValueMinor: position.purchaseValueMinor,
				saleValueMinor: position.saleValueMinor,
				currency: accountCurrency,
				openedAt: new Date(position.openedAt),
				closedAt: position.closedAt ? new Date(position.closedAt) : null
			};
			if (position.closedAt) {
				await tx
					.insert(brokerPosition)
					.values(values)
					.onConflictDoUpdate({
						target: brokerPosition.id,
						set: {
							purchaseValueMinor: position.purchaseValueMinor,
							saleValueMinor: position.saleValueMinor,
							closedAt: new Date(position.closedAt)
						},
						// A stale/partial report may carry smaller aggregates even when it
						// repeats the same maximum close time. Keep purchase, sale and close
						// time from one report generation: only the globally newest report
						// may advance an existing row, and its close cannot move backwards.
						setWhere: sql`${replaced} and (${brokerPosition.closedAt} is null or excluded.closed_at >= ${brokerPosition.closedAt})`
					});
			} else {
				await tx.insert(brokerPosition).values(values).onConflictDoNothing();
			}
		}

		// An operation may name a position this report does not carry — a
		// correction filed against a position opened and closed in a reporting
		// window that was never uploaded. The cash movement is still real, so it is
		// stored with a null link rather than aborting the whole report. Read after
		// the positions above are written, so a position this very report supplies
		// resolves.
		const storedPositions = new Set(
			(await tx.select({ id: brokerPosition.id }).from(brokerPosition)).map((row) => row.id)
		);
		const linkFor = (positionId: string | null) =>
			positionId && storedPositions.has(positionId) ? positionId : null;

		const existingOps = new Set(
			(await tx.select({ id: brokerOperation.id }).from(brokerOperation)).map((row) => row.id)
		);
		let added = 0;
		let known = 0;
		for (const op of report.operations) {
			if (existingOps.has(op.id)) known++;
			else added++;
			await tx
				.insert(brokerOperation)
				.values({
					id: op.id,
					type: op.type,
					ticker: op.ticker,
					happenedAt: new Date(op.happenedAt),
					amountMinor: op.amountMinor,
					currency: accountCurrency,
					comment: op.comment,
					positionId: linkFor(op.positionId)
				})
				// re-uploads backfill fields older ingests did not know about.
				// Guarded like the insert: an unguarded backfill reintroduces the
				// identical foreign-key failure on any re-upload that re-links an
				// operation whose position is still unknown.
				.onConflictDoUpdate({
					target: brokerOperation.id,
					set: { positionId: linkFor(op.positionId) }
				});
		}

		// Holdings are a snapshot, but an empty snapshot has no holding row from
		// which freshness can be recovered. The independent singleton timestamp
		// prevents an older upload from resurrecting deleted holdings.
		if (replaced) {
			await tx.delete(holding);
			if (report.holdings.length > 0) {
				await tx.insert(holding).values(
					report.holdings.map((item) => ({
						id: uuidv7(),
						ticker: item.ticker,
						name: item.name,
						category: item.category,
						units: String(item.units),
						valueMinor: item.valueMinor,
						currency: accountCurrency,
						netProfitPct: item.netProfitPct !== null ? String(item.netProfitPct) : null,
						valuedAt: reportTime
					}))
				);
			}
		}

		const snapshotDay = reportTime.toISOString().slice(0, 10);
		// portfolio_snapshot is keyed by day, so an older report describes a
		// different row and cannot conflict with the current one. Skipping it
		// entirely meant deliberately backfilling an archived report recorded no
		// value point at all, while the action still returned snapshotDay and the
		// page reported the day as recorded — leaving the investments chart with
		// the same gap it was uploaded to close. Only the newest report may
		// overwrite a day that already carries a figure.
		const snapshotValues = {
			day: snapshotDay,
			valueMinor: report.summaryValueMinor,
			currency: accountCurrency
		};
		if (replaced) {
			await tx
				.insert(portfolioSnapshot)
				.values(snapshotValues)
				.onConflictDoUpdate({
					target: portfolioSnapshot.day,
					set: { valueMinor: report.summaryValueMinor, currency: accountCurrency }
				});
		} else {
			await tx.insert(portfolioSnapshot).values(snapshotValues).onConflictDoNothing();
		}

		if (replaced) {
			await tx
				.insert(brokerImportState)
				.values({ id: 'global', latestGeneratedAt: reportTime, currency: accountCurrency })
				.onConflictDoUpdate({
					target: brokerImportState.id,
					set: { latestGeneratedAt: reportTime, currency: accountCurrency }
				});
		} else if (!state && latestGeneratedAt) {
			// Seed the state for databases populated outside migrations/tests, even
			// when this upload is older than the inferred current snapshot.
			await tx
				.insert(brokerImportState)
				.values({
					id: 'global',
					latestGeneratedAt,
					currency: knownCurrency ?? accountCurrency
				})
				.onConflictDoNothing();
		}

		return {
			operationsAdded: added,
			operationsKnown: known,
			holdings: report.holdings.length,
			snapshotDay,
			replacedHoldings: replaced
		};
	});
}
