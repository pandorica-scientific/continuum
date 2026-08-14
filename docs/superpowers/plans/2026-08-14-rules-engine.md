# Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-matcher categoriser with a rule engine that carries several conditions, sets categories and tags, and learns how far to trust each rule from whether its suggestions survive a human.

**Architecture:** Rules are unordered and carry a confidence derived from accepted/corrected counts via a Wilson lower bound. Tags are additive and always apply; categories are exclusive, so one confident match files automatically while disagreement sends the row to review with the best-supported suggestion pre-filled. Matching stays a pure function with no database access.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript strict, PostgreSQL via Drizzle ORM, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-14-rules-engine-design.md`

## Global Constraints

- **Robert makes all git commits.** Never run `git commit`. Each task ends with a verification checkpoint; stop there and report.
- Money is integer minor units (`bigint`) plus a currency code. Never floats.
- Nothing variable is hard-coded. The auto-file threshold and the prior are settings; `z` is a mathematical constant for a stated confidence level and is allowed.
- Server-only code lives under `src/lib/server/`. Pure logic lives elsewhere under `src/lib/` and is unit-testable without a database.
- Rules never modify a `confirmed` row.
- Tests: `npm test`, `npm run test:e2e` (needs `npm run build` and the database), `npm run check`, `npm run lint`.
- E2E is one ordered serial journey; new tests append to existing state.
- `drizzle-kit` needs `DATABASE_URL` set even to generate: prefix with `DATABASE_URL='postgres://continuum:continuum@localhost:5432/continuum'`.

---

## File Structure

**Create:**

- `src/lib/rules/confidence.ts` — pure Wilson lower bound. Client-safe.
- `src/lib/rules/match.ts` — pure condition matching and `decideWithRules`.
- `src/lib/server/rules.ts` — rule CRUD, scoring, preview.
- `src/routes/(app)/rules/+page.server.ts`, `+page.svelte` — the rules screen.
- `src/lib/components/RuleEditor.svelte` — conditions, actions, match preview.
- `tests/unit/confidence.test.ts`, `tests/unit/rule-match.test.ts`.

**Modify:**

- `src/lib/server/db/schema.ts` — `rule`, `rule_tag`, `transaction.suggestedCategoryId`; drop `categoryRule` after migration.
- `src/lib/server/categorize/index.ts` — seeding moves to the new shape; `learnRule` writes rules.
- `src/lib/server/import/ingest.ts` — `pairAndCategorise` uses the new decision.
- `src/lib/server/transactions.ts` — `fileTransaction` scores rules.
- `src/routes/(app)/import/+page.svelte` — show the suggestion in review.
- `src/lib/modules/registry.ts` — `/rules` nav item.
- `src/lib/server/demo.ts`, `tests/e2e/flow.spec.ts`.

---

### Task 1: Confidence arithmetic

**Files:**

- Create: `src/lib/rules/confidence.ts`, `tests/unit/confidence.test.ts`

**Interfaces:**

- Produces: `function confidence(accepted: number, corrected: number): number` — Wilson lower bound in `[0, 1]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { confidence } from '$lib/rules/confidence';

describe('confidence', () => {
	it('is zero with no evidence at all', () => {
		expect(confidence(0, 0)).toBe(0);
	});

	it('stays well below certainty after a single acceptance', () => {
		const c = confidence(1, 0);
		expect(c).toBeGreaterThan(0);
		expect(c).toBeLessThan(0.5);
	});

	it('rises as acceptances accumulate', () => {
		expect(confidence(10, 0)).toBeGreaterThan(confidence(3, 0));
		expect(confidence(50, 0)).toBeGreaterThan(confidence(10, 0));
	});

	it('never reaches one', () => {
		expect(confidence(1000, 0)).toBeLessThan(1);
	});

	it('falls when corrections arrive', () => {
		expect(confidence(10, 5)).toBeLessThan(confidence(10, 0));
		expect(confidence(1, 9)).toBeLessThan(confidence(5, 5));
	});

	it('is zero when every use was corrected', () => {
		expect(confidence(0, 8)).toBe(0);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/confidence.test.ts`
Expected: FAIL — `Cannot find module '$lib/rules/confidence'`.

- [ ] **Step 3: Implement**

```ts
// How far a rule can be trusted, as the Wilson score lower bound on its
// accepted/corrected record.
//
// A plain ratio calls a rule that was right once 100% reliable, which is exactly
// when it should not be trusted. Wilson is conservative while evidence is thin
// and relaxes as it accumulates — the right shape for a household that sees a
// given merchant a handful of times a year.

/** 95% one-sided confidence level. A constant of the arithmetic, not a setting. */
const Z = 1.96;

export function confidence(accepted: number, corrected: number): number {
	const n = accepted + corrected;
	if (n === 0) return 0;
	const p = accepted / n;
	const z2 = Z * Z;
	const numerator = p + z2 / (2 * n) - Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
	const lower = numerator / (1 + z2 / n);
	return Math.max(0, Math.min(1, lower));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/confidence.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Checkpoint**

Run `npm test`, `npm run check`, `npm run lint`. Report. Robert reviews and commits.

---

### Task 2: Schema and migration

**Files:**

- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0012_*.sql` (generated), plus a hand-written data migration appended to it

**Interfaces:**

- Produces: `rule`, `ruleTag` tables; `transaction.suggestedCategoryId`.

- [ ] **Step 1: Add the tables and column**

```ts
// ---- Rules ----

// An unordered rule: every condition must hold. Category is exclusive and can
// contest with another rule; tags are additive and always apply.
export const rule = pgTable('rule', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	enabled: boolean('enabled').notNull().default(true),
	provenance: text('provenance').notNull().default('learned'), // seeded | learned | manual
	// [{ field, op, value }], ANDed. Read only ever as a set with its rule.
	conditions: jsonb('conditions').notNull(),
	categoryId: text('category_id').references(() => category.id, { onDelete: 'set null' }),
	// Evidence, not a tuned weight: confidence is derived from these.
	acceptedCount: integer('accepted_count').notNull().default(0),
	correctedCount: integer('corrected_count').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const ruleTag = pgTable(
	'rule_tag',
	{
		ruleId: text('rule_id')
			.notNull()
			.references(() => rule.id, { onDelete: 'cascade' }),
		tagId: text('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' })
	},
	(table) => [primaryKey({ columns: [table.ruleId, table.tagId] })]
);
```

Add to the `transaction` table, beside `categoryId`:

```ts
		// What the engine would file this as, shown in the review queue so a
		// contested or unproven row arrives with a guess rather than nothing.
		suggestedCategoryId: text('suggested_category_id').references(() => category.id, {
			onDelete: 'set null'
		}),
```

Add `boolean` to the `drizzle-orm/pg-core` import list at the top of the file.

- [ ] **Step 2: Generate the migration**

Run: `DATABASE_URL='postgres://continuum:continuum@localhost:5432/continuum' npm run db:generate`
Expected: `drizzle/0012_*.sql` creating `rule` and `rule_tag` and adding the column.

- [ ] **Step 3: Append the data migration**

Append to the generated `drizzle/0012_*.sql`, so existing rules carry over in one step. The `6` below is the starter prior and must match `DEFAULT_RULE_PRIOR` in Task 3 — SQL cannot import the TypeScript constant, so this is the one place the value is duplicated. It is 6 because Wilson then gives a clean rule `0.6097`, comfortably above the `0.5` threshold, while a single correction drops it to `0.4869` and back into review. A prior of 4 clears the threshold by two thousandths, and 8 survives a correction; neither behaves well:

```sql
--> statement-breakpoint
INSERT INTO "rule" (id, name, enabled, provenance, conditions, category_id, accepted_count, corrected_count)
SELECT
  gen_random_uuid()::text,
  cr.pattern,
  true,
  cr.provenance,
  jsonb_build_array(jsonb_build_object(
    'field', CASE cr.matcher_type
               WHEN 'counterparty' THEN 'counterparty'
               WHEN 'counterparty_account' THEN 'counterAccount'
               WHEN 'variable_symbol' THEN 'variableSymbol'
             END,
    'op', CASE cr.matcher_type WHEN 'counterparty' THEN 'contains' ELSE 'equals' END,
    'value', cr.pattern
  )),
  cr.category_id,
  6,
  0
FROM "category_rule" cr;
```

The prior applies to seeded and learned rules alike: a learned rule exists because a human chose that category, and without the prior every previously-automatic filing would drop back into the review queue.

`category_rule` is **not** dropped in this migration — Task 5 removes it once the new engine is proven.

- [ ] **Step 4: Verify**

Run: `npm run check` (expect `0 ERRORS`), then `node tests/e2e/reset-db.mjs && npm run build` and boot once against the e2e database to confirm the migration applies and the rows copy across.

- [ ] **Step 5: Checkpoint**

Run `npm test` and `npm run lint`. Report. Robert reviews and commits.

---

### Task 3: Pure matching and deciding

**Files:**

- Create: `src/lib/rules/match.ts`, `tests/unit/rule-match.test.ts`

**Interfaces:**

- Consumes: `confidence` (Task 1), `normalise` from `$lib/server/categorize`.
- Produces:

```ts
type Condition =
	| { field: 'counterparty' | 'description'; op: 'contains'; value: string }
	| { field: 'counterAccount' | 'variableSymbol'; op: 'equals'; value: string }
	| { field: 'amount'; op: 'between'; min: string | null; max: string | null }; // minor units as strings

interface RuleLike {
	id: string;
	enabled: boolean;
	conditions: Condition[];
	categoryId: string | null;
	tagIds: string[];
	acceptedCount: number;
	correctedCount: number;
	createdAt: string;
}

interface RowLike {
	counterparty?: string | null;
	counterpartyAccount?: string | null;
	variableSymbol?: string | null;
	description?: string | null;
	amountMinor: bigint;
}

type RuleDecision = {
	/** Filed automatically, or held for review. */
	kind: 'auto' | 'review';
	categoryId: string | null; // the winner, or the suggestion when kind is review
	tagIds: string[]; // union over every matching rule
	reason: string | null; // why it is held; null when auto
	matched: { ruleId: string; categoryId: string | null }[];
};

function ruleMatches(rule: RuleLike, row: RowLike): boolean;
function decideWithRules(row: RowLike, rules: RuleLike[], threshold: number): RuleDecision;
```

`normalise` currently lives in `src/lib/server/categorize/index.ts`, which imports `db`. Move `normalise` into `src/lib/rules/match.ts` and re-export it from `categorize/index.ts` so the pure module has no server dependency and existing importers keep working.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { decideWithRules, ruleMatches } from '$lib/rules/match';

const THRESHOLD = 0.5;

const rule = (over: Partial<Parameters<typeof ruleMatches>[0]> = {}) => ({
	id: 'r1',
	enabled: true,
	conditions: [{ field: 'counterparty', op: 'contains', value: 'albert' }],
	categoryId: 'groceries',
	tagIds: [],
	acceptedCount: 20,
	correctedCount: 0,
	createdAt: '2026-01-01',
	...over
});

const row = { counterparty: 'ALBERT PRAHA 4', amountMinor: -45500n };

describe('ruleMatches', () => {
	it('matches a normalised whole word in the counterparty', () => {
		expect(ruleMatches(rule(), row)).toBe(true);
	});

	it('requires every condition to hold', () => {
		const twoConditions = rule({
			conditions: [
				{ field: 'counterparty', op: 'contains', value: 'albert' },
				{ field: 'amount', op: 'between', min: '100000', max: null }
			]
		});
		expect(ruleMatches(twoConditions, row)).toBe(false); // 455 < 1000
		expect(ruleMatches(twoConditions, { ...row, amountMinor: -200000n })).toBe(true);
	});

	it('compares amounts as magnitudes, so direction does not matter', () => {
		const r = rule({
			conditions: [{ field: 'amount', op: 'between', min: '40000', max: '50000' }]
		});
		expect(ruleMatches(r, { ...row, amountMinor: -45500n })).toBe(true);
		expect(ruleMatches(r, { ...row, amountMinor: 45500n })).toBe(true);
	});

	it('never matches while disabled', () => {
		expect(ruleMatches(rule({ enabled: false }), row)).toBe(false);
	});
});

describe('decideWithRules', () => {
	it('files automatically on one confident match', () => {
		const d = decideWithRules(row, [rule()], THRESHOLD);
		expect(d.kind).toBe('auto');
		expect(d.categoryId).toBe('groceries');
	});

	it('holds an unproven rule for review but still suggests its category', () => {
		const d = decideWithRules(row, [rule({ acceptedCount: 0, correctedCount: 0 })], THRESHOLD);
		expect(d.kind).toBe('review');
		expect(d.categoryId).toBe('groceries');
	});

	it('contests when two rules disagree, suggesting the better supported one', () => {
		const weak = rule({ id: 'r2', categoryId: 'eating-out', acceptedCount: 1, correctedCount: 3 });
		const d = decideWithRules(row, [weak, rule()], THRESHOLD);
		expect(d.kind).toBe('review');
		expect(d.categoryId).toBe('groceries');
		expect(d.reason).toMatch(/disagree/);
		expect(d.matched.map((m) => m.ruleId).sort()).toEqual(['r1', 'r2']);
	});

	it('does not contest when two rules agree on the category', () => {
		const twin = rule({
			id: 'r2',
			conditions: [{ field: 'counterparty', op: 'contains', value: 'praha' }]
		});
		expect(decideWithRules(row, [twin, rule()], THRESHOLD).kind).toBe('auto');
	});

	it('applies tags from every matching rule, whatever the categories', () => {
		const tagOnly = rule({ id: 'r2', categoryId: null, tagIds: ['reno'] });
		const d = decideWithRules(row, [tagOnly, rule()], THRESHOLD);
		expect(d.tagIds).toEqual(['reno']);
		expect(d.kind).toBe('auto');
	});

	it('breaks a tie on condition count, then on age', () => {
		const specific = rule({
			id: 'r2',
			categoryId: 'eating-out',
			conditions: [
				{ field: 'counterparty', op: 'contains', value: 'albert' },
				{ field: 'amount', op: 'between', min: null, max: '100000' }
			]
		});
		expect(decideWithRules(row, [rule(), specific], THRESHOLD).categoryId).toBe('eating-out');
	});

	it('holds a row nothing matches, with no suggestion', () => {
		const d = decideWithRules(
			{ counterparty: 'NOVÝ OBCHOD', amountMinor: -100n },
			[rule()],
			THRESHOLD
		);
		expect(d.kind).toBe('review');
		expect(d.categoryId).toBeNull();
		expect(d.reason).toMatch(/first time/);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/rule-match.test.ts`
Expected: FAIL — `Cannot find module '$lib/rules/match'`.

- [ ] **Step 3: Implement**

Write `src/lib/rules/match.ts` with `normalise` moved in, `ruleMatches` evaluating every condition (text via `${normalise(x)}`.includes(`${value}`), counter-account exact with whitespace stripped, amount as magnitude between inclusive bounds parsed from the stored strings), and `decideWithRules`:

1. `matched` = every enabled rule where `ruleMatches`.
2. `tagIds` = union of the matched rules' tags, order preserved, deduplicated.
3. Category-bearing matches → distinct category ids.
4. None → `{kind:'review', categoryId:null, reason:'first time seeing this counterparty'}`.
5. One → winner is the highest-confidence rule for it; `auto` when `confidence >= threshold`, else `review` with reason `'rule not proven yet'`.
6. More than one → `review`, reason `` `rules disagree (${categories.join(' vs ')})` ``, suggestion from the highest-confidence rule, ties broken by condition count then `createdAt`.

Export `DEFAULT_RULE_PRIOR = 6` and `DEFAULT_AUTO_THRESHOLD = 0.5` as the defaults the settings fall back to. These two numbers are load-bearing together: with the prior at 6, a seeded or learned rule sits at `0.6097` and files automatically, and one correction takes it to `0.4869` — below the threshold and back into review. Add a unit test pinning exactly that, so a later change to either number cannot silently stop seeded rules from filing:

```ts
import { confidence } from '$lib/rules/confidence';
import { DEFAULT_AUTO_THRESHOLD, DEFAULT_RULE_PRIOR } from '$lib/rules/match';

it('trusts a rule at the starter prior, and demotes it after one correction', () => {
	expect(confidence(DEFAULT_RULE_PRIOR, 0)).toBeGreaterThan(DEFAULT_AUTO_THRESHOLD);
	expect(confidence(DEFAULT_RULE_PRIOR, 1)).toBeLessThan(DEFAULT_AUTO_THRESHOLD);
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/rule-match.test.ts tests/unit/confidence.test.ts`
Expected: 12 passed in `rule-match`, 7 in `confidence` (the six from Task 1 plus the prior/threshold pin).

- [ ] **Step 5: Checkpoint**

Run `npm test`, `npm run check`, `npm run lint`. Report. Robert reviews and commits.

---

### Task 4: Move ingest onto the engine — the safety checkpoint

Existing tests must stay green with migrated rules and no new UI. If any needs changing, the migration is not faithful — stop and report.

**Files:**

- Create: `src/lib/server/rules.ts` (loading and scoring)
- Modify: `src/lib/server/import/ingest.ts:324-356`, `src/lib/server/categorize/index.ts`

**Interfaces:**

- Produces: `loadRules(): Promise<RuleLike[]>`, `autoThreshold(): Promise<number>`, `scoreDecision(...)`.

- [ ] **Step 1: Record the baseline**

Run: `npm test && npm run build && npx playwright test --project=desktop`
Expected: note both counts. They must be identical at Step 5.

- [ ] **Step 2: Write `loadRules` and `autoThreshold`**

`loadRules` selects rules with their tag ids (left join `rule_tag`, grouped in JavaScript) and returns `RuleLike[]` with `conditions` cast from `jsonb`. `autoThreshold` reads the setting:

```ts
export async function autoThreshold(): Promise<number> {
	return getSetting('rules.autoThreshold', DEFAULT_AUTO_THRESHOLD);
}
```

- [ ] **Step 3: Rewrite the categorisation loop in `pairAndCategorise`**

Replace `const rules = await db.select().from(categoryRule);` with `const rules = await loadRules();` and `const threshold = await autoThreshold();`, and the `decide(...)` call with `decideWithRules({...}, rules, threshold)`. On `kind === 'auto'` set `categoryId`, `reviewState: 'auto'`, `suggestedCategoryId: null`; otherwise set `reviewState: 'needs_review'`, `reviewReason: decision.reason`, `suggestedCategoryId: decision.categoryId`. Apply `decision.tagIds` through `setTransactionTags` when non-empty.

The existing guards stay exactly as they are: `confirmed` rows are skipped, and so are legs of a proposed transfer pair.

- [ ] **Step 4: Point `learnRule` at the new table**

`learnRule` writes a `rule` row instead of a `categoryRule` row: one condition derived from the same priority (counter-account, then counterparty, then variable symbol), `provenance: 'learned'`, `acceptedCount: DEFAULT_RULE_PRIOR`. Where it previously upserted on `(matcherType, pattern)`, it now looks for an existing learned rule with an identical single condition and updates its category, otherwise inserts.

Keep `seedCategories` writing the same 42 starter rules, now as `rule` rows with `provenance: 'seeded'` and the prior, inserted only when no rule with that condition exists.

- [ ] **Step 5: Verify nothing moved**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test --project=desktop`
Expected: identical counts to Step 1, `0 ERRORS`, lint clean. **If an E2E test needed modifying, stop and report** — the likely causes are the prior being too low, or `seedCategories` double-inserting rules that the data migration already copied.

- [ ] **Step 6: Checkpoint**

Report before/after counts explicitly. Robert reviews and commits.

---

### Task 5: Scoring, and dropping the old table

**Files:**

- Modify: `src/lib/server/transactions.ts` (`fileTransaction`), `src/lib/server/rules.ts`
- Modify: `src/lib/server/db/schema.ts`, new migration `drizzle/0013_*.sql`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/rule-match.test.ts` a test of the pure helper that decides who gets scored:

```ts
import { scoreChanges } from '$lib/rules/match';

it('rewards the chosen rule and penalises rules that proposed otherwise', () => {
	const matched = [
		{ ruleId: 'r1', categoryId: 'groceries' },
		{ ruleId: 'r2', categoryId: 'eating-out' },
		{ ruleId: 'r3', categoryId: null }
	];
	expect(scoreChanges(matched, 'groceries')).toEqual([
		{ ruleId: 'r1', accepted: 1, corrected: 0 },
		{ ruleId: 'r2', accepted: 0, corrected: 1 }
	]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/rule-match.test.ts`
Expected: FAIL — `scoreChanges is not a function`.

- [ ] **Step 3: Implement**

```ts
/**
 * Who earned what from a human's decision. Rules with no category had no
 * opinion to be right or wrong about, so they are not scored at all.
 */
export function scoreChanges(
	matched: { ruleId: string; categoryId: string | null }[],
	chosenCategoryId: string
): { ruleId: string; accepted: number; corrected: number }[] {
	return matched
		.filter((m) => m.categoryId !== null)
		.map((m) => ({
			ruleId: m.ruleId,
			accepted: m.categoryId === chosenCategoryId ? 1 : 0,
			corrected: m.categoryId === chosenCategoryId ? 0 : 1
		}));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/rule-match.test.ts`
Expected: 13 passed.

- [ ] **Step 5: Wire scoring into `fileTransaction`**

In `src/lib/server/transactions.ts`, before updating the row: re-run `decideWithRules` against the current rules for that transaction, call `scoreChanges(decision.matched, categoryId)`, and apply the increments with a single `UPDATE ... SET accepted_count = accepted_count + $1, corrected_count = corrected_count + $2` per rule. Then proceed with the existing update, `learnRule` and `pairAndCategorise` calls, and clear `suggestedCategoryId`.

- [ ] **Step 6: Drop `category_rule`**

Remove `categoryRule` from `schema.ts`, regenerate (`DATABASE_URL=... npm run db:generate`), confirm the migration drops only that table.

- [ ] **Step 7: Verify**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test --project=desktop`
Expected: all green, E2E count unchanged from Task 4.

- [ ] **Step 8: Checkpoint**

Robert reviews and commits.

---

### Task 6: Show the suggestion in review

**Files:**

- Modify: `src/routes/(app)/import/+page.server.ts`, `+page.svelte`

- [ ] **Step 1: Load the suggestion**

Add `suggestedCategoryId` and the suggested category's name to the `review` rows returned by the import screen's `load`.

- [ ] **Step 2: Pre-select it**

In the review row's category `<select>`, mark the suggested option `selected`. Where a row has no suggestion, keep the existing `File as…` disabled prompt so an unguessed row still does not look filed. Show the reason text as it already does.

- [ ] **Step 3: Verify**

Run: `npm run build && npx playwright test --project=desktop`
Expected: unchanged count. The existing test at `flow.spec.ts:46` selects `groceries` explicitly, so a pre-selection does not disturb it.

- [ ] **Step 4: Checkpoint**

Robert reviews and commits.

---

### Task 7: The rules screen

**Files:**

- Create: `src/routes/(app)/rules/+page.server.ts`, `+page.svelte`
- Modify: `src/lib/modules/registry.ts`

- [ ] **Step 1: Nav item**

In `NAV_GROUPS`, Money group, after Tags, with **no** `module` key:

```ts
{ path: '/rules', label: 'Rules', emoji: '⚙️' },
```

- [ ] **Step 2: The list**

`+page.server.ts` returns every rule with its conditions, category name, tag names, `acceptedCount`, `correctedCount`, and `confidence(accepted, corrected)` formatted as a percentage, plus whether it currently clears the threshold. `+page.svelte` renders one card per rule, styled to match the register: bordered controls on `var(--card)`, `8px` radius, `13.5px` type, secondary text `var(--fg3)` — there is no global input styling in `app.css`, so every screen declares its own.

Sort rules with the most-corrected first: a rule that keeps being overridden is the one worth seeing.

- [ ] **Step 3: Delete and enable/disable**

Two form actions, `toggle` and `remove`, each posting a rule id.

- [ ] **Step 4: Verify**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test --project=desktop`
Expected: all green.

- [ ] **Step 5: Checkpoint**

Robert reviews and commits.

---

### Task 8: The rule editor and match preview

**Files:**

- Create: `src/lib/components/RuleEditor.svelte`
- Modify: `src/routes/(app)/rules/+page.server.ts`

**Interfaces:**

- Produces: `previewMatches(conditions, limit): Promise<{count, rows}>` in `src/lib/server/rules.ts`.

- [ ] **Step 1: The preview function**

`previewMatches` loads transactions, runs the pure `ruleMatches` against a candidate rule built from the given conditions, and returns the count plus the first `limit` matching rows. It writes nothing. Matching in JavaScript rather than SQL keeps one implementation of the rules, exactly as `effectiveLines` does for splits.

- [ ] **Step 2: The editor**

`RuleEditor.svelte` in a `Modal`: a name, a repeatable condition row (field select, value input or min/max pair for amounts), a category select, a tag input, and a live preview panel showing "matches N transactions" with the first handful listed. Save is disabled with no conditions. A new rule is created with `provenance: 'manual'` and zero counts.

- [ ] **Step 3: The save action**

A `save` action upserting the rule and its `rule_tag` rows, then running `pairAndCategorise()` so the rule takes effect on unconfirmed rows immediately.

- [ ] **Step 4: Verify**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test --project=desktop`
Expected: all green.

- [ ] **Step 5: Checkpoint**

Robert reviews and commits.

---

### Task 9: Demo seeding and the E2E journey

**Files:**

- Modify: `src/lib/server/demo.ts`, `tests/e2e/flow.spec.ts`

- [ ] **Step 1: Write the failing E2E tests**

Insert after the tags test and before the module-toggle test:

```ts
test('a hand-written rule previews its matches before it is saved', async ({ page }) => {
	await page.goto('/rules');
	await page.getByRole('button', { name: 'New rule' }).click();
	await page.locator('.rule-name').fill('Big Alza purchases');
	await page.locator('.condition-value').first().fill('alza');
	await page.locator('.rule-category').selectOption('everything-else');
	await expect(page.locator('.preview-count')).toContainText('match', { timeout: 10000 });
	await page.getByRole('button', { name: 'Save rule' }).click();
	await expect(page.locator('.rule-row', { hasText: 'Big Alza purchases' })).toBeVisible();
});

test('correcting a rule-filed transaction is recorded against the rule', async ({ page }) => {
	await page.goto('/rules');
	const before = await page.locator('.rule-row', { hasText: 'Big Alza purchases' }).innerText();

	await page.goto('/transactions?q=alza');
	const row = page.locator('.txn-row').first();
	await row.locator('select[name=categoryId]').selectOption('groceries');
	await row.getByRole('button', { name: 'File' }).click();
	await page.waitForTimeout(500);

	await page.goto('/rules');
	const after = await page.locator('.rule-row', { hasText: 'Big Alza purchases' }).innerText();
	expect(after).not.toBe(before);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build && npx playwright test --project=desktop`
Expected: FAIL on the New rule button not existing.

- [ ] **Step 3: Make them pass**

Align the class names in Tasks 7 and 8 with the selectors above: `.rule-row`, `.rule-name`, `.condition-value`, `.rule-category`, `.preview-count`.

- [ ] **Step 4: Seed the demo**

In `demo.ts`, add one manual multi-condition rule (a counterparty plus an amount floor) so demo mode shows a rule that could not have been expressed before, and let the seeded rules supply the rest.

- [ ] **Step 5: Verify**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test`
Expected: all unit tests pass, `0 ERRORS`, lint clean, 23 E2E pass.

- [ ] **Step 6: Verify demo mode**

Recreate a demo database, boot with `DEMO=1`, and confirm the rules screen lists the seeded rules with confidences and the manual rule.

- [ ] **Step 7: Checkpoint**

Robert reviews and commits.

---

## Notes for the implementer

**Task 4 is the riskiest moment.** If the E2E suite needs any modification after ingest moves onto the engine, stop and report. The two likely causes are the prior being too low (previously-automatic rules dropping into review) and `seedCategories` inserting duplicates of rules the data migration already copied — which would make every seeded counterparty contested with itself.

**Do not add a SQL path for rule matching.** `previewMatches` and `pairAndCategorise` both run the same pure `ruleMatches`. A SQL translation would be a second implementation free to drift, the same reason `effectiveLines` has no database view.

**Silence is not consent.** Only an explicit confirmation increments `acceptedCount`. Do not add an increment when a row is auto-filed, however tempting the symmetry.

**Rules never touch a `confirmed` row.** The guard already exists in `pairAndCategorise`; keep it.
