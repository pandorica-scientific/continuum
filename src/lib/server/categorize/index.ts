import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { category, rule } from '$lib/server/db/schema';
import { CATEGORY_SEED } from '$lib/categories';
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
	provenance: 'seeded' | 'learned' = 'learned'
): Promise<void> {
	const condition = conditionFor(row);
	if (!condition) return; // nothing stable to key a rule on

	const existing = (await db.select().from(rule)).find((r) =>
		isSingleCondition(r.conditions, condition)
	);

	if (existing) {
		await db.update(rule).set({ categoryId, provenance }).where(eq(rule.id, existing.id));
		return;
	}

	await db.insert(rule).values({
		id: randomUUID(),
		name: condition.value,
		provenance,
		conditions: [condition],
		categoryId,
		acceptedCount: DEFAULT_RULE_PRIOR
	});
}

// Common Czech/Polish merchants so a fresh install starts useful. Patterns are
// normalised counterparty substrings.
const SEED_RULES: Array<[string, string]> = [
	['albert', 'groceries'],
	['lidl', 'groceries'],
	['kaufland', 'groceries'],
	['billa', 'groceries'],
	['tesco', 'groceries'],
	['penny', 'groceries'],
	['globus', 'groceries'],
	['rohlik', 'groceries'],
	['kosik', 'groceries'],
	['biedronka', 'groceries'],
	['zabka', 'groceries'],
	['mcdonald', 'eating-out'],
	['kfc', 'eating-out'],
	['starbucks', 'eating-out'],
	['bolt food', 'eating-out'],
	['wolt', 'eating-out'],
	['foodora', 'eating-out'],
	['netflix', 'internet-phone'],
	['spotify', 'internet-phone'],
	['o2', 'internet-phone'],
	['vodafone', 'internet-phone'],
	['t mobile', 'internet-phone'],
	['upc', 'internet-phone'],
	['cez', 'energy'],
	['pre', 'energy'],
	['innogy', 'energy'],
	['shell', 'fuel-tolls'],
	['omv', 'fuel-tolls'],
	['benzina', 'fuel-tolls'],
	['orlen', 'fuel-tolls'],
	['easypark', 'fuel-tolls'],
	['bolt', 'fuel-tolls'],
	['uber', 'fuel-tolls'],
	['csob leasing', 'car-loan'],
	['financni urad', 'taxes-fees'],
	['cssz', 'other-income'],
	['xtb', 'brokerage'],
	['degiro', 'brokerage'],
	['zooplus', 'everything-else'],
	['alza', 'everything-else'],
	['dm drogerie', 'everything-else'],
	['ikea', 'everything-else']
];

/**
 * Idempotent: seeds categories and starter rules on boot.
 *
 * The dedup check matters on an upgraded instance, where the 0012 data
 * migration has already copied these same rules across. Inserting them again
 * would make every seeded counterparty contest with itself and send the whole
 * starter set to the review queue.
 */
export async function seedCategories(): Promise<void> {
	for (const def of CATEGORY_SEED) {
		await db.insert(category).values(def).onConflictDoNothing();
	}

	const existing = await db.select().from(rule);
	for (const [pattern, categoryId] of SEED_RULES) {
		const condition: ValueCondition = { field: 'counterparty', op: 'contains', value: pattern };
		if (existing.some((r) => isSingleCondition(r.conditions, condition))) continue;
		await db.insert(rule).values({
			id: randomUUID(),
			name: pattern,
			provenance: 'seeded',
			conditions: [condition],
			categoryId,
			acceptedCount: DEFAULT_RULE_PRIOR
		});
	}
}
