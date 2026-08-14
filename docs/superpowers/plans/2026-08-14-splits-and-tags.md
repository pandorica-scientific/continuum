# Splits and Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one transaction be divided between several categories, and let transactions and split lines carry tags that roll up into running totals.

**Architecture:** Splits are an optional child table — an unsplit transaction has no split rows. Every consumer resolves a transaction through one pure function, `effectiveLines`, so the "is it split?" branch exists exactly once. Splitting nulls the parent's `categoryId` so any consumer that ever forgets the branch fails loudly (reports "unfiled") rather than silently attributing the whole amount to a stale category.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript strict, PostgreSQL via Drizzle ORM, Vitest for unit tests, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-08-14-splits-and-tags-design.md`

## Global Constraints

- **Robert makes all git commits.** Never run `git commit`. Each task ends with a verification checkpoint; stop there and report.
- Money is always integer minor units (`bigint`) plus a currency code. Never floats.
- Stored amounts are never re-denominated. Only screen-level totals convert, at the transaction's effective date (`valueDate` falling back to `bookedAt`).
- Nothing variable is hard-coded. A constant is allowed only for a fact about a file format or arithmetic.
- Server-only code lives under `src/lib/server/`. Pure, client-safe logic lives elsewhere under `src/lib/` and is unit-testable without a database.
- Tests: `npm test` (unit), `npm run test:e2e` (needs `npm run build` and the database first), `npm run check` (types), `npm run lint`.
- E2E tests are one ordered serial journey. New tests append to the existing state; they do not reset it.

---

## File Structure

**Create:**

- `src/lib/transactions/lines.ts` — pure `effectiveLines`. Client-safe, no database.
- `src/lib/server/splits.ts` — `loadSplits`, `saveSplits`, `deleteSplits`. Owns all four invariants.
- `src/lib/server/tags.ts` — tag upsert, attach/detach, tag totals.
- `src/lib/components/SplitDialog.svelte` — the split editor.
- `src/lib/components/TagInput.svelte` — combobox that creates tags on the fly.
- `src/routes/(app)/tags/+page.server.ts`, `+page.svelte` — tag list with totals.
- `tests/unit/lines.test.ts`, `tests/unit/splits.test.ts`, `tests/unit/tag-totals.test.ts`.

**Modify:**

- `src/lib/server/db/schema.ts` — four new tables.
- `src/lib/server/cashflow.ts` — aggregate through the seam.
- `src/lib/server/briefing.ts` — SQL aggregation moves to JavaScript through the seam.
- `src/lib/server/transactions.ts` — line-aware filtering and totals, tag filter.
- `src/lib/transactions/filter.ts` — a `tag` param.
- `src/routes/(app)/transactions/+page.server.ts`, `+page.svelte` — split rows, chips, dialog.
- `src/lib/modules/registry.ts` — `/tags` nav item.
- `src/lib/server/demo.ts` — seed one split and one tag.
- `tests/e2e/flow.spec.ts` — the splits and tags journey.

---

### Task 1: Schema and migration

**Files:**

- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0011_*.sql` (generated)

**Interfaces:**

- Produces: `transactionSplit`, `tag`, `transactionTag`, `transactionSplitTag` Drizzle table objects.

- [ ] **Step 1: Add the tables**

Append to `src/lib/server/db/schema.ts`. `primaryKey` and `uniqueIndex` are already imported at the top of the file.

```ts
// ---- Splits and tags ----

// A transaction divided between categories. Absent for the ordinary case:
// an unsplit transaction has no rows here and keeps its own categoryId.
export const transactionSplit = pgTable('transaction_split', {
	id: text('id').primaryKey(),
	transactionId: text('transaction_id')
		.notNull()
		.references(() => transaction.id, { onDelete: 'cascade' }),
	// minor units of the parent transaction's currency, same sign as the parent
	amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
	categoryId: text('category_id').references(() => category.id, { onDelete: 'set null' }),
	note: text('note'),
	sort: integer('sort').notNull().default(0)
});

// Cross-cutting groupings: a renovation, a holiday. Every tag has a running
// total, which is why no kind/type column is needed.
export const tag = pgTable('tag', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	// trimmed, lowercased, inner whitespace collapsed — carries the uniqueness
	normalisedName: text('normalised_name').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const transactionTag = pgTable(
	'transaction_tag',
	{
		transactionId: text('transaction_id')
			.notNull()
			.references(() => transaction.id, { onDelete: 'cascade' }),
		tagId: text('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' })
	},
	(table) => [primaryKey({ columns: [table.transactionId, table.tagId] })]
);

export const transactionSplitTag = pgTable(
	'transaction_split_tag',
	{
		splitId: text('split_id')
			.notNull()
			.references(() => transactionSplit.id, { onDelete: 'cascade' }),
		tagId: text('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' })
	},
	(table) => [primaryKey({ columns: [table.splitId, table.tagId] })]
);
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0011_*.sql` creating four tables, and a matching snapshot in `drizzle/meta/`.

- [ ] **Step 3: Verify types compile**

Run: `npm run check`
Expected: `0 ERRORS`. (Eight pre-existing warnings in `FloorPlanEditor.svelte`, `RefixDialog.svelte`, `documents/+page.svelte`, `retirement/+page.svelte` and `login/+page.svelte` are expected and unrelated.)

- [ ] **Step 4: Verify the migration applies**

Run: `docker compose up -d db && npm run db:migrate`
Expected: migration applies with no error.

- [ ] **Step 5: Checkpoint**

Run `npm test` and `npm run lint`. Report status. Robert reviews and commits.

---

### Task 2: The `effectiveLines` seam

**Files:**

- Create: `src/lib/transactions/lines.ts`
- Create: `tests/unit/lines.test.ts`

**Interfaces:**

- Produces:
  ```ts
  interface LineSource {
  	amount: bigint;
  	feeMinor: bigint | null;
  	categoryId: string | null;
  }
  interface SplitSource {
  	amountMinor: bigint;
  	categoryId: string | null;
  	sort: number;
  	id?: string;
  }
  interface EffectiveLine {
  	categoryId: string | null;
  	amountMinor: bigint;
  	splitId: string | null;
  }
  function effectiveLines(txn: LineSource, splits: SplitSource[]): EffectiveLine[];
  ```
- Consumed by Tasks 4, 5, 6, 9.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lines.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { effectiveLines } from '$lib/transactions/lines';

const txn = (amount: bigint, categoryId: string | null = null, feeMinor: bigint | null = null) => ({
	amount,
	feeMinor,
	categoryId
});

describe('effectiveLines', () => {
	it('gives an unsplit transaction one line carrying its own category', () => {
		expect(effectiveLines(txn(-4550n, 'groceries'), [])).toEqual([
			{ categoryId: 'groceries', amountMinor: -4550n, splitId: null }
		]);
	});

	it('returns the split rows when a transaction is split', () => {
		const splits = [
			{ id: 's1', amountMinor: -3000n, categoryId: 'groceries', sort: 0 },
			{ id: 's2', amountMinor: -1550n, categoryId: 'household', sort: 1 }
		];
		expect(effectiveLines(txn(-4550n), splits)).toEqual([
			{ categoryId: 'groceries', amountMinor: -3000n, splitId: 's1' },
			{ categoryId: 'household', amountMinor: -1550n, splitId: 's2' }
		]);
	});

	it('orders split lines by sort, not by the order they arrived', () => {
		const splits = [
			{ id: 's2', amountMinor: -1550n, categoryId: 'household', sort: 1 },
			{ id: 's1', amountMinor: -3000n, categoryId: 'groceries', sort: 0 }
		];
		expect(effectiveLines(txn(-4550n), splits).map((l) => l.splitId)).toEqual(['s1', 's2']);
	});

	it('nets the bank fee out of an unsplit line', () => {
		expect(effectiveLines(txn(-4550n, 'groceries', 50n), [])).toEqual([
			{ categoryId: 'groceries', amountMinor: -4600n, splitId: null }
		]);
	});

	it('takes the whole fee off the first split line so lines still sum to net', () => {
		const splits = [
			{ id: 's1', amountMinor: -3000n, categoryId: 'groceries', sort: 0 },
			{ id: 's2', amountMinor: -1550n, categoryId: 'household', sort: 1 }
		];
		const lines = effectiveLines(txn(-4550n, null, 50n), splits);
		expect(lines[0].amountMinor).toBe(-3050n);
		expect(lines.reduce((s, l) => s + l.amountMinor, 0n)).toBe(-4600n);
	});

	it('keeps an uncategorised unsplit transaction as one uncategorised line', () => {
		expect(effectiveLines(txn(29760n), [])).toEqual([
			{ categoryId: null, amountMinor: 29760n, splitId: null }
		]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lines.test.ts`
Expected: FAIL — `Cannot find module '$lib/transactions/lines'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/transactions/lines.ts`:

```ts
// The one place that knows a transaction may be split. Every consumer —
// cash flow, the briefing, the register, tag totals — resolves through here,
// so the branch exists once and is testable without a database.

export interface LineSource {
	amount: bigint;
	feeMinor: bigint | null;
	categoryId: string | null;
}

export interface SplitSource {
	id?: string;
	amountMinor: bigint;
	categoryId: string | null;
	sort: number;
}

export interface EffectiveLine {
	categoryId: string | null;
	amountMinor: bigint;
	/** null when the line is the transaction itself rather than a split row. */
	splitId: string | null;
}

/**
 * Resolve a transaction into the lines that count, net of the bank's own fee.
 *
 * Splits sum to the gross amount, so the fee comes off the first line by sort
 * order: the lines then sum to exactly `amount - fee` with no rounding drift,
 * matching what an unsplit transaction has always contributed.
 */
export function effectiveLines(txn: LineSource, splits: SplitSource[]): EffectiveLine[] {
	// A fee is always a cost: it makes money out more negative and money in
	// less positive, which is exactly what subtraction does either way. This
	// matches what cashflow.ts computes today as `amount - feeMinor`.
	const fee = txn.feeMinor ?? 0n;

	if (splits.length === 0) {
		return [{ categoryId: txn.categoryId, amountMinor: txn.amount - fee, splitId: null }];
	}

	const ordered = [...splits].sort((a, b) => a.sort - b.sort);
	return ordered.map((split, index) => ({
		categoryId: split.categoryId,
		amountMinor: index === 0 ? split.amountMinor - fee : split.amountMinor,
		splitId: split.id ?? null
	}));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lines.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Checkpoint**

Run `npm test`, `npm run check`, `npm run lint`. Report status. Robert reviews and commits.

---

### Task 3: `saveSplits` and the invariants

**Files:**

- Create: `src/lib/server/splits.ts`
- Create: `tests/unit/splits.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks except the schema from Task 1.
- Produces:
  ```ts
  interface SplitInput {
  	amountMinor: bigint;
  	categoryId: string | null;
  	note?: string | null;
  }
  type SplitResult = { ok: true } | { ok: false; status: number; message: string };
  function validateSplits(txnAmount: bigint, lines: SplitInput[]): SplitResult;
  function saveSplits(transactionId: string, lines: SplitInput[]): Promise<SplitResult>;
  function deleteSplits(transactionId: string): Promise<SplitResult>;
  function loadSplits(transactionIds: string[]): Promise<Map<string, SplitRow[]>>;
  ```

The validation is split out as a pure function so the four invariants are unit-testable without a database. `saveSplits` calls it before touching Postgres.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/splits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateSplits } from '$lib/server/splits';

const line = (amountMinor: bigint, categoryId: string | null = 'groceries') => ({
	amountMinor,
	categoryId
});

describe('validateSplits', () => {
	it('accepts lines that sum exactly to the transaction amount', () => {
		expect(validateSplits(-4550n, [line(-3000n), line(-1550n)])).toEqual({ ok: true });
	});

	it('rejects lines that do not sum to the transaction amount', () => {
		const result = validateSplits(-4550n, [line(-3000n), line(-1000n)]);
		expect(result.ok).toBe(false);
		expect(result).toMatchObject({ status: 400 });
	});

	it('rejects a single line, which is not a split', () => {
		expect(validateSplits(-4550n, [line(-4550n)]).ok).toBe(false);
	});

	it('rejects a line whose sign differs from the transaction', () => {
		expect(validateSplits(-4550n, [line(-5000n), line(450n)]).ok).toBe(false);
	});

	it('rejects a zero-amount line', () => {
		expect(validateSplits(-4550n, [line(-4550n), line(0n)]).ok).toBe(false);
	});

	it('accepts an empty list, which means "remove the splits"', () => {
		expect(validateSplits(-4550n, [])).toEqual({ ok: true });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/splits.test.ts`
Expected: FAIL — `Cannot find module '$lib/server/splits'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/splits.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transaction, transactionSplit } from '$lib/server/db/schema';

export interface SplitInput {
	amountMinor: bigint;
	categoryId: string | null;
	note?: string | null;
}

export type SplitResult = { ok: true } | { ok: false; status: number; message: string };

const bad = (message: string): SplitResult => ({ ok: false, status: 400, message });

/**
 * The four invariants from the spec, pure so they are testable without a
 * database and enforced in exactly one place.
 */
export function validateSplits(txnAmount: bigint, lines: SplitInput[]): SplitResult {
	if (lines.length === 0) return { ok: true }; // removing the splits
	if (lines.length === 1) return bad('A split needs at least two lines.');

	let sum = 0n;
	for (const l of lines) {
		if (l.amountMinor === 0n) return bad('A split line cannot be zero.');
		if (txnAmount < 0n !== l.amountMinor < 0n)
			return bad('Every split line must run the same way as the transaction.');
		sum += l.amountMinor;
	}
	if (sum !== txnAmount) return bad('Split lines must add up to the transaction amount.');
	return { ok: true };
}

export async function saveSplits(transactionId: string, lines: SplitInput[]): Promise<SplitResult> {
	const rows = await db.select().from(transaction).where(eq(transaction.id, transactionId));
	const txn = rows[0];
	if (!txn) return { ok: false, status: 404, message: 'Transaction not found.' };

	const valid = validateSplits(txn.amount, lines);
	if (!valid.ok) return valid;

	if (lines.length === 0) return deleteSplits(transactionId);

	await db.delete(transactionSplit).where(eq(transactionSplit.transactionId, transactionId));
	await db.insert(transactionSplit).values(
		lines.map((l, index) => ({
			id: randomUUID(),
			transactionId,
			amountMinor: l.amountMinor,
			categoryId: l.categoryId,
			note: l.note ?? null,
			sort: index
		}))
	);
	// The parent category goes null so anything that ever forgets to read the
	// splits reports this as unfiled rather than as a stale single category.
	await db
		.update(transaction)
		.set({ categoryId: null, reviewState: 'confirmed', reviewReason: null })
		.where(eq(transaction.id, transactionId));
	return { ok: true };
}

export async function deleteSplits(transactionId: string): Promise<SplitResult> {
	await db.delete(transactionSplit).where(eq(transactionSplit.transactionId, transactionId));
	// Back to the review queue: nobody has chosen a category for the whole.
	await db
		.update(transaction)
		.set({ categoryId: null, reviewState: 'needs_review', reviewReason: 'split removed' })
		.where(eq(transaction.id, transactionId));
	return { ok: true };
}

export type SplitRow = typeof transactionSplit.$inferSelect;

/** Splits for many transactions at once, so callers never query in a loop. */
export async function loadSplits(transactionIds: string[]): Promise<Map<string, SplitRow[]>> {
	const out = new Map<string, SplitRow[]>();
	if (transactionIds.length === 0) return out;
	const rows = await db
		.select()
		.from(transactionSplit)
		.where(inArray(transactionSplit.transactionId, transactionIds));
	for (const row of rows) {
		const list = out.get(row.transactionId) ?? [];
		list.push(row);
		out.set(row.transactionId, list);
	}
	return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/splits.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Checkpoint**

Run `npm test`, `npm run check`, `npm run lint`. Report status. Robert reviews and commits.

---

### Task 4: Move cash flow onto the seam — the safety checkpoint

This is the task that proves Approach A is safe. Cash flow moves onto `effectiveLines` while no transaction is yet split, so **the existing tests must stay green without modification**. If they do, the seam is behaviour-preserving before any feature depends on it.

**Files:**

- Modify: `src/lib/server/cashflow.ts:78-95`

**Interfaces:**

- Consumes: `effectiveLines` (Task 2), `loadSplits` (Task 3).

- [ ] **Step 1: Record the current behaviour**

Run: `npm test && npm run build && npx playwright test --project=desktop`
Expected: all unit tests pass and 16 E2E pass. Note the numbers — they must be identical at Step 4.

- [ ] **Step 2: Rewrite the aggregation loop**

In `src/lib/server/cashflow.ts`, add the imports:

```ts
import { effectiveLines } from '$lib/transactions/lines';
import { loadSplits } from '$lib/server/splits';
```

After the `rows`/`categories` fetch, load the splits for the fetched rows:

```ts
const splitsByTxn = await loadSplits(rows.map((r) => r.id));
```

Replace the aggregation loop (currently `for (const t of rows) { ... }` around lines 81-95) with:

```ts
for (const t of rows) {
	const lines = effectiveLines(t, splitsByTxn.get(t.id) ?? []);
	for (const line of lines) {
		const converted = convertMinorSync(
			rates,
			line.amountMinor,
			t.currency,
			base,
			t.valueDate ?? t.bookedAt
		);
		const major = Number(converted ?? line.amountMinor) / 100;
		if (line.categoryId) {
			byCategory.set(line.categoryId, (byCategory.get(line.categoryId) ?? 0) + major);
		} else if (major > 0) {
			uncategorisedIn += major;
		} else {
			uncategorisedOut += major;
		}
	}
}
```

Note the fee is no longer subtracted here — `effectiveLines` has already netted it, which is why the old `const net = t.amount - (t.feeMinor ?? 0n)` line goes away.

- [ ] **Step 3: Run the full suite**

Run: `npm test && npm run check && npm run lint`
Expected: identical unit test count to Step 1, `0 ERRORS`, lint clean.

- [ ] **Step 4: Run E2E**

Run: `npm run build && npx playwright test --project=desktop`
Expected: 16 passed — the same 16 as Step 1, unmodified. **If any E2E test needed changing to pass, stop and report: the seam is not behaviour-preserving and the fee handling is the first thing to check.**

- [ ] **Step 5: Checkpoint**

Report the before/after test counts explicitly. Robert reviews and commits.

---

### Task 5: Move the briefing onto the seam

`briefing.ts` groups in SQL and cannot call `effectiveLines`. It moves to fetching rows and aggregating in JavaScript, as `cashflow.ts` already does.

**Files:**

- Modify: `src/lib/server/briefing.ts:141-155`

**Interfaces:**

- Consumes: `effectiveLines` (Task 2), `loadSplits` (Task 3).

- [ ] **Step 1: Replace the SQL aggregation**

Replace the `db.select(...)` query in the `overspend` source with a fetch plus a JavaScript rollup that produces the same `{ groupKey, month, spent }` shape the rest of the function already consumes:

```ts
const [txns, categories] = await Promise.all([
	db.select().from(transaction).where(isNull(transaction.transferPairId)),
	db.select().from(category)
]);
const groupByCategory = new Map(categories.map((c) => [c.id, c.groupKey]));
const splitsByTxn = await loadSplits(txns.map((t) => t.id));

// Same shape the loop below already expects: spending per group per month,
// as a positive number of minor units.
const tally = new Map<string, number>();
for (const t of txns) {
	const month = (t.valueDate ?? t.bookedAt).slice(0, 7);
	for (const line of effectiveLines(t, splitsByTxn.get(t.id) ?? [])) {
		if (line.amountMinor >= 0n || !line.categoryId) continue;
		const groupKey = groupByCategory.get(line.categoryId);
		if (!groupKey || groupKey === 'income' || groupKey === 'savings') continue;
		const key = `${groupKey}�${month}`;
		tally.set(key, (tally.get(key) ?? 0) + Number(-line.amountMinor));
	}
}
const rows = [...tally].map(([key, spent]) => {
	const [groupKey, month] = key.split('�');
	return { groupKey, month, spent: String(spent) };
});
```

Add `isNull` to the `drizzle-orm` import if it is not already there, and import `effectiveLines` and `loadSplits`. The downstream loop is unchanged: it already reads `r.groupKey`, `r.month` and `Number(r.spent)`.

- [ ] **Step 2: Run the full suite**

Run: `npm test && npm run check && npm run lint`
Expected: all unit tests pass, `0 ERRORS`, lint clean.

- [ ] **Step 3: Run E2E**

Run: `npm run build && npx playwright test --project=desktop`
Expected: 16 passed, unmodified.

- [ ] **Step 4: Checkpoint**

Robert reviews and commits.

---

### Task 6: Line-aware register filtering and totals

The register's category filter must match a transaction when **any** of its effective lines match, and the filtered total must sum matching **lines**, not whole transactions.

**Files:**

- Modify: `src/lib/server/transactions.ts`
- Create test: add to `tests/unit/lines.test.ts`

**Interfaces:**

- Consumes: `effectiveLines` (Task 2), `loadSplits` (Task 3).
- Produces: `matchingLineTotal(txn, splits, categoryId): bigint` exported from `src/lib/transactions/lines.ts`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/lines.test.ts`:

```ts
import { matchingLineTotal } from '$lib/transactions/lines';

describe('matchingLineTotal', () => {
	const splits = [
		{ id: 's1', amountMinor: -3000n, categoryId: 'groceries', sort: 0 },
		{ id: 's2', amountMinor: -1550n, categoryId: 'household', sort: 1 }
	];

	it('counts only the matching share of a split transaction', () => {
		expect(matchingLineTotal(txn(-4550n), splits, 'groceries')).toBe(-3000n);
	});

	it('counts the whole transaction when no category filter is applied', () => {
		expect(matchingLineTotal(txn(-4550n), splits, null)).toBe(-4550n);
	});

	it('counts nothing when no line matches', () => {
		expect(matchingLineTotal(txn(-4550n), splits, 'salary')).toBe(0n);
	});

	it('counts the whole of an unsplit transaction that matches', () => {
		expect(matchingLineTotal(txn(-4550n, 'groceries'), [], 'groceries')).toBe(-4550n);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lines.test.ts`
Expected: FAIL — `matchingLineTotal is not a function`.

- [ ] **Step 3: Implement it**

Append to `src/lib/transactions/lines.ts`:

```ts
/**
 * How much of a transaction a category filter actually selects. Filtering by
 * Groceries on a half-groceries receipt must show the groceries half, not the
 * whole receipt.
 */
export function matchingLineTotal(
	txn: LineSource,
	splits: SplitSource[],
	categoryId: string | null
): bigint {
	const lines = effectiveLines(txn, splits);
	const wanted = categoryId === null ? lines : lines.filter((l) => l.categoryId === categoryId);
	return wanted.reduce((sum, l) => sum + l.amountMinor, 0n);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lines.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Make the register's category filter line-aware**

In `src/lib/server/transactions.ts`, the category clause in `registerWhere` currently reads `eq(transaction.categoryId, filter.categoryId)`. A split transaction has a null parent category, so that clause would hide it. Replace the non-`UNCATEGORISED` branch with a clause that also matches through splits:

```ts
else if (filter.categoryId)
	clauses.push(
		or(
			eq(transaction.categoryId, filter.categoryId),
			sql`exists (select 1 from transaction_split s
			            where s.transaction_id = ${transaction.id}
			              and s.category_id = ${filter.categoryId})`
		) as SQL
	);
```

The `UNCATEGORISED` branch also changes: a split transaction has `categoryId = null` but is not uncategorised, so exclude anything that has splits:

```ts
if (filter.categoryId === UNCATEGORISED)
	clauses.push(
		and(
			isNull(transaction.categoryId),
			sql`not exists (select 1 from transaction_split s where s.transaction_id = ${transaction.id})`
		) as SQL
	);
```

- [ ] **Step 6: Make the filtered total line-summed**

In `registerPage`, the per-currency `sum(...)` aggregate is no longer correct for split transactions under a category filter. Replace the aggregate query with a fetch of the matching transactions plus their splits, summed through `matchingLineTotal`:

```ts
const matching = await db
	.select({
		id: transaction.id,
		amount: transaction.amount,
		feeMinor: transaction.feeMinor,
		categoryId: transaction.categoryId,
		currency: transaction.currency
	})
	.from(transaction)
	.where(where);
const splitsForTotals = await loadSplits(matching.map((m) => m.id));

const sumByCurrency = new Map<string, bigint>();
for (const m of matching) {
	const value = matchingLineTotal(m, splitsForTotals.get(m.id) ?? [], filter.categoryId ?? null);
	sumByCurrency.set(m.currency, (sumByCurrency.get(m.currency) ?? 0n) + value);
}
const total = matching.length;
```

Build `totals` from `sumByCurrency`, sorted by currency code, and `pageCount` from `total` as before.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test --project=desktop`
Expected: unit tests pass including the four new ones, `0 ERRORS`, lint clean, 16 E2E pass.

- [ ] **Step 8: Checkpoint**

Robert reviews and commits.

---

### Task 7: The split dialog

**Files:**

- Create: `src/lib/components/SplitDialog.svelte`
- Modify: `src/routes/(app)/transactions/+page.server.ts` (a `split` action)
- Modify: `src/routes/(app)/transactions/+page.svelte` (open the dialog, expandable rows)

**Interfaces:**

- Consumes: `saveSplits`, `deleteSplits` (Task 3); `Modal.svelte`.

- [ ] **Step 1: Add the server action**

In `src/routes/(app)/transactions/+page.server.ts`, add to `actions`. Lines arrive as parallel `amount` and `categoryId` form fields; amounts are typed in major units and parsed with the existing helper.

```ts
split: async ({ request }) => {
	const form = await request.formData();
	const id = String(form.get('id') ?? '');
	const currency = String(form.get('currency') ?? '');
	const amounts = form.getAll('amount').map(String);
	const categoryIds = form.getAll('categoryId').map(String);

	let lines;
	try {
		lines = amounts
			.map((raw, i) => ({
				amountMinor: parseAmountToMinor(raw, currency),
				categoryId: categoryIds[i] || null
			}))
			.filter((l) => l.amountMinor !== 0n);
	} catch {
		return fail(400, { message: 'Every split line needs a valid amount.' });
	}

	const result = await saveSplits(id, lines);
	if (!result.ok) return fail(result.status, { message: result.message });
	return { ok: true };
},

unsplit: async ({ request }) => {
	const form = await request.formData();
	const result = await deleteSplits(String(form.get('id') ?? ''));
	if (!result.ok) return fail(result.status, { message: result.message });
	return { ok: true };
}
```

Import `parseAmountToMinor` from `$lib/money` and `saveSplits`/`deleteSplits` from `$lib/server/splits`.

- [ ] **Step 2: Load splits for the displayed rows**

In the same file's `load`, fetch splits for the page's rows via `loadSplits` and attach a `splits` array to each row (`{ amount, categoryLabel, note }`, formatted with `formatMinor`), plus `isSplit: splits.length > 0`.

- [ ] **Step 3: Build the dialog**

Create `src/lib/components/SplitDialog.svelte` using the existing `Modal.svelte` (props: `title`, `onclose`, `children`). It holds a `$state` array of `{ amount, categoryId }` lines, shows a live remainder computed as the transaction amount minus the sum of the lines, and disables the submit button while the remainder is non-zero or fewer than two lines are filled in. Follow the form styling used by `src/routes/(app)/transactions/+page.svelte` — bordered controls using `var(--bd2)`, `var(--card)` background, `8px` radius, `13.5px` type — because there is no global input styling in `app.css`.

- [ ] **Step 4: Wire it into the register**

Add a "Split" button to each row's actions that opens the dialog for that transaction. For rows where `isSplit`, hide the File control (a split transaction has no single category to learn from), render the split lines beneath the row, and offer "Remove split" posting to `?/unsplit`.

- [ ] **Step 5: Verify manually**

Run the app against the E2E database and split a transaction between two categories. Confirm the dialog refuses to submit while the remainder is non-zero, and that the row then shows both lines.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test --project=desktop`
Expected: all green, 16 E2E pass.

- [ ] **Step 7: Checkpoint**

Robert reviews and commits.

---

### Task 8: Tags — write path, input and chips

**Files:**

- Create: `src/lib/server/tags.ts`
- Create: `src/lib/components/TagInput.svelte`
- Modify: `src/routes/(app)/transactions/+page.server.ts`, `+page.svelte`

**Interfaces:**

- Produces:

  ```ts
  function normaliseTagName(raw: string): string;
  function upsertTag(name: string): Promise<{ id: string; name: string }>;
  function setTransactionTags(transactionId: string, tagNames: string[]): Promise<void>;
  function setSplitTags(splitId: string, tagNames: string[]): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tag-totals.test.ts` with the normalisation cases first:

```ts
import { describe, expect, it } from 'vitest';
import { normaliseTagName } from '$lib/server/tags';

describe('normaliseTagName', () => {
	it('trims, lowercases and collapses inner whitespace', () => {
		expect(normaliseTagName('  Renovation   2026 ')).toBe('renovation 2026');
	});

	it('makes differently-cased spellings the same tag', () => {
		expect(normaliseTagName('Renovation')).toBe(normaliseTagName('renovation'));
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/tag-totals.test.ts`
Expected: FAIL — `Cannot find module '$lib/server/tags'`.

- [ ] **Step 3: Implement `normaliseTagName` and the write path**

Create `src/lib/server/tags.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { tag, transactionTag, transactionSplitTag } from '$lib/server/db/schema';

/** Uniqueness key: trimmed, lowercased, inner whitespace collapsed. */
export function normaliseTagName(raw: string): string {
	return raw.trim().toLowerCase().replace(/\s+/gu, ' ');
}

export async function upsertTag(name: string): Promise<{ id: string; name: string }> {
	const normalisedName = normaliseTagName(name);
	const existing = await db.select().from(tag).where(eq(tag.normalisedName, normalisedName));
	if (existing[0]) return { id: existing[0].id, name: existing[0].name };
	const row = { id: randomUUID(), name: name.trim(), normalisedName };
	await db.insert(tag).values(row).onConflictDoNothing();
	return { id: row.id, name: row.name };
}
```

Then `setTransactionTags` and `setSplitTags`, each replacing the join rows for that owner wholesale (delete then insert), so the caller passes the complete desired set rather than diffing.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/tag-totals.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Build `TagInput.svelte` and wire it in**

A combobox over the known tag names with free text allowed, submitting a comma-free list of names. Add a `tags` action to the register that calls `setTransactionTags`, render existing tags as chips on each row, and include tag chips on split lines.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test --project=desktop`
Expected: all green.

- [ ] **Step 7: Checkpoint**

Robert reviews and commits.

---

### Task 9: Tag totals, the tag filter and the `/tags` screen

**Files:**

- Modify: `src/lib/server/tags.ts` (totals), `src/lib/transactions/filter.ts` (a `tag` param), `src/lib/server/transactions.ts` (tag clause), `src/lib/modules/registry.ts`
- Create: `src/routes/(app)/tags/+page.server.ts`, `+page.svelte`
- Modify test: `tests/unit/tag-totals.test.ts`

**Interfaces:**

- Consumes: `effectiveLines`, `loadSplits`, `normaliseTagName`.
- Produces:

  ```ts
  type TagRefs = {
  	transactionTags: { transactionId: string; tagId: string }[];
  	splitTags: { splitId: string; tagId: string }[];
  };
  // pure, unit-testable: tagId → currency → summed minor units
  function rollUpTagTotals(
  	txns: (LineSource & { id: string; currency: string })[],
  	splits: Map<string, SplitSource[]>,
  	refs: TagRefs
  ): Map<string, Map<string, bigint>>;
  // the database-backed wrapper the /tags screen calls
  function tagTotals(): Promise<
  	{ id: string; name: string; totals: { currency: string; sumMinor: bigint }[] }[]
  >;
  ```

- [ ] **Step 1: Write the failing test for the double-count rule**

Append to `tests/unit/tag-totals.test.ts` a test of the pure rollup function `rollUpTagTotals`, covering the case the spec calls out: a transaction tagged at transaction level whose split also carries the same tag must count once, at transaction level.

```ts
import { rollUpTagTotals } from '$lib/server/tags';

it('counts a transaction once when both it and its split carry the tag', () => {
	const txns = [
		{
			id: 't1',
			amount: -4550n,
			feeMinor: null,
			categoryId: null,
			currency: 'CZK',
			effectiveDate: '2026-07-04'
		}
	];
	const splits = new Map([
		['t1', [{ id: 's1', amountMinor: -3000n, categoryId: 'groceries', sort: 0 }]]
	]);
	const totals = rollUpTagTotals(txns, splits, {
		transactionTags: [{ transactionId: 't1', tagId: 'reno' }],
		splitTags: [{ splitId: 's1', tagId: 'reno' }]
	});
	expect(totals.get('reno')?.get('CZK')).toBe(-4550n);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/tag-totals.test.ts`
Expected: FAIL — `rollUpTagTotals is not a function`.

- [ ] **Step 3: Implement `rollUpTagTotals`**

Append to `src/lib/server/tags.ts`:

```ts
export function rollUpTagTotals(
	txns: (LineSource & { id: string; currency: string })[],
	splits: Map<string, SplitSource[]>,
	refs: TagRefs
): Map<string, Map<string, bigint>> {
	const byId = new Map(txns.map((t) => [t.id, t]));
	const out = new Map<string, Map<string, bigint>>();

	const add = (tagId: string, currency: string, amount: bigint) => {
		const perCurrency = out.get(tagId) ?? new Map<string, bigint>();
		perCurrency.set(currency, (perCurrency.get(currency) ?? 0n) + amount);
		out.set(tagId, perCurrency);
	};

	// Transaction-level tags cover the whole transaction.
	const wholeTagged = new Set<string>();
	for (const ref of refs.transactionTags) {
		const txn = byId.get(ref.transactionId);
		if (!txn) continue;
		wholeTagged.add(`${ref.transactionId} ${ref.tagId}`);
		for (const line of effectiveLines(txn, splits.get(txn.id) ?? [])) {
			add(ref.tagId, txn.currency, line.amountMinor);
		}
	}

	// Split-level tags cover their own line — unless the parent already counted
	// the whole transaction under the same tag, which would double it.
	const parentOfSplit = new Map<string, string>();
	for (const [txnId, rows] of splits) {
		for (const row of rows) if (row.id) parentOfSplit.set(row.id, txnId);
	}
	for (const ref of refs.splitTags) {
		const txnId = parentOfSplit.get(ref.splitId);
		if (!txnId) continue;
		if (wholeTagged.has(`${txnId} ${ref.tagId}`)) continue;
		const txn = byId.get(txnId);
		if (!txn) continue;
		const line = effectiveLines(txn, splits.get(txnId) ?? []).find(
			(l) => l.splitId === ref.splitId
		);
		if (line) add(ref.tagId, txn.currency, line.amountMinor);
	}

	return out;
}
```

Import `effectiveLines`, `LineSource` and `SplitSource` from `$lib/transactions/lines`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/tag-totals.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Add the tag filter to the register**

In `src/lib/transactions/filter.ts` add `tagId: string | null` read from the `tag` param, defaulting to `null`, and extend the existing defaults test in `tests/unit/register-filter.test.ts` to include it. In `registerWhere`, match a transaction tagged directly or through any of its splits:

```ts
if (filter.tagId)
	clauses.push(
		sql`(exists (select 1 from transaction_tag tt
		             where tt.transaction_id = ${transaction.id} and tt.tag_id = ${filter.tagId})
		     or exists (select 1 from transaction_split s
		                join transaction_split_tag st on st.split_id = s.id
		                where s.transaction_id = ${transaction.id} and st.tag_id = ${filter.tagId}))`
	);
```

- [ ] **Step 6: Build the `/tags` screen**

`+page.server.ts` returns `tagTotals()`; `+page.svelte` lists tags with their per-currency totals and a converted figure, each linking to `/transactions?tag=<id>`. Add to `NAV_GROUPS` in `src/lib/modules/registry.ts`, in the Money group after Transactions, with **no** `module` key — core money screens are not toggleable:

```ts
{ path: '/tags', label: 'Tags', emoji: '🏷️' },
```

- [ ] **Step 7: Run everything**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test --project=desktop`
Expected: all green.

- [ ] **Step 8: Checkpoint**

Robert reviews and commits.

---

### Task 10: Demo seeding and the E2E journey

**Files:**

- Modify: `src/lib/server/demo.ts`
- Modify: `tests/e2e/flow.spec.ts`

- [ ] **Step 1: Write the failing E2E tests**

Insert into `tests/e2e/flow.spec.ts` after the two register tests and before the module-toggle test. The suite is serial and builds on earlier state, so this splits a transaction the earlier tests already imported:

```ts
test('splitting a transaction divides it between two categories', async ({ page }) => {
	await page.goto('/transactions?q=ACME');
	await page.getByRole('button', { name: 'Split' }).first().click();

	// Two lines that do not add up: the dialog must refuse.
	await page.locator('.split-line input[name=amount]').first().fill('10000');
	await page.locator('.split-line input[name=amount]').nth(1).fill('10000');
	await expect(page.getByRole('button', { name: 'Save split' })).toBeDisabled();

	// Balanced: 32 892 split as 20 000 + 12 892.
	await page.locator('.split-line input[name=amount]').first().fill('20000');
	await page.locator('.split-line input[name=amount]').nth(1).fill('12892');
	await page.locator('.split-line select[name=categoryId]').first().selectOption('groceries');
	await page.locator('.split-line select[name=categoryId]').nth(1).selectOption('other-income');
	await page.getByRole('button', { name: 'Save split' }).click();

	await expect(page.locator('.txn-row .split-line')).toHaveCount(2);
});

test('filtering by one category shows only that share of a split', async ({ page }) => {
	await page.goto('/transactions?q=ACME&category=groceries');
	await expect(page.locator('.txn-row')).toHaveCount(1);
	// The groceries half, not the whole 32 892.
	await expect(page.locator('.filter-total')).toContainText('20 000');
});

test('a tag rolls its transactions up into a running total', async ({ page }) => {
	await page.goto('/transactions?q=ACME');
	await page.locator('.txn-row .tag-input').first().fill('Renovation 2026');
	await page.locator('.txn-row .tag-input').first().press('Enter');
	await expect(page.locator('.txn-row .tag-chip')).toContainText('Renovation 2026');

	await page.goto('/tags');
	await expect(page.locator('.tag-row', { hasText: 'Renovation 2026' })).toBeVisible();
});
```

Note the second test asserts the line-summed total from the spec — the single most likely thing to get subtly wrong.

- [ ] **Step 2: Run E2E to verify they fail**

Run: `npm run build && npx playwright test --project=desktop`
Expected: FAIL on the Split button not existing, or on the counts above.

- [ ] **Step 3: Make them pass**

Adjust selectors and class names in the components from Tasks 7-9 so the markup matches (`.split-line`, `.tag-input`, `.tag-chip`, `.tag-row`). Do not weaken the assertions — particularly the `20 000` line-summed total.

- [ ] **Step 4: Seed the demo**

In `src/lib/server/demo.ts`, split one seeded transaction between two categories and attach one tag to a handful of transactions, so demo mode shows the feature rather than an empty tags screen.

- [ ] **Step 5: Run everything**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test --project=desktop`
Expected: all unit tests pass, `0 ERRORS`, lint clean, 19 E2E pass.

- [ ] **Step 6: Verify demo mode**

Boot a pristine instance with `DEMO=1`, sign in as Jana Nováková, and confirm the split transaction and the tag totals appear.

- [ ] **Step 7: Checkpoint**

Robert reviews and commits.

---

## Notes for the implementer

**The riskiest moment is Task 4.** If the E2E suite needs any modification to pass after cash flow moves onto `effectiveLines`, the seam is not behaviour-preserving. Stop and report rather than adjusting tests. The likeliest cause is fee handling: `effectiveLines` nets the fee, so `cashflow.ts` must no longer subtract it separately, or every fee-bearing transaction is counted twice.

**Do not add a SQL view for effective lines.** It was considered and rejected in the spec: it is a second implementation of the same rule, free to drift from the TypeScript one.

**Splitting must never teach a categorisation rule.** `learnRule` maps a counterparty to one category; a split transaction has no single answer. The register's File control is hidden for split rows for exactly this reason.
