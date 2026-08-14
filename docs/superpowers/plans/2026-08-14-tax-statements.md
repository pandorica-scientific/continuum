# Yearly Tax Statements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the yearly tax statement each person receives in each country, pre-filled from the payslip history and correctable, and draw three history charts from it.

**Architecture:** Two canonical figures per statement plus free labelled lines, so no jurisdiction is encoded in the schema. Currency lives on the statement, so a chart series — one person in one country — never mixes currencies and nothing is converted. Nothing is computed: the app records what a statement said.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript strict, PostgreSQL via Drizzle ORM, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-14-tax-statements-design.md`

## Global Constraints

- **Robert makes all git commits.** Never run `git commit`. Each task ends with a verification checkpoint; stop there and report.
- Money is integer minor units (`bigint`) plus a currency code. Never floats.
- **No tax computation.** No brackets, allowances, ceilings, residency or treaty logic. The only arithmetic is the effective rate, which is a ratio of two recorded figures.
- Nothing variable is hard-coded — in particular there is no country list.
- Server-only code lives under `src/lib/server/`. Pure logic lives elsewhere under `src/lib/` and is unit-testable without a database.
- Tests: `npm test`, `npm run test:e2e` (needs `npm run build` and the database), `npm run check`, `npm run lint`.
- E2E is one ordered serial journey; new tests append to existing state.
- `drizzle-kit` needs `DATABASE_URL` even to generate: prefix with `DATABASE_URL='postgres://continuum:continuum@localhost:5432/continuum'`.

## Context the implementer needs

**Payslips are documents, not a table.** A payslip is a row in `document` with `shelf = 'payslips'`, an `amountMinor`, a `periodMonth` (`yyyy-mm`) and a free-text `subject` naming whose it is. There is no `personId`. The retirement screen matches them with a case-insensitive trimmed comparison against `person.name`:

```ts
.filter((d) => d.subject.trim().toLowerCase() === p.name.trim().toLowerCase())
```

Prefill must use exactly that comparison, so the two screens agree about whose payslip is whose.

---

## File Structure

**Create:**

- `src/lib/tax.ts` — pure: effective rate, payslip-year totals, chart series grouping. Client-safe.
- `src/lib/server/tax.ts` — load, save and delete statements with their lines.
- `src/routes/(app)/tax/+page.server.ts`, `+page.svelte` — the screen.
- `src/lib/components/TaxStatementDialog.svelte` — add and edit.
- `src/lib/charts/TaxCharts.svelte` — the three charts.
- `tests/unit/tax.test.ts`.

**Modify:**

- `src/lib/server/db/schema.ts` — `tax_statement`, `tax_statement_line`.
- `src/lib/modules/registry.ts` — the `tax` module and nav item.
- `src/lib/server/demo.ts`, `tests/e2e/flow.spec.ts`.

---

### Task 1: Pure arithmetic and grouping

**Files:**

- Create: `src/lib/tax.ts`, `tests/unit/tax.test.ts`

**Interfaces:**

- Produces:

  ```ts
  interface StatementLike {
  	personId: string;
  	personName: string;
  	year: number;
  	country: string;
  	currency: string;
  	grossIncomeMinor: bigint;
  	taxPaidMinor: bigint;
  }
  interface Series {
  	key: string; // `${personId}|${country}`
  	label: string; // "Jana · CZ"
  	currency: string;
  	points: { year: number; grossMinor: bigint; taxMinor: bigint; ratePct: number | null }[];
  }
  function effectiveRatePct(grossMinor: bigint, taxMinor: bigint): number | null;
  function payslipYearTotal(
  	slips: { subject: string; periodMonth: string; amountMinor: bigint | null }[],
  	personName: string,
  	year: number
  ): { totalMinor: bigint; months: number };
  function taxSeries(statements: StatementLike[]): Series[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { effectiveRatePct, payslipYearTotal, taxSeries } from '$lib/tax';

const stmt = (over: Partial<Parameters<typeof taxSeries>[0][number]> = {}) => ({
	personId: 'p1',
	personName: 'Jana',
	year: 2025,
	country: 'CZ',
	currency: 'CZK',
	grossIncomeMinor: 100000000n,
	taxPaidMinor: 15000000n,
	...over
});

describe('effectiveRatePct', () => {
	it('is tax over gross as a percentage', () => {
		expect(effectiveRatePct(100000000n, 15000000n)).toBeCloseTo(15, 5);
	});

	it('is null when gross is zero, rather than dividing by it', () => {
		expect(effectiveRatePct(0n, 15000000n)).toBeNull();
	});

	it('is zero when no tax was paid', () => {
		expect(effectiveRatePct(100000000n, 0n)).toBe(0);
	});
});

describe('payslipYearTotal', () => {
	const slips = [
		{ subject: 'Jana Nováková', periodMonth: '2025-01', amountMinor: 5000000n },
		{ subject: ' jana nováková ', periodMonth: '2025-02', amountMinor: 5000000n },
		{ subject: 'Jan Novák', periodMonth: '2025-03', amountMinor: 9900000n },
		{ subject: 'Jana Nováková', periodMonth: '2024-11', amountMinor: 4000000n },
		{ subject: 'Jana Nováková', periodMonth: '2025-04', amountMinor: null }
	];

	it('sums one person one year, matching subjects case- and space-insensitively', () => {
		expect(payslipYearTotal(slips, 'Jana Nováková', 2025)).toEqual({
			totalMinor: 10000000n,
			months: 2
		});
	});

	it('does not borrow another person or another year', () => {
		expect(payslipYearTotal(slips, 'Jan Novák', 2025).totalMinor).toBe(9900000n);
		expect(payslipYearTotal(slips, 'Jana Nováková', 2024).totalMinor).toBe(4000000n);
	});

	it('is zero when nothing matches', () => {
		expect(payslipYearTotal(slips, 'Nobody', 2025)).toEqual({ totalMinor: 0n, months: 0 });
	});
});

describe('taxSeries', () => {
	it('keeps a person’s two countries as two separate series', () => {
		const series = taxSeries([stmt(), stmt({ country: 'PL', currency: 'PLN' })]);
		expect(series).toHaveLength(2);
		expect(series.map((s) => s.key).sort()).toEqual(['p1|CZ', 'p1|PL']);
	});

	it('makes four series from two people in two countries', () => {
		const series = taxSeries([
			stmt(),
			stmt({ country: 'PL', currency: 'PLN' }),
			stmt({ personId: 'p2', personName: 'Jan' }),
			stmt({ personId: 'p2', personName: 'Jan', country: 'PL', currency: 'PLN' })
		]);
		expect(series).toHaveLength(4);
	});

	it('orders a series’ points by year and carries the derived rate', () => {
		const series = taxSeries([stmt({ year: 2025 }), stmt({ year: 2023 })]);
		expect(series[0].points.map((p) => p.year)).toEqual([2023, 2025]);
		expect(series[0].points[0].ratePct).toBeCloseTo(15, 5);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/tax.test.ts`
Expected: FAIL — `Cannot find module '$lib/tax'`.

- [ ] **Step 3: Implement**

Create `src/lib/tax.ts`. `effectiveRatePct` returns `null` when gross is zero and otherwise `Number(tax * 10000n / gross) / 100`, computed in bigint before converting so the ratio does not go through a float. `payslipYearTotal` filters on the trimmed lowercased subject and the `yyyy` prefix of `periodMonth`, skipping slips with a null amount, and returns the sum and the count. `taxSeries` groups by `${personId}|${country}`, labels as `${personName} · ${country}`, sorts points by year, and sorts series by label.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/tax.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Checkpoint**

Run `npm test`, `npm run check`, `npm run lint`. Report. Robert reviews and commits.

---

### Task 2: Schema and migration

**Files:**

- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0015_*.sql` (generated)

- [ ] **Step 1: Add the tables**

```ts
// ---- Tax statements ----

// What a yearly tax statement said, per person per country. Nothing here is
// computed: no brackets, no allowances, no residency. The two canonical figures
// exist in every country, so the charts always have something to draw; anything
// a particular country itemises separately is a labelled line.
export const taxStatement = pgTable(
	'tax_statement',
	{
		id: text('id').primaryKey(),
		personId: text('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		year: integer('year').notNull(),
		// free text on purpose — a validated country list would need maintaining
		country: text('country').notNull(),
		// the statement's own currency, so a series never mixes currencies
		currency: text('currency').notNull(),
		grossIncomeMinor: bigint('gross_income_minor', { mode: 'bigint' }).notNull(),
		taxPaidMinor: bigint('tax_paid_minor', { mode: 'bigint' }).notNull(),
		documentId: text('document_id').references(() => document.id, { onDelete: 'set null' }),
		note: text('note'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('tax_statement_unique_idx').on(table.personId, table.year, table.country)]
);

export const taxStatementLine = pgTable('tax_statement_line', {
	id: text('id').primaryKey(),
	statementId: text('statement_id')
		.notNull()
		.references(() => taxStatement.id, { onDelete: 'cascade' }),
	label: text('label').notNull(),
	amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
	sort: integer('sort').notNull().default(0)
});
```

- [ ] **Step 2: Generate and verify**

Run: `DATABASE_URL='postgres://continuum:continuum@localhost:5432/continuum' npm run db:generate`, then `npm run check`.
Expected: `drizzle/0015_*.sql` creating two tables, `0 ERRORS`.

- [ ] **Step 3: Checkpoint**

Run `npm test` and `npm run lint`. Report. Robert reviews and commits.

---

### Task 3: The screen, with prefill

**Files:**

- Create: `src/lib/server/tax.ts`, `src/routes/(app)/tax/+page.server.ts`, `+page.svelte`, `src/lib/components/TaxStatementDialog.svelte`
- Modify: `src/lib/modules/registry.ts`

**Interfaces:**

- Produces: `loadStatements()`, `saveStatement(input)`, `deleteStatement(id)` in `src/lib/server/tax.ts`.

- [ ] **Step 1: The module entry**

In `src/lib/modules/registry.ts`, add to `MODULES`:

```ts
	tax: { emoji: '🧾', label: 'Tax', note: 'yearly statements per person and country' },
```

and a nav item in the **Money** group after Rules, **with** a module key — unlike the register, tags and rules, a household with one salary and no foreign income does not need this screen:

```ts
			{ path: '/tax', label: 'Tax', emoji: '🧾', module: 'tax' },
```

- [ ] **Step 2: Server functions**

`loadStatements()` returns every statement with its lines, its person's name, and its linked document name if any. `saveStatement` upserts on `(personId, year, country)` and replaces the statement's lines wholesale, the same pattern `setTransactionTags` uses. `deleteStatement` cascades to the lines.

- [ ] **Step 3: Load with prefill data**

`+page.server.ts` returns the statements, the people, the documents on the `tax` shelf for the attach picker, and the payslip rows needed for prefill:

```ts
const slips = (await db.select().from(document).where(eq(document.shelf, 'payslips'))).map((d) => ({
	subject: d.subject,
	periodMonth: d.periodMonth ?? '',
	amountMinor: d.amountMinor
}));
```

Pass these to the client so the dialog can call `payslipYearTotal` live as the person and year change, without a round trip.

- [ ] **Step 4: The dialog**

`TaxStatementDialog.svelte` in a `Modal`: person, year, country, currency, gross, tax paid, repeatable labelled lines, an optional document from the `tax` shelf, a note.

**Prefill rule:** when the dialog is opened for a _new_ statement, and whenever the person or year changes while creating, the gross field is set from `payslipYearTotal` and a hint reads "from 12 payslips". Editing an existing statement never prefills and never overwrites. Once the user types in the gross field, changing the person or year no longer overwrites what they typed.

Style to match the rest of the app: bordered controls on `var(--card)`, `8px` radius, `13.5px` type, secondary text `var(--fg3)`. There is no global input styling in `app.css`, so each screen declares its own.

- [ ] **Step 5: The list**

Statements grouped by person, then country, newest year first. Each row shows year, gross, tax paid and the derived effective rate, with edit and delete. When the saved gross differs from the payslip total for that person and year, show a quiet note beneath: `payslips total X — this statement says Y`. Recomputed at display time, never stored.

- [ ] **Step 6: Verify**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test`
Expected: all green, E2E count unchanged.

- [ ] **Step 7: Checkpoint**

Robert reviews and commits.

---

### Task 4: The charts

**Files:**

- Create: `src/lib/charts/TaxCharts.svelte`
- Modify: `src/routes/(app)/tax/+page.svelte`

- [ ] **Step 1: Build the charts**

Three line charts driven by `taxSeries`, following the existing `SalaryCharts.svelte` precedent for layout, axis and colour handling: gross income by year, tax paid by year, effective rate by year. One line per series, legend labelled `Person · Country`.

Each chart states its currency, since two series may be in different currencies and are deliberately not converted. Where series differ in currency, the money charts render one panel per currency rather than plotting PLN against CZK on a shared axis — the rate chart is a percentage and is always shared.

- [ ] **Step 2: Verify**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test`
Expected: all green.

- [ ] **Step 3: Checkpoint**

Robert reviews and commits.

---

### Task 5: Demo seeding and the E2E journey

**Files:**

- Modify: `src/lib/server/demo.ts`, `tests/e2e/flow.spec.ts`

- [ ] **Step 1: Write the failing tests**

Insert after the API tests and before the module-toggle test:

```ts
test('a tax statement prefills its gross from the payslips and can be corrected', async ({
	page
}) => {
	await page.goto('/tax');
	await page.getByRole('button', { name: 'Add statement' }).click();

	await page.locator('.tax-person').selectOption({ index: 0 });
	await page.locator('.tax-year').fill('2026');
	await page.locator('.tax-country').fill('CZ');

	// Prefilled from the payslip history rather than left empty.
	const prefilled = await page.locator('.tax-gross').inputValue();
	expect(prefilled).not.toBe('');

	// And correctable: the saved figure is the typed one, not the derived one.
	await page.locator('.tax-gross').fill('1305000');
	await page.locator('.tax-paid').fill('195750');
	await page.getByRole('button', { name: 'Save statement' }).click();

	const row = page.locator('.tax-row', { hasText: '2026' });
	await expect(row).toBeVisible({ timeout: 10000 });
	await expect(row).toContainText('15');
});

test('the saved figure survives a reload rather than being re-derived', async ({ page }) => {
	await page.goto('/tax');
	await expect(page.locator('.tax-row', { hasText: '2026' })).toContainText('1 305 000');
});
```

The second test is the one that matters: it proves prefill does not overwrite a saved figure.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build && npx playwright test --project=desktop`
Expected: FAIL on `/tax` not existing or the Add statement button missing.

- [ ] **Step 3: Make them pass**

Align the class names from Task 3 with the selectors above: `.tax-person`, `.tax-year`, `.tax-country`, `.tax-gross`, `.tax-paid`, `.tax-row`.

If the demo has no payslips for the chosen person, the prefill assertion fails legitimately — seed payslips in Task 5 Step 4 before relying on it, or pick the person the E2E already has payslips for.

- [ ] **Step 4: Seed the demo**

In `demo.ts`, add two years of statements for one person in one country and one year for the second person in another, so the charts show more than a single point and the two-country case is visible. Include one labelled line ("Social insurance") so that feature is visible too.

- [ ] **Step 5: Verify**

Run: `npm test && npm run check && npm run lint && npm run build && npx playwright test`
Expected: all unit tests pass, `0 ERRORS`, lint clean, 29 E2E pass.

- [ ] **Step 6: Verify demo mode**

Recreate a demo database, boot with `DEMO=1`, and confirm the Tax screen lists the seeded statements and draws the charts.

- [ ] **Step 7: Checkpoint**

Robert reviews and commits.

---

## Notes for the implementer

**No tax computation, at all.** If a step seems to call for a bracket, an allowance or a residency rule, it is out of scope — re-read the spec's "What this is not". The only arithmetic here is a ratio of two figures the user typed.

**Prefill must never overwrite a saved figure.** It applies when creating, and stops applying the moment the user edits the field. The E2E reload test exists precisely to catch a regression here.

**Do not store where the gross came from.** A `derivedFromPayslips` flag goes stale as soon as either side changes. The divergence note is recomputed at display time.

**Match payslip subjects the way retirement does** — trimmed and lowercased against `person.name`. A different comparison would silently attribute a payslip to the wrong person on one screen and not the other.
