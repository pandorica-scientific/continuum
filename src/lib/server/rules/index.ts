// SPDX-License-Identifier: AGPL-3.0-or-later
// Database side of the rules engine. All matching happens in the pure module;
// this loads rules, records evidence, and previews matches without writing.

import { eq, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { rule, ruleTag, settings } from '$lib/server/db/schema';
import {
	DEFAULT_AUTO_THRESHOLD,
	ruleMatches,
	type Condition,
	type RowLike,
	type RuleLike
} from '$lib/rules/match';

/** Confidence a rule must reach before it files without asking. */
export async function autoThreshold(handle: Queryable = db): Promise<number> {
	const rows = await handle.select().from(settings).where(eq(settings.key, 'rules.autoThreshold'));
	return rows.length > 0 ? (rows[0].value as number) : DEFAULT_AUTO_THRESHOLD;
}

export async function loadRules(handle: Queryable = db): Promise<RuleLike[]> {
	const [rows, tagRows] = await Promise.all([
		handle.select().from(rule),
		handle.select().from(ruleTag)
	]);

	const tagsByRule = new Map<string, string[]>();
	for (const row of tagRows) {
		const list = tagsByRule.get(row.ruleId) ?? [];
		list.push(row.tagId);
		tagsByRule.set(row.ruleId, list);
	}

	return rows.map((row) => ({
		id: row.id,
		enabled: row.enabled,
		conditions: row.conditions as Condition[],
		categoryId: row.categoryId,
		tagIds: tagsByRule.get(row.id) ?? [],
		acceptedCount: row.acceptedCount,
		correctedCount: row.correctedCount,
		createdAt: row.createdAt.toISOString()
	}));
}

/** Record what a human's decision said about each rule that had an opinion. */
export async function applyScores(
	changes: { ruleId: string; accepted: number; corrected: number }[],
	handle: Queryable = db
): Promise<void> {
	for (const change of changes) {
		if (change.accepted === 0 && change.corrected === 0) continue;
		await handle
			.update(rule)
			.set({
				acceptedCount: sql`${rule.acceptedCount} + ${change.accepted}`,
				correctedCount: sql`${rule.correctedCount} + ${change.corrected}`
			})
			.where(eq(rule.id, change.ruleId));
	}
}

interface PreviewResult {
	count: number;
	rows: { id: string; date: string; merchant: string; amountMinor: bigint; currency: string }[];
}

/**
 * What a candidate rule would match, using the same pure matcher ingest uses.
 * Writes nothing, so a broad rule can be inspected before it touches anything.
 */
export async function previewMatches(conditions: Condition[], limit = 5): Promise<PreviewResult> {
	if (conditions.length === 0) return { count: 0, rows: [] };
	const { transaction } = await import('$lib/server/db/schema');

	const candidate: RuleLike = {
		id: 'preview',
		enabled: true,
		conditions,
		categoryId: null,
		tagIds: [],
		acceptedCount: 0,
		correctedCount: 0,
		createdAt: new Date().toISOString()
	};

	const rows = await db
		.select({
			id: transaction.id,
			bookedOn: transaction.bookedOn,
			counterparty: transaction.counterparty,
			counterpartyAccount: transaction.counterpartyAccount,
			variableSymbol: transaction.variableSymbol,
			description: transaction.description,
			amountMinor: transaction.amountMinor,
			currency: transaction.currency
		})
		.from(transaction);

	const matching = rows.filter((row: (typeof rows)[number]) =>
		ruleMatches(candidate, {
			...row,
			amountMinor: row.amountMinor,
			currency: row.currency
		} as RowLike)
	);

	return {
		count: matching.length,
		rows: matching.slice(0, limit).map((row) => ({
			id: row.id,
			date: row.bookedOn,
			merchant: row.counterparty ?? row.description ?? '—',
			amountMinor: row.amountMinor,
			currency: row.currency
		}))
	};
}
