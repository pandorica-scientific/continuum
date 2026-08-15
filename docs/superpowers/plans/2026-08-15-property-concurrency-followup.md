# Property Concurrency Follow-up Implementation Plan

**Status:** Completed for `0.3.3` on 2026-08-15. Property loan aggregation,
active-tenancy policy, locked media updates, meter-bill uniqueness/configuration
freshness and the dated missing-rate regressions are implemented and verified.

> **Implementation record:** The checklist preserves the reviewed execution
> sequence; every item is marked complete.

**Goal:** Make property finance, tenancy selection/insertion, image/plan updates, and meter-bill selection complete and safe under concurrent requests.

**Architecture:** Keep date/range and financial aggregation policy in small pure property modules shared by both loaders. Put all state-changing property operations behind injectable database mutations that lock the owning property before reading dependent state. Back the meter-bill invariant with a partial unique PostgreSQL index as a final database guard.

**Tech Stack:** TypeScript, SvelteKit server routes, Drizzle ORM, PostgreSQL, Vitest, embedded-postgres.

**Spec:** `docs/superpowers/specs/2026-08-15-full-review-remediation.md`

## Global Constraints

- Do not create a Git commit.
- Preserve route success payloads and existing validation messages where behavior is unchanged.
- Do not edit import, register, investment, authentication, or loan-mutation files.
- Use RED/GREEN tests for every behavior change.

---

### Task 1: Aggregate every active property loan

**Files:**

- Modify: `src/lib/property/finance.ts`
- Modify: `src/routes/(app)/property/+page.server.ts`
- Test: `tests/unit/property-finance.test.ts`

**Interfaces:**

- Produces: `PropertyLoanFinancialInput` and `propertyFinancials({ loans, ... }, convert)` returning total and per-loan allocated amounts.

- [x] Add a failing pure test with two linked loans in different currencies and different shares; assert both owed balances and payments contribute to equity/cash flow.
- [x] Run `npx vitest run tests/unit/property-finance.test.ts` and confirm the single-loan implementation fails.
- [x] Change the pure financial input to accept an array and return allocated per-loan results plus totals.
- [x] Update the property loader to resolve every linked loan with `owedMinor > 0`, derive each share, calculate each current payment, and build summary text from every resulting loan.
- [x] Re-run the focused unit test and confirm it passes.

### Task 2: Share active-tenancy policy and serialize insertion

**Files:**

- Create: `src/lib/property/tenancy.ts`
- Modify: `src/lib/server/property/mutations.ts`
- Modify: `src/routes/(app)/property/+page.server.ts`
- Modify: `src/routes/(app)/retirement/+page.server.ts`
- Create: `tests/unit/property-tenancy.test.ts`
- Modify: `tests/integration/domain-atomicity.test.ts`

**Interfaces:**

- Produces: `activeTenanciesByProperty(rows, today)`, `tenancyRangesOverlap(a, b)`, and injectable `createTenancy(input, handle)` returning `{ ok: true } | { ok: false; status; message }`.

- [x] Add failing unit tests proving future and ended leases are inactive, date boundaries are inclusive, and corrupt overlapping rows resolve deterministically to the latest start date then identifier.
- [x] Add a failing embedded-PostgreSQL race test that submits two overlapping leases concurrently and expects exactly one success and one stored row.
- [x] Implement the pure policy and the owner-locking insertion mutation with range validation and an overlap check after the lock.
- [x] Use the same active map in the property and retirement loaders so one property contributes at most one current rent.
- [x] Re-run the unit and PostgreSQL tests and confirm they pass.

### Task 3: Serialize image and drawing updates

**Files:**

- Modify: `src/lib/server/property/mutations.ts`
- Modify: `src/lib/server/files.ts`
- Modify: `src/lib/components/ImageSlot.svelte`
- Modify: `src/routes/(app)/property/+page.server.ts`
- Modify: `tests/integration/domain-atomicity.test.ts`

**Interfaces:**

- Produces: injectable `setPropertyImage(input, handle)`, `setPropertyDrawing(input, handle)`, and `removeUpload(name)`.

- [x] Add failing PostgreSQL tests for concurrent photo append/drawing updates and two concurrent appends to the same stale slot.
- [x] Implement exact slot parsing, expected-image identity for replacements, append intent, property row locks, post-lock re-reads, and merge-only JSON updates.
- [x] Send the current image identity from `ImageSlot`; keep file saving in the route and remove the newly saved file whenever the database mutation rejects or throws.
- [x] Move drawing validation and the locked JSON merge into the shared mutation.
- [x] Re-run focused tests and confirm photos, plan image, and drawing fields are preserved.

### Task 4: Enforce one meter bill per property

**Files:**

- Modify: `src/lib/server/property/mutations.ts`
- Modify: `src/routes/(app)/property/+page.server.ts`
- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0030_property_meter_bill_unique.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `tests/integration/domain-atomicity.test.ts`

**Interfaces:**

- Produces: injectable `setPropertyBillSource(billId, fromMeter, handle)` that locks the parent property and returns the route-compatible result.

- [x] Add a failing concurrent PostgreSQL test that switches two bills to meter source and expects both calls to succeed with exactly one final meter row.
- [x] Implement the parent-locking mutation and route delegation.
- [x] Add a partial unique schema index on `property_id WHERE source = 'meter'`.
- [x] Add migration 0030 that ranks duplicate meter rows by `sort, id`, demotes every row after the first, creates the partial unique index, and append journal index 30 after index 29.
- [x] Run focused PostgreSQL tests with all migrations.

### Task 5: Date-aware missing-rate integration coverage and verification

**Files:**

- Modify: `tests/integration/domain-atomicity.test.ts`

**Interfaces:**

- Consumes: injectable `missingRateCurrencies(baseCurrency, handle)` and `loadRateTable(handle)`.

- [x] Add a PostgreSQL regression proving pre-first-rate foreign document, broker-operation, and broker-position uses are reported despite a current fixing.
- [x] Run all focused unit and embedded-PostgreSQL suites.
- [x] Run `npm run check`, ESLint, scoped Prettier, and `git diff --check`; report unrelated workspace failures separately.
