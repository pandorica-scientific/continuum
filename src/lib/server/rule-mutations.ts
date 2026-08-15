import { eq } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import { rule, ruleTag } from '$lib/server/db/schema';
import { lockTransferPairing } from '$lib/server/import/ingest';
import { upsertTag } from '$lib/server/tags';
import type { Condition } from '$lib/rules/match';

export interface RuleDefinitionInput {
	id: string;
	name: string;
	conditions: Condition[];
	categoryId: string | null;
	tagNames: string[];
}

type Replay = (handle: Queryable) => Promise<unknown>;

/** Commit a rule mutation and every filing change caused by its replay as one
 * unit. Returning `null` means the target did not exist and skips replay. */
export async function mutateRuleAndReplay<T>(
	mutation: (handle: Queryable) => Promise<T | null>,
	replay: Replay,
	handle: Queryable = db
): Promise<T | null> {
	const operation = async (tx: Queryable) => {
		// Filing and import paths take this lock before they score/update rules.
		// Match that order or the two workflows can deadlock (pairing -> rule
		// versus rule -> pairing during replay).
		await lockTransferPairing(tx);
		const result = await mutation(tx);
		if (result === null) return null;
		await replay(tx);
		return result;
	};

	const transactional = handle as Db;
	return typeof transactional.transaction === 'function'
		? transactional.transaction(operation)
		: operation(handle);
}

/** Replace a manual rule, all of its tag links, and its immediate replay as one
 * mutation. A bad tag, foreign key, or replay can no longer leave a half-saved
 * rule behind. */
export async function saveRuleDefinition(
	input: RuleDefinitionInput,
	replay: Replay,
	handle: Queryable = db
): Promise<void> {
	await mutateRuleAndReplay(
		async (tx) => {
			const existing = await tx.select({ id: rule.id }).from(rule).where(eq(rule.id, input.id));
			if (existing[0]) {
				await tx
					.update(rule)
					.set({ name: input.name, conditions: input.conditions, categoryId: input.categoryId })
					.where(eq(rule.id, input.id));
			} else {
				await tx.insert(rule).values({
					id: input.id,
					name: input.name,
					provenance: 'manual',
					conditions: input.conditions,
					categoryId: input.categoryId
				});
			}

			await tx.delete(ruleTag).where(eq(ruleTag.ruleId, input.id));
			for (const tagName of input.tagNames) {
				const resolved = await upsertTag(tagName, tx);
				await tx
					.insert(ruleTag)
					.values({ ruleId: input.id, tagId: resolved.id })
					.onConflictDoNothing();
			}
			return undefined;
		},
		replay,
		handle
	);
}
