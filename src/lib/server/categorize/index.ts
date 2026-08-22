// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { uuidv7 } from 'uuidv7';
import { eq } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { bank, category, categoryGroup, rule } from '$lib/server/db/schema';
import { CATEGORY_GROUP_SEED, CATEGORY_SEED } from '$lib/categories';
import { BANK_SEED } from '$lib/banks';
import { DEFAULT_RULE_PRIOR, normalise, type RowLike, type ValueCondition } from '$lib/rules/match';

// normalise lives in the pure rules module now, so matching has no server
// dependency. Re-exported here because several importers still expect it.
export { normalise };

/** The single condition a correction implies, or null if nothing is stable. */
function conditionFor(row: RowLike): ValueCondition | null {
	if (row.counterpartyAccount)
		return {
			field: 'counterAccount',
			op: 'equals',
			value: row.counterpartyAccount.replace(/\s/g, '')
		};
	if (row.counterparty)
		return { field: 'counterparty', op: 'contains', value: normalise(row.counterparty) };
	if (row.variableSymbol)
		return { field: 'variableSymbol', op: 'equals', value: row.variableSymbol };
	return null;
}

/** True when a rule's conditions are exactly this one condition. */
function isSingleCondition(conditions: unknown, condition: ValueCondition): boolean {
	if (!Array.isArray(conditions) || conditions.length !== 1) return false;
	const only = conditions[0] as ValueCondition;
	return only.field === condition.field && (only as { value?: string }).value === condition.value;
}

/**
 * Store the rule a user correction implies, so next time is automatic.
 *
 * There is no unique index to upsert against any more — two rules may claim the
 * same counterparty, which is what makes a contested row possible — so an
 * existing rule with an identical single condition is updated in place instead.
 */
export async function learnRule(
	row: RowLike,
	categoryId: string,
	handle: Queryable = db
): Promise<void> {
	const condition = conditionFor(row);
	if (!condition) return; // nothing stable to key a rule on

	const existing = (await handle.select().from(rule)).find((r) =>
		isSingleCondition(r.conditions, condition)
	);

	// A rule this correction re-points is learned by definition, whatever it was
	// before — including one of the old seeded rows on an instance that still
	// carries them.
	if (existing) {
		await handle
			.update(rule)
			.set({ categoryId, provenance: 'learned' })
			.where(eq(rule.id, existing.id));
		return;
	}

	await handle.insert(rule).values({
		id: uuidv7(),
		name: condition.value,
		provenance: 'learned',
		conditions: [condition],
		categoryId,
		acceptedCount: DEFAULT_RULE_PRIOR
	});
}

/**
 * Idempotent: seeds the category taxonomy on boot. Categories only — a fresh
 * install starts with no rules at all.
 *
 * Earlier versions also inserted 42 curated Czech/Polish merchant patterns here
 * so a first import filed itself. They were removed because they were wrong in
 * both directions: a household that shops nowhere near them carried dead rules
 * it never asked for, and because seeding ran on every boot, a starter rule
 * someone deleted came back at the next restart. Rules are now earned — every
 * one of them comes from a correction a person actually made, which is what the
 * confidence score claims to measure.
 */
export async function seedCategories(): Promise<void> {
	// Groups first: category.group_key carries a foreign key into them.
	for (const def of CATEGORY_GROUP_SEED) {
		await db.insert(categoryGroup).values(def).onConflictDoNothing();
	}
	for (const def of CATEGORY_SEED) {
		await db.insert(category).values(def).onConflictDoNothing();
	}
}

/**
 * Idempotent: seeds the banks a fresh instance starts with.
 *
 * onConflictDoNothing for the same reason the categories above use it — a label
 * someone edited must not be reverted by the next restart. A bank a household
 * added themselves is never touched here.
 */
export async function seedBanks(): Promise<void> {
	for (const def of BANK_SEED) {
		await db.insert(bank).values(def).onConflictDoNothing();
	}
}
